import * as cheerio from 'cheerio'
import type { Tool, ToolResult } from './types'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
    description: 'Search the web for information using DuckDuckGo. Returns titles, URLs, and snippets.',
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

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

      const maxRetries = options.maxRetries ?? 3
      let lastError = ''

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(searchUrl, {
            headers: { 'User-Agent': userAgent, 'Accept': 'text/html' },
            signal: AbortSignal.timeout(15000),
          })

          if (!response.ok) {
            lastError = `HTTP ${response.status} ${response.statusText}`
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return { success: false, output: '', error: `Search failed after ${maxRetries} attempts: ${lastError}` }
          }

          const html = await response.text()
          const $ = cheerio.load(html)

          const results: Array<{ title: string; url: string; snippet: string }> = []

          // WARNING: These CSS selectors depend on DuckDuckGo's HTML structure.
          // If DuckDuckGo changes their markup, these selectors will break silently.
          // Monitor for empty results even when queries should return data.
          const resultElements = $('.result')

          if (resultElements.length === 0) {
            // No .result elements found — likely means DuckDuckGo changed their HTML structure,
            // or the request was blocked/rate-limited. Return explicit error rather than empty results.
            lastError = `DuckDuckGo returned no parseable results (attempt ${attempt}/${maxRetries})`
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return {
              success: false,
              output: '',
              error: `${lastError}. The HTML structure may have changed (selector ".result" matched 0 elements). Raw HTML length: ${html.length} chars.`,
            }
          }

          resultElements.each((_, el) => {
            if (results.length >= limit) return
            const title = $(el).find('.result__title').text().trim()
            const url = $(el).find('.result__url').attr('href') ?? ''
            const snippet = $(el).find('.result__snippet').text().trim()
            if (title && url) {
              results.push({ title, url, snippet })
            }
          })

          if (results.length === 0) {
            lastError = 'DuckDuckGo returned result elements but none had valid title/url'
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return { success: false, output: '', error: lastError + '. Selectors ".result__title" / ".result__url" may have changed.' }
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
