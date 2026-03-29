import * as cheerio from 'cheerio'
import * as https from 'https'
import * as http from 'http'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Tool, ToolResult } from './types'

function getProxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function fetchWithProxy(urlStr: string, timeout: number): Promise<{ ok: boolean; status: number; body: string }> {
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
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', (err) => {
      console.error('[web-search] Request error:', err.message)
      resolve({ ok: false, status: 0, body: '' })
    })
    req.on('timeout', () => {
      console.error('[web-search] Timeout! url:', urlStr, 'proxy:', proxyUrl)
      req.destroy()
      resolve({ ok: false, status: 0, body: '' })
    })
    req.end()
  })
}

interface WebSearchParams {
  query: string
  maxResults?: number
}

export interface WebSearchToolOptions {
  maxRetries?: number
}

export function createWebSearchTool(options: WebSearchToolOptions = {}): Tool {
  const userAgent = 'Mozilla/5.0 (compatible; content-center/1.0)'

  return {
    name: 'web_search',
    description: 'Search the web for information using Bing. Returns titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const { query, maxResults = 5 } = params as unknown as WebSearchParams
      const limit = Math.min(Number(maxResults), 10)

      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`

      const maxRetries = options.maxRetries ?? 3
      let lastError = ''

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetchWithProxy(searchUrl, 15000)

          if (!res.ok) {
            lastError = `HTTP ${res.status}`
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return { success: false, output: '', error: `Search failed after ${maxRetries} attempts: ${lastError}` }
          }

          const xml = res.body
          const $ = cheerio.load(xml, { xml: true })

          const results: Array<{ title: string; url: string; snippet: string }> = []

          // Parse Bing RSS format: <item><title>...</title><link>...</link><description>...</description></item>
          const items = $('item')

          if (items.length === 0) {
            // No item elements found — likely means Bing blocked the request or returned an error page.
            lastError = `Bing returned no parseable results (attempt ${attempt}/${maxRetries})`
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return {
              success: false,
              output: '',
              error: `${lastError}. The RSS structure may have changed or the request was blocked. Raw XML length: ${xml.length} chars.`,
            }
          }

          items.each((_, el) => {
            if (results.length >= limit) return
            const title = $(el).find('title').text().trim()
            const url = $(el).find('link').text().trim()
            const description = $(el).find('description').text().trim()
            // Clean HTML tags from description
            const snippet = description.replace(/<[^>]*>/g, '').trim()
            if (title && url) {
              results.push({ title, url, snippet })
            }
          })

          if (results.length === 0) {
            lastError = 'Bing returned item elements but none had valid title/link'
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return { success: false, output: '', error: lastError + '. RSS item parsing may have failed.' }
          }

          const formatted = results
            .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
            .join('\n\n')

          return { success: true, output: formatted }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          if (attempt < maxRetries) {
            await sleep(1000 * attempt)
            continue
          }
          return { success: false, output: '', error: `Search failed after ${maxRetries} attempts: ${lastError}` }
        }
      }

      return { success: false, output: '', error: `Search failed after ${maxRetries} attempts: ${lastError}` }
    },
  }
}
