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

function fetchWithProxy(
  urlStr: string,
  timeout: number
): Promise<{ ok: boolean; status: number; body: string; contentType?: string }> {
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; content-center/1.0)', 'Accept': 'text/html,application/xhtml+xml' },
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () =>
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          body: data,
          contentType: Array.isArray(res.headers['content-type'])
            ? res.headers['content-type'][0]
            : res.headers['content-type'],
        })
      )
    })
    req.on('error', (err) => resolve({ ok: false, status: 0, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: '' }) })
    req.end()
  })
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

const SITE_CONTENT_SELECTORS: Array<{ hosts: string[]; selectors: string[] }> = [
  {
    hosts: ['ifanr.com', 'www.ifanr.com'],
    selectors: [
      '.o-single-content',
      '.single-content',
      '.c-single-text',
      '.article-content',
      '[class*="single-content"]',
      '[class*="article-content"]',
      '[class*="content"]',
    ],
  },
  {
    hosts: ['leiphone.com', 'www.leiphone.com'],
    selectors: [
      '.lph-article-content',
      '.article-content',
      '.article__content',
      '.post-content',
      '[class*="article-content"]',
      '[class*="post-content"]',
      '[class*="content"]',
    ],
  },
  {
    hosts: ['36kr.com', 'www.36kr.com'],
    selectors: [
      '.article-content',
      '.kr-rich-text',
      '.rich-text',
      '[class*="article-content"]',
      '[class*="rich-text"]',
      '[class*="content"]',
    ],
  },
]

const PARAGRAPH_SELECTORS = 'p, li, h2, h3, blockquote'
const JUNK_LINE_PATTERNS = [
  /^@(?:context|type|id)\b/i,
  /schema\.org/i,
  /\bdatePublished\b/i,
  /\bdateModified\b/i,
  /\buploadDate\b/i,
  /\bheadline\b/i,
  /\bimage\b\s*[:=]/i,
  /\bauthor\b\s*[:=]/i,
  /\bpublisher\b\s*[:=]/i,
  /\bmainEntityOfPage\b/i,
  /\bcontent\s*=/i,
  /^https?:\/\/[^ ]+\.(jpg|jpeg|png|webp)(\?.*)?$/i,
  /^[{[]/,
]

function normalizeLine(line: string): string {
  return line
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim()
}

function isJunkLine(line: string): boolean {
  const normalized = normalizeLine(line)
  if (!normalized) return true
  if (normalized.length < 8) return true
  if (JUNK_LINE_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  if (/^(责任编辑|原标题|原文链接|本文来自|来源：|责编：)/.test(normalized)) return true
  if (/^(刚刚|刚刚发布|刚刚更新|今天|昨日|前天)\s+\d{1,2}:\d{2}$/.test(normalized)) return true
  if (!/[\u4e00-\u9fff]/.test(normalized) && normalized.length <= 30 && normalized.split(/\s+/).length <= 4) return true
  if (/^[A-Za-z0-9_-]+\s*:\s*[A-Za-z0-9_./:-]+$/.test(normalized)) return true
  return false
}

function extractTextBlocks($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string[] {
  const blocks = node
    .find(PARAGRAPH_SELECTORS)
    .map((_, el) => normalizeLine($(el).text()))
    .get()
    .filter((line) => !isJunkLine(line))

  if (blocks.length > 0) {
    return blocks
  }

  return node
    .text()
    .split(/\n+/)
    .map(normalizeLine)
    .filter((line) => !isJunkLine(line))
}

function scoreBlocks(blocks: string[]): number {
  const totalLength = blocks.reduce((sum, line) => sum + line.length, 0)
  const paragraphBonus = Math.min(blocks.length, 12) * 80
  const digitBonus = blocks.filter((line) => /\d/.test(line)).length * 40
  return totalLength + paragraphBonus + digitBonus
}

function buildContentCandidates($: cheerio.CheerioAPI, url: URL): string[][] {
  const candidates: string[][] = []
  const siteRule = SITE_CONTENT_SELECTORS.find((rule) => rule.hosts.includes(url.hostname))

  if (siteRule) {
    for (const selector of siteRule.selectors) {
      $(selector).each((_, el) => {
        const blocks = extractTextBlocks($, $(el))
        if (blocks.length > 0) {
          candidates.push(blocks)
        }
      })
    }
  }

  const genericSelectors = ['article', 'main', '[role="main"]', '[class*="article"]', '[class*="content"]']
  for (const selector of genericSelectors) {
    $(selector).each((_, el) => {
      const blocks = extractTextBlocks($, $(el))
      if (blocks.length > 0) {
        candidates.push(blocks)
      }
    })
  }

  const bodyBlocks = extractTextBlocks($, $('body'))
  if (bodyBlocks.length > 0) {
    candidates.push(bodyBlocks)
  }

  return candidates
}

function dedupeBlocks(blocks: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const block of blocks) {
    if (seen.has(block)) continue
    seen.add(block)
    deduped.push(block)
  }

  return deduped
}

function extractMainContent($: cheerio.CheerioAPI, urlStr: string): string {
  const url = new URL(urlStr)
  const candidates = buildContentCandidates($, url)
    .map(dedupeBlocks)
    .filter((blocks) => blocks.length >= 3)
    .sort((a, b) => scoreBlocks(b) - scoreBlocks(a))

  const best = candidates[0] ?? []
  const fallback = dedupeBlocks(
    $('body')
      .text()
      .split(/\n+/)
      .map(normalizeLine)
      .filter((line) => !isJunkLine(line))
  )

  return (best.length > 0 ? best : fallback).join('\n\n')
}

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
          const res = await fetchWithProxy(url, 20000)

          if (!res.ok) {
            lastError = `HTTP ${res.status}`
            if (attempt < maxRetries) {
              await sleep(1000 * attempt)
              continue
            }
            return { success: false, output: '', error: `Failed to fetch ${url}: ${lastError}` }
          }

          const contentType = res.contentType?.toLowerCase() ?? ''
          const looksLikeHtml = /<(html|head|body|article|main)\b/i.test(res.body)
          if (contentType && !contentType.includes('html') && !looksLikeHtml) {
            return { success: true, output: res.body.slice(0, limit) }
          }

          const $ = cheerio.load(res.body)

          REMOVE_SELECTORS.forEach((sel) => $(sel).remove())

          const cleaned = extractMainContent($, url)
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
