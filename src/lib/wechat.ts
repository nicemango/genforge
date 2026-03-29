import { prisma } from './prisma'
import * as https from 'https'
import * as http from 'http'
import { HttpsProxyAgent } from 'https-proxy-agent'

interface WechatConfig {
  appId: string
  appSecret: string
  enabled: boolean
  cachedToken?: string
  tokenExpiresAt?: number
  defaultThumbMediaId?: string
  themeId?: 'brand-clean' | 'brand-magazine' | 'brand-warm' | 'wechat-pro'
  brandName?: string
  primaryColor?: string
  accentColor?: string
  titleAlign?: 'left' | 'center'
  showEndingCard?: boolean
  endingCardText?: string
  imageStyle?: 'rounded' | 'soft-shadow' | 'square'
}

interface AccessTokenResponse {
  access_token: string
  expires_in: number
  errcode?: number
  errmsg?: string
}

interface DraftAddResponse {
  media_id: string
  errcode?: number
  errmsg?: string
}

export interface WechatArticle {
  title: string
  content: string
  digest?: string
  thumb_media_id?: string
  author?: string
}

const WECHAT_API_BASE = 'https://api.weixin.qq.com/cgi-bin'

function getProxyUrl(): string | undefined {
  // Prefer dedicated WX proxy, fall back to general HTTPS proxy
  return process.env.WX_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY
}

function wechatFetch(urlStr: string, options?: RequestInit & { timeoutMs?: number }): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    const isHttps = urlStr.startsWith('https://')
    const url = new URL(urlStr)
    const proxyUrl = getProxyUrl()
    const agent = proxyUrl
      ? new HttpsProxyAgent(proxyUrl)
      : isHttps
        ? https.globalAgent
        : http.globalAgent

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    }
    if (options?.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        if (typeof v === 'string') headers[k] = v
      }
    }

    let bodyData: Buffer | null = null
    if (options?.body) {
      if (typeof options.body === 'string') {
        bodyData = Buffer.from(options.body, 'utf-8')
        headers['Content-Length'] = String(bodyData.length)
      } else if (Buffer.isBuffer(options.body)) {
        bodyData = options.body
        headers['Content-Length'] = String(options.body.length)
      } else if (typeof options.body === 'object' && 'buffer' in options.body) {
        // Blob-like object
        bodyData = Buffer.from(options.body as unknown as string, 'utf-8')
      }
    }

    const req = (isHttps ? https : http).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: (options?.method || 'GET').toUpperCase(),
        agent,
        headers,
        timeout: options?.timeoutMs || 30000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', () => resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', () => resolve({ ok: false, status: 0, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: '' }) })
    if (bodyData) {
      req.write(bodyData)
    }
    req.end()
  })
}

// Multipart form-data fetch (for image uploads) using native fetch + proxy agent
async function wechatMultipartFetch(urlStr: string, formData: FormData, timeoutMs = 30000): Promise<{ ok: boolean; status: number; body: string }> {
  const proxyUrl = getProxyUrl()
  if (!proxyUrl) {
    // No proxy — use native fetch
    const response = await fetch(urlStr, { method: 'POST', body: formData, signal: AbortSignal.timeout(timeoutMs) })
    const body = await response.text()
    return { ok: response.ok, status: response.status, body }
  }

  // Proxy URL needs to be拆解成 protocol + host + port
  const proxyUrlParsed = new URL(proxyUrl)
  const agent = new HttpsProxyAgent(proxyUrl)

  return new Promise((resolve) => {
    const targetUrl = new URL(urlStr)
    const isHttps = targetUrl.protocol === 'https:'
    const req = (isHttps ? https : http).request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: 'POST',
        agent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', () => resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', () => resolve({ ok: false, status: 0, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: '' }) })

    // Pipe FormData as a stream — requires converting FormData to a buffer
    // For simplicity, read the FormData into a buffer using Blob
    ;(async () => {
      try {
        const blob = await new Response(formData).blob()
        const arrayBuffer = await blob.arrayBuffer()
        req.write(Buffer.from(arrayBuffer))
        req.end()
      } catch {
        req.end()
      }
    })()
  })
}

export async function getAccessToken(accountId: string): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } })
  const config = JSON.parse(account.wechatConfig) as WechatConfig

  if (!config.appId || !config.appSecret) {
    throw new Error(`Account ${accountId} has no WeChat appId/appSecret configured.`)
  }

  const now = Math.floor(Date.now() / 1000)

  if (config.cachedToken && config.tokenExpiresAt && config.tokenExpiresAt > now + 300) {
    return config.cachedToken
  }

  const tokenUrl = `${WECHAT_API_BASE}/token?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`

  // Retry up to 3 attempts (initial + 2 retries) with 1s interval
  const maxAttempts = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await wechatFetch(tokenUrl, { timeoutMs: 10000 })

      if (!res.ok) {
        throw new Error(`WeChat token request failed: HTTP ${res.status}`)
      }

      const data = JSON.parse(res.body) as AccessTokenResponse

      if (data.errcode) {
        throw new Error(`WeChat API error ${data.errcode}: ${data.errmsg}`)
      }

      const tokenExpiresAt = Math.floor(Date.now() / 1000) + data.expires_in

      // Compare-and-swap: only update if the stored config hasn't been changed by another request
      const updateResult = await prisma.account.updateMany({
        where: {
          id: accountId,
          wechatConfig: account.wechatConfig,
        },
        data: {
          wechatConfig: JSON.stringify({
            ...config,
            cachedToken: data.access_token,
            tokenExpiresAt,
          }),
        },
      })

      if (updateResult.count === 0) {
        // Another request updated the token concurrently — re-read and use whatever is stored
        const freshAccount = await prisma.account.findUniqueOrThrow({ where: { id: accountId } })
        const freshConfig = JSON.parse(freshAccount.wechatConfig) as WechatConfig
        if (freshConfig.cachedToken && freshConfig.tokenExpiresAt && freshConfig.tokenExpiresAt > Math.floor(Date.now() / 1000) + 300) {
          return freshConfig.cachedToken
        }
        // Fresh token is also stale, use the one we just fetched
      }

      return data.access_token
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  throw new Error(`WeChat token request failed after ${maxAttempts} attempts: ${lastError?.message}`)
}

export async function pushToDraft(
  accountId: string,
  article: WechatArticle,
): Promise<string> {
  const token = await getAccessToken(accountId)

  const url = `${WECHAT_API_BASE}/draft/add?access_token=${token}`

  // thumb_media_id is required by WeChat draft API — get from account config or upload placeholder
  let thumbMediaId = article.thumb_media_id
  if (!thumbMediaId) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } })
    const config = JSON.parse(account.wechatConfig) as WechatConfig
    thumbMediaId = config.defaultThumbMediaId
  }
  if (!thumbMediaId) {
    thumbMediaId = await uploadPlaceholderThumb(accountId, token)
  }

  const digest = article.digest
    ? article.digest.replace(/<[^>]+>/g, '').slice(0, 120)
    : article.content.replace(/<[^>]+>/g, '').slice(0, 120)

  const bodyContent = JSON.stringify({
    articles: [
      {
        title: article.title,
        author: article.author || '',
        content: article.content,
        digest,
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  })

  const res = await wechatFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyContent, 'utf-8').toString(),
    },
    body: bodyContent,
    timeoutMs: 30000,
  })

  if (!res.ok) {
    throw new Error(`WeChat draft API failed: HTTP ${res.status}, body: ${res.body.slice(0, 500)}`)
  }

  const data = JSON.parse(res.body) as DraftAddResponse

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat draft API error ${data.errcode}: ${data.errmsg}`)
  }

  return data.media_id
}

interface MediaUploadResponse {
  media_id: string
  url?: string
  errcode?: number
  errmsg?: string
}

export async function uploadImage(
  accountId: string,
  imageBase64: string,
): Promise<string> {
  const token = await getAccessToken(accountId)
  const bytes = Buffer.from(imageBase64, 'base64')

  const boundary = `----WechatBoundary${Date.now()}`
  const bodyBuffer = buildMultipartBody(bytes, boundary, 'image.jpg', 'image/jpeg')

  // Body images for WeChat articles must use uploadimg, not temporary media/upload.
  const url = `${WECHAT_API_BASE}/media/uploadimg?access_token=${token}`

  const res = await wechatFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: bodyBuffer as unknown as string,
    timeoutMs: 30000,
  })

  if (!res.ok) {
    throw new Error(`WeChat image upload failed: HTTP ${res.status}`)
  }

  const data = JSON.parse(res.body) as MediaUploadResponse

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat media upload error ${data.errcode}: ${data.errmsg}`)
  }

  if (!data.url) {
    throw new Error('WeChat uploadimg response did not include url')
  }

  return data.url.replace(/^http:\/\//i, 'https://')
}

export async function uploadThumbMedia(
  accountId: string,
  imageBase64: string,
): Promise<string> {
  const token = await getAccessToken(accountId)
  const bytes = Buffer.from(imageBase64, 'base64')
  const boundary = `----WechatBoundary${Date.now()}`
  const bodyBuffer = buildMultipartBody(bytes, boundary, 'cover.jpg', 'image/jpeg')
  const url = `${WECHAT_API_BASE}/material/add_material?access_token=${token}&type=thumb`

  const res = await wechatFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: bodyBuffer as unknown as string,
    timeoutMs: 30000,
  })

  if (!res.ok) {
    throw new Error(`WeChat thumb upload failed: HTTP ${res.status}, body: ${res.body.slice(0, 200)}`)
  }

  const data = JSON.parse(res.body) as PermanentMaterialResponse
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat thumb upload error ${data.errcode}: ${data.errmsg}`)
  }

  return data.media_id
}

function buildMultipartBody(data: Uint8Array, boundary: string, filename: string, mimeType: string): Buffer {
  const headerStr = `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  const footerStr = `\r\n--${boundary}--\r\n`
  const headerBuf = Buffer.from(headerStr, 'utf-8')
  const footerBuf = Buffer.from(footerStr, 'utf-8')
  const dataBuf = Buffer.from(data)
  return Buffer.concat([headerBuf, dataBuf, footerBuf])
}

interface PermanentMaterialResponse {
  media_id: string
  url?: string
  errcode?: number
  errmsg?: string
}

// Upload a real image from picsum.photos as permanent material for use as thumb_media_id.
// Stores the resulting media_id in account.wechatConfig.defaultThumbMediaId to avoid re-uploading.
async function uploadPlaceholderThumb(accountId: string, token: string): Promise<string> {
  // Try fetching a real 900x383 image (WeChat recommended cover ratio) — direct fetch, no proxy needed
  let bytes: Uint8Array
  try {
    const imgResponse = await fetch('https://picsum.photos/900/383', { signal: AbortSignal.timeout(10000) })
    if (imgResponse.ok) {
      const imgBuffer = await imgResponse.arrayBuffer()
      bytes = new Uint8Array(imgBuffer)
    } else {
      bytes = await generateSolidColorPng(900, 383, 124, 43, 238)
    }
  } catch {
    bytes = await generateSolidColorPng(900, 383, 124, 43, 238)
  }

  const boundary = `----WechatBoundary${Date.now()}`
  const bodyBuffer = buildMultipartBody(bytes, boundary, 'cover.png', 'image/png')

  // type=thumb uploads as permanent cover/thumbnail material — required for draft thumb_media_id
  const url = `${WECHAT_API_BASE}/material/add_material?access_token=${token}&type=thumb`

  const res = await wechatFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: bodyBuffer as unknown as string,
    timeoutMs: 30000,
  })

  if (!res.ok) {
    throw new Error(`WeChat permanent material upload failed: HTTP ${res.status}, body: ${res.body.slice(0, 200)}`)
  }

  const data = JSON.parse(res.body) as PermanentMaterialResponse

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat permanent material error ${data.errcode}: ${data.errmsg}`)
  }

  const mediaId = data.media_id

  // Cache in account config
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } })
  const config = JSON.parse(account.wechatConfig) as WechatConfig
  await prisma.account.update({
    where: { id: accountId },
    data: { wechatConfig: JSON.stringify({ ...config, defaultThumbMediaId: mediaId }) },
  })

  return mediaId
}

// Generate a solid-color PNG using Node.js built-in zlib (available in Next.js server runtime)
async function generateSolidColorPng(width: number, height: number, r: number, g: number, b: number): Promise<Uint8Array> {
  const { deflateSync } = await import('zlib')

  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    const table = new Int32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      }
      table[i] = c
    }
    for (const byte of data) {
      crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  function chunk(tag: string, data: Uint8Array): Uint8Array {
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, data.length, false)
    const tagBytes = new TextEncoder().encode(tag)
    const crcData = new Uint8Array(tagBytes.length + data.length)
    crcData.set(tagBytes)
    crcData.set(data, tagBytes.length)
    const crcVal = new Uint8Array(4)
    new DataView(crcVal.buffer).setUint32(0, crc32(crcData), false)
    const result = new Uint8Array(4 + tagBytes.length + data.length + 4)
    let off = 0
    result.set(header, off); off += 4
    result.set(tagBytes, off); off += tagBytes.length
    result.set(data, off); off += data.length
    result.set(crcVal, off)
    return result
  }

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrData = new Uint8Array(13)
  const ihdrView = new DataView(ihdrData.buffer)
  ihdrView.setUint32(0, width, false)
  ihdrView.setUint32(4, height, false)
  ihdrData[8] = 8; ihdrData[9] = 2; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0
  const ihdr = chunk('IHDR', ihdrData)

  const rowBytes = 1 + width * 3
  const rawData = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes
    rawData[rowOff] = 0
    for (let x = 0; x < width; x++) {
      rawData[rowOff + 1 + x * 3] = r
      rawData[rowOff + 1 + x * 3 + 1] = g
      rawData[rowOff + 1 + x * 3 + 2] = b
    }
  }

  const compressed = deflateSync(rawData)
  const idat = chunk('IDAT', new Uint8Array(compressed))
  const iend = chunk('IEND', new Uint8Array(0))

  const png = new Uint8Array(sig.length + ihdr.length + idat.length + iend.length)
  let pos = 0
  png.set(sig, pos); pos += sig.length
  png.set(ihdr, pos); pos += ihdr.length
  png.set(idat, pos); pos += idat.length
  png.set(iend, pos)
  return png
}
