import { prisma } from './prisma'

interface WechatConfig {
  appId: string
  appSecret: string
  enabled: boolean
  cachedToken?: string
  tokenExpiresAt?: number
  defaultThumbMediaId?: string
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

  const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`

  // Retry up to 3 attempts (initial + 2 retries) with 1s interval
  const maxAttempts = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(tokenUrl, { signal: AbortSignal.timeout(10000) })

      if (!response.ok) {
        throw new Error(`WeChat token request failed: HTTP ${response.status}`)
      }

      const data = (await response.json()) as AccessTokenResponse

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

  const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`

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

  const body = {
    articles: [
      {
        title: article.title,
        content: article.content,
        digest,
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`WeChat draft API failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as DraftAddResponse

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

  // Decode base64 to binary
  const binaryString = atob(imageBase64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  const formData = new FormData()
  formData.append('media', new Blob([bytes], { type: 'image/jpeg' }), 'image.jpg')

  const url = `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=image`

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`WeChat image upload failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as MediaUploadResponse

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat media upload error ${data.errcode}: ${data.errmsg}`)
  }

  // Return the URL if available, otherwise construct it
  return data.url ?? `https://mmbiz.qpic.cn/mmbiz_jpg/${data.media_id}/0`
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
  // Try fetching a real 900x383 image (WeChat recommended cover ratio)
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

  const formData = new FormData()
  formData.append('media', new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }), 'cover.png')

  // type=thumb uploads as permanent cover/thumbnail material — required for draft thumb_media_id
  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=thumb`

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`WeChat permanent material upload failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as PermanentMaterialResponse

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
