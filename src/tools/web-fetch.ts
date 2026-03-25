import * as cheerio from 'cheerio'
import type { Tool, ToolResult } from './types'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface WebFetchParams {
  url: string
  maxLength?: number
}

export interface WebFetchToolOptions {
  maxRetries?: number
}

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.ad', '.ads', '.advertisement', '.sidebar', '.cookie-notice',
]

export function createWebFetchTool(options: WebFetchToolOptions = {}): Tool {
  const userAgent = 'Mozilla/5.0 (compatible; content-center/1.0)'

  return {
    name: 'web_fetch',
    description: 'Fetch a web page and extract its main text content. Strips navigation, ads, and boilerplate.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the web page to fetch',
        },
        maxLength: {
          type: 'number',
          description: 'Maximum characters to return (default: 4000, max: 10000)',
        },
      },
      required: ['url'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const { url, maxLength = 4000 } = params as unknown as WebFetchParams
      const limit = Math.min(Number(maxLength), 10000)

      const maxRetries = options.maxRetries ?? 3
      let lastError = ''

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': userAgent, 'Accept': 'text/html,application/xhtml+xml' },
            signal: AbortSignal.timeout(20000),
          })

          if (!response.ok) {
            lastError = `HTTP ${response.status} ${response.statusText}`
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return { success: false, output: '', error: `Failed to fetch ${url}: ${lastError}` }
          }

          const contentType = response.headers.get('content-type') ?? ''
          if (!contentType.includes('html')) {
            const text = await response.text()
            return { success: true, output: text.slice(0, limit) }
          }

          const html = await response.text()
          const $ = cheerio.load(html)

          REMOVE_SELECTORS.forEach((sel) => $(sel).remove())

          const contentEl =
            $('article').first().text() ||
            $('main').first().text() ||
            $('[role="main"]').first().text() ||
            $('body').text()

          const cleaned = contentEl
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim()
            .slice(0, limit)

          const title = $('title').text().trim()

          return {
            success: true,
            output: title ? `# ${title}\n\n${cleaned}` : cleaned,
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          if (attempt < maxRetries) {
            await sleep(1000 * attempt)
            continue
          }
          return { success: false, output: '', error: `Failed to fetch ${url} after ${maxRetries} attempts: ${lastError}` }
        }
      }

      return { success: false, output: '', error: `Failed to fetch ${url} after ${maxRetries} attempts: ${lastError}` }
    },
  }
}
