import { z } from 'zod'
import * as https from 'https'
import * as http from 'http'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Tool, ToolResult } from './types'
import type { TwitterSource } from '@/lib/twitter-sources'
import { getNitterInstance } from '@/lib/twitter-sources'

const FetchTwitterParamsSchema = z.object({
  sourceName: z.string(),
  handle: z.string(),
  minLikes: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
})

interface Tweet {
  id: string
  text: string
  likes: number
  retweets: number
  replies: number
  createdAt: string
  permalink: string
  isRetweet: boolean
  isReply: boolean
}

// ---------------------------------------------------------------------------
// Proxy agent
// ---------------------------------------------------------------------------

function getProxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
}

function fetchUrl(urlStr: string, timeoutMs: number, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    const isHttps = urlStr.startsWith('https://')
    const url = new URL(urlStr)
    const proxyUrl = getProxyUrl()
    const agent = proxyUrl
      ? new HttpsProxyAgent(proxyUrl)
      : isHttps
        ? https.globalAgent
        : http.globalAgent

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      agent,
      timeout: timeoutMs,
      headers: headers || {
        'User-Agent': 'Content-Center/1.0 Twitter Fetcher',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', (err) => resolve({ ok: false, status: 0, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: '' }) })
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Nitter RSS parsing
// ---------------------------------------------------------------------------

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

function parseNitterRss(xml: string, minLikes: number): Tweet[] {
  const tweets: Tweet[] = []

  // Extract tweet entries from RSS
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]

    // Extract title (contains @handle and tweet text)
    const titleMatch = /<title><!\[CDATA\[([^\]]+)\]\]><\/title>/i.exec(item)
    const linkMatch = /<link>(https?:\/\/nitter[^<]+)<\/link>/i.exec(item)
    const pubDateMatch = /<pubDate>([^<]+)<\/pubDate>/i.exec(item)

    if (!titleMatch) continue

    const title = stripHtml(titleMatch[1])
    // Title format: "@handle tweet text"
    const handleInTitle = title.match(/^@(\w+)/)
    if (!handleInTitle) continue

    // Extract metrics from description or additional fields
    const descMatch = /<description><!\[CDATA\[([^\]]+)\]\]><\/description>/i.exec(item)
    const description = descMatch ? stripHtml(descMatch[1]) : ''

    // Parse likes from description (format: "X likes")
    const likesMatch = description.match(/(\d+)\s*likes/i)
    const likes = likesMatch ? parseInt(likesMatch[1], 10) : 0

    // Skip low engagement tweets
    if (likes < minLikes) continue

    // Check if it's a retweet or reply
    const isRetweet = title.includes('RT @') || description.includes('RT @')
    const isReply = title.includes('@') && !title.startsWith('@')

    const tweet: Tweet = {
      id: linkMatch ? linkMatch[1] : `nitter-${Date.now()}`,
      text: title.replace(/^@\w+\s*/, '').replace(/^RT @\w+:\s*/, ''),
      likes,
      retweets: 0,
      replies: 0,
      createdAt: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString(),
      permalink: linkMatch ? linkMatch[1] : '',
      isRetweet,
      isReply,
    }

    tweets.push(tweet)

    if (tweets.length >= 20) break
  }

  return tweets
}

// ---------------------------------------------------------------------------
// Twitter API.io fallback
// ---------------------------------------------------------------------------

async function fetchViaTwitterApi(
  handle: string,
  sourceName: string,
  minLikes: number,
  limit: number,
  timeoutMs: number,
): Promise<{ success: true; tweets: Tweet[] } | { success: false; error: string }> {
  const apiKey = process.env.TWITTER_API_KEY
  if (!apiKey) {
    return { success: false, error: 'TWITTER_API_KEY not configured' }
  }

  try {
    const res = await fetchUrl(
      `https://api.twitter-api.io/api/v2/user/${handle}/tweets?max_results=${Math.min(limit, 100)}`,
      timeoutMs,
      {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    )

    if (!res.ok) {
      return { success: false, error: `Twitter API returned ${res.status}` }
    }

    const data = JSON.parse(res.body) as {
      data?: Array<{
        id: string
        text: string
        public_metrics: { like_count: number; retweet_count: number; reply_count: number }
        created_at: string
      }>
    }

    if (!data.data) {
      return { success: false, error: 'No tweets returned' }
    }

    const tweets: Tweet[] = data.data
      .filter((t) => t.public_metrics.like_count >= minLikes)
      .slice(0, limit)
      .map((t) => ({
        id: t.id,
        text: t.text,
        likes: t.public_metrics.like_count,
        retweets: t.public_metrics.retweet_count,
        replies: t.public_metrics.reply_count,
        createdAt: t.created_at,
        permalink: `https://twitter.com/${handle}/status/${t.id}`,
        isRetweet: false,
        isReply: false,
      }))

    return { success: true, tweets }
  } catch (err) {
    if (err instanceof Error) {
      return { success: false, error: err.message }
    }
    return { success: false, error: String(err) }
  }
}

// ---------------------------------------------------------------------------
// Main tool
// ---------------------------------------------------------------------------

export function createFetchTwitterTool(): Tool {
  const defaultLimit = 20
  const defaultTimeoutMs = 15_000

  return {
    name: 'fetch_twitter',
    description:
      "Fetch tweets from a Twitter/X account. Returns recent tweets with engagement metrics. Supports Nitter (free) or Twitter API (paid). Set minLikes to filter high-engagement tweets.",
    parameters: {
      type: 'object',
      properties: {
        sourceName: {
          type: 'string',
          description: 'Display name for this source (e.g., "Sam Altman")',
        },
        handle: {
          type: 'string',
          description: 'Twitter handle without @ (e.g., "sama" for @sama)',
        },
        minLikes: {
          type: 'number',
          description: 'Minimum likes threshold (default: 100)',
        },
        limit: {
          type: 'number',
          description: `Max tweets to return (default: ${defaultLimit}, max: 100)`,
        },
        timeoutMs: {
          type: 'number',
          description: `Request timeout in ms (default: ${defaultTimeoutMs})`,
        },
      },
      required: ['sourceName', 'handle'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const parsed = FetchTwitterParamsSchema.safeParse(params)
      if (!parsed.success) {
        return {
          success: false,
          output: '',
          error: `Invalid params: ${parsed.error.issues.map((e) => e.message).join(', ')}`,
        }
      }

      const { sourceName, handle, minLikes = 100, limit = defaultLimit, timeoutMs = defaultTimeoutMs } =
        parsed.data
      const effectiveLimit = Math.min(Number(limit), 100)

      // Try Twitter API first if configured
      const apiResult = await fetchViaTwitterApi(handle, sourceName, minLikes, effectiveLimit, timeoutMs)
      if (apiResult.success) {
        return {
          success: true,
          output: JSON.stringify(
            {
              feedTitle: `Twitter: @${handle}`,
              tweets: apiResult.tweets,
              totalCount: apiResult.tweets.length,
              source: 'twitter-api',
            },
            null,
            2,
          ),
        }
      }

      // Fall back to Nitter
      const nitterBase = getNitterInstance()
      const rssUrl = `${nitterBase}/${handle}/rss`

      try {
        const res = await fetchUrl(rssUrl, timeoutMs)

        if (!res.ok) {
          return {
            success: false,
            output: '',
            error: `Nitter returned HTTP ${res.status} for ${rssUrl}. Hint: ${apiResult.error}`,
          }
        }

        const tweets = parseNitterRss(res.body, minLikes)

        if (tweets.length === 0) {
          return {
            success: true,
            output: JSON.stringify(
              {
                feedTitle: `Twitter: @${handle}`,
                tweets: [],
                totalCount: 0,
                source: 'nitter',
                warning: `No tweets above ${minLikes} likes found.`,
              },
              null,
              2,
            ),
          }
        }

        return {
          success: true,
          output: JSON.stringify(
            {
              feedTitle: `Twitter: @${handle}`,
              tweets: tweets.slice(0, effectiveLimit),
              totalCount: tweets.length,
              source: 'nitter',
            },
            null,
            2,
          ),
        }
      } catch (err) {
        if (err instanceof Error) {
          return { success: false, output: '', error: `Failed to fetch Twitter @${handle}: ${err.message}` }
        }
        return { success: false, output: '', error: `Failed to fetch Twitter @${handle}: ${String(err)}` }
      }
    },
  }
}

