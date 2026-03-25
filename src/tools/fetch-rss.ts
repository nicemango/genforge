import { z } from 'zod'
import { XMLParser } from 'fast-xml-parser'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Tool, ToolResult } from './types'

const FetchRssParamsSchema = z.object({
  url: z.string().url('url must be a valid URL'),
  limit: z.number().int().positive().optional(),
})

interface Article {
  title: string
  link: string
  pubDate: string
  snippet: string
}

interface FetchRssToolOptions {
  defaultLimit?: number
  maxLimit?: number
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// XML parser — shared across all execute() calls, no per-request re-creation
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Proxy agent — reads HTTP_PROXY / HTTPS_PROXY once, memoised
// ---------------------------------------------------------------------------
let _proxyAgent: HttpsProxyAgent<string> | null = null

function getProxyAgent(): HttpsProxyAgent<string> | null {
  if (_proxyAgent) return _proxyAgent
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  if (!proxyUrl) return null
  try {
    _proxyAgent = new HttpsProxyAgent(proxyUrl)
    return _proxyAgent
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// XML parser — shared across all execute() calls, no per-request re-creation
// ---------------------------------------------------------------------------
const xmlParser = new XMLParser({
  parseAttributeValue: false,
  ignoreAttributes: true,
  // Preserve text trimming via postprocessing
  trimValues: true,
})

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getField(obj: unknown, ...keys: string[]): string {
  let current: unknown = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[key]
  }
  if (typeof current === 'string') return current.trim()
  return ''
}

function parseRssItems(data: unknown, limit: number): Article[] {
  // RSS 2.0: rss.channel.item[]
  const channel = (data as Record<string, unknown>)?.['rss']
    ? (data as Record<string, unknown>)['rss'] // 'rss' key
    : (data as Record<string, unknown>)?.['RSS'] // 'RSS' key
    ?? null

  if (!channel || typeof channel !== 'object') return []

  const ch = channel as Record<string, unknown>
  let items = ch['channel']
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    items = (items as Record<string, unknown>)['item']
  }
  if (!Array.isArray(items)) return []

  const title = getField(channel, 'channel', 'title') || getField(channel, 'title') || ''

  return items.slice(0, limit).map((item) => {
    const obj = item as Record<string, unknown>
    const link = getField(obj, 'link') || getField(obj, 'guid', '#text') || ''
    const snippet = stripHtml(
      getField(obj, 'description') || getField(obj, 'content:encoded') || getField(obj, 'content') || '',
    ).slice(0, 300)
    return {
      title: getField(obj, 'title') || '(no title)',
      link: typeof link === 'string' ? link : '',
      pubDate: getField(obj, 'pubDate') || getField(obj, 'dc:date') || '',
      snippet,
    }
  })
}

function parseAtomItems(data: unknown, limit: number): Article[] {
  // Atom: feed.entry[]
  const feed = (data as Record<string, unknown>)?.['feed']
    ?? (data as Record<string, unknown>)?.['Feed']
    ?? null
  if (!feed || typeof feed !== 'object') return []

  const f = feed as Record<string, unknown>
  const entries = f['entry'] || f['Entry']
  if (!Array.isArray(entries)) return []

  return entries.slice(0, limit).map((entry) => {
    const obj = entry as Record<string, unknown>
    const linkField = obj['link']
    let link = ''
    if (typeof linkField === 'string') {
      link = linkField
    } else if (Array.isArray(linkField)) {
      // <link href="..." rel="alternate"> is the primary link
      const alt = (linkField as Array<Record<string, unknown>>).find(
        (l) => !l['@_rel'] || l['@_rel'] === 'alternate',
      )
      link = alt ? String(alt['@_href'] ?? '') : ''
    } else if (linkField && typeof linkField === 'object') {
      link = String((linkField as Record<string, unknown>)['@_href'] ?? '')
    }

    const snippet = stripHtml(
      getField(obj, 'summary') || getField(obj, 'content') || '',
    ).slice(0, 300)

    return {
      title: getField(obj, 'title') || '(no title)',
      link,
      pubDate: getField(obj, 'published') || getField(obj, 'updated') || '',
      snippet,
    }
  })
}

function parseXmlFeed(xml: string, limit: number): { feedTitle: string; articles: Article[] } {
  const data = xmlParser.parse(xml) as Record<string, unknown>

  // Detect format
  if (data['rss'] || data['Rss'] || data['RSS']) {
    const channel = ((data['rss'] || data['Rss'] || data['RSS']) as Record<string, unknown>)['channel'] as Record<string, unknown>
    const feedTitle = getField(channel, 'title') || ''
    return { feedTitle, articles: parseRssItems(data, limit) }
  }

  if (data['feed'] || data['Feed']) {
    const feedTitle = getField(data, 'feed', 'title') || getField(data, 'Feed', 'title') || ''
    return { feedTitle, articles: parseAtomItems(data, limit) }
  }

  return { feedTitle: '', articles: [] }
}

export function createFetchRssTool(opts: FetchRssToolOptions = {}): Tool {
  const defaultLimit = opts.defaultLimit ?? 15
  const maxLimit = opts.maxLimit ?? 50
  const timeoutMs = opts.timeoutMs ?? 15_000

  return {
    name: 'fetch_rss',
    description: 'Fetch articles from an RSS feed URL. Returns recent articles with title, link, publication date, and snippet.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The RSS feed URL to fetch',
        },
        limit: {
          type: 'number',
          description: `Maximum number of articles to return (default: ${defaultLimit}, max: ${maxLimit})`,
        },
      },
      required: ['url'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const parsed = FetchRssParamsSchema.safeParse(params)
      if (!parsed.success) {
        return { success: false, output: '', error: `Invalid params: ${parsed.error.issues.map(e => e.message).join(', ')}` }
      }
      const { url, limit = defaultLimit } = parsed.data
      const effectiveLimit = Math.min(Number(limit), maxLimit)

      // Use RSSHub proxy if configured
      const rsshubUrl = process.env.DEFAULT_RSSHUB_URL
      let feedUrl = url
      if (rsshubUrl) {
        try {
          new URL(rsshubUrl)
          const parsedUrl = new URL(url)
          feedUrl = `${rsshubUrl}${parsedUrl.pathname}`
        } catch {
          return { success: false, output: '', error: `DEFAULT_RSSHUB_URL "${rsshubUrl}" is not a valid URL` }
        }
      }

      let controller: AbortController
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      try {
        controller = new AbortController()
        timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        const response = await fetch(feedUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Content-Center/1.0 RSS Reader',
            'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
          },
          // @ts-expect-error — https-proxy-agent is compatible with http(s) fetch agent option
          agent: getProxyAgent(),
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          return { success: false, output: '', error: `HTTP ${response.status} ${response.statusText} for ${feedUrl}` }
        }

        const xmlText = await response.text()
        const { feedTitle, articles } = parseXmlFeed(xmlText, effectiveLimit)

        return {
          success: true,
          output: JSON.stringify({ feedTitle: feedTitle || feedUrl, articles }, null, 2),
        }
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            return { success: false, output: '', error: `Timeout after ${timeoutMs}ms fetching ${feedUrl}` }
          }
          return { success: false, output: '', error: `Failed to fetch RSS ${feedUrl}: ${err.message}` }
        }
        return { success: false, output: '', error: `Failed to fetch RSS ${feedUrl}: ${String(err)}` }
      }
    },
  }
}
