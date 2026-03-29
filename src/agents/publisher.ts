import { prisma } from '@/lib/prisma'
import { parseWechatConfig, parseWritingStyle } from '@/lib/json'
import { compileWechatArticle, type WechatLayoutConfig } from '@/lib/wechat-layout'
import { pushToDraft, uploadImage } from '@/lib/wechat'
import { renderTemplateImage } from '@/lib/template-image'
import type { GeneratedImageAsset, ImagePlanItem } from '@/lib/image-plan'

export interface PublishResult {
  mediaId: string
  publishedAt: string
  contentId?: string
  convertedHtml: string
}

export interface PublishOptions {
  author?: string
  contentId?: string
}

export async function runPublishAgent(
  accountId: string,
  title: string,
  body: string,
  summary?: string,
  options?: PublishOptions,
): Promise<PublishResult> {
  if (!title?.trim()) {
    throw new Error('Article title is required for publishing')
  }
  if (!body?.trim()) {
    throw new Error('Article body is required for publishing')
  }

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { wechatConfig: true, writingStyle: true },
  })
  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

  const wechatConfig = parseWechatConfig(account.wechatConfig)
  const writingStyle = parseWritingStyle(account.writingStyle)
  const layoutConfig: WechatLayoutConfig = {
    themeId: wechatConfig.themeId,
    brandName: wechatConfig.brandName ?? writingStyle.brandName,
    primaryColor: wechatConfig.primaryColor,
    accentColor: wechatConfig.accentColor,
    titleAlign: wechatConfig.titleAlign,
    showEndingCard: wechatConfig.showEndingCard,
    endingCardText: wechatConfig.endingCardText,
    imageStyle: wechatConfig.imageStyle,
  }

  const publishableBody = await ensurePublishableBody(accountId, body, layoutConfig, options?.contentId)
  const themedHtml = compileWechatArticle(publishableBody, { title, summary, layoutConfig })
  const htmlContent = await replaceImagesWithWechatUrls(accountId, themedHtml)

  const mediaId = await pushToDraft(accountId, {
    title,
    content: htmlContent,
    digest: summary,
    author: options?.author,
  })

  const publishedAt = new Date().toISOString()

  if (options?.contentId) {
    const content = await prisma.content.findUnique({ where: { id: options.contentId } })
    if (content) {
      const records = JSON.parse(content.publishRecords || '[]') as Array<Record<string, unknown>>
      records.push({
        mediaId,
        publishedAt,
        platform: 'wechat',
        wordCount: content.wordCount,
      })
      await prisma.content.update({
        where: { id: options.contentId },
        data: { publishRecords: JSON.stringify(records) },
      })
    }
  }

  return {
    mediaId,
    publishedAt,
    contentId: options?.contentId,
    convertedHtml: htmlContent,
  }
}

async function ensurePublishableBody(
  accountId: string,
  body: string,
  layoutConfig: WechatLayoutConfig,
  contentId?: string,
): Promise<string> {
  if (!contentId || !body.includes('(data:image/')) {
    return body
  }

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: { images: true },
  })
  const storedAssets = parseStoredAssets(content?.images ?? null)
  if (storedAssets.length === 0) {
    return body
  }

  let nextBody = body
  const nextAssets: GeneratedImageAsset[] = []
  for (const asset of storedAssets) {
    let nextAsset = { ...asset }
    if (isInlineAsset(nextAsset)) {
      nextAsset = await upgradePublishAsset(accountId, nextAsset, layoutConfig)
    }

    nextAssets.push(nextAsset)
    if (asset.url && nextAsset.url && asset.url !== nextAsset.url) {
      nextBody = replaceMarkdownImageUrl(nextBody, asset, nextAsset.url)
    }
  }

  await prisma.content.update({
    where: { id: contentId },
    data: {
      body: nextBody,
      images: JSON.stringify(nextAssets),
    },
  })

  return nextBody
}

async function replaceImagesWithWechatUrls(accountId: string, html: string): Promise<string> {
  const dataImageRegex = /src="(data:image\/[^";]+;base64,([^"]+))"/g
  const matches = [...html.matchAll(dataImageRegex)]

  if (matches.length === 0) {
    return html
  }

  let result = html
  for (const match of matches) {
    const fullDataUrl = match[1]
    const base64 = match[2]
    const wechatUrl = await uploadWithRetry(accountId, base64)
    if (wechatUrl) {
      result = result.split(fullDataUrl).join(wechatUrl)
    } else {
      console.warn(`[PublishAgent] Image upload failed, base64 will be stripped from HTML (accountId: ${accountId}, size: ${base64.length} chars)`)
      result = result.split(fullDataUrl).join('about:blank')
    }
  }

  return result
}

async function upgradePublishAsset(
  accountId: string,
  asset: GeneratedImageAsset,
  layoutConfig: WechatLayoutConfig,
): Promise<GeneratedImageAsset> {
  if (asset.imageBase64) {
    const uploadedUrl = await uploadWithRetry(accountId, asset.imageBase64)
    if (uploadedUrl) {
      return {
        ...asset,
        url: uploadedUrl,
        uploadStatus: 'uploaded',
        qualityStatus: asset.qualityStatus === 'downgraded' ? 'downgraded' : 'passed',
      }
    }
  }

  const fallbackItem = buildTemplateFallbackItem(asset)
  const rendered = await renderTemplateImage(fallbackItem, layoutConfig.themeId ?? 'wechat-pro')
  const fallbackUrl = await uploadWithRetry(accountId, rendered.imageBase64)
  if (!fallbackUrl) {
    return {
      ...asset,
      uploadStatus: 'failed',
      qualityStatus: 'failed',
      fallbackReason: asset.fallbackReason ?? 'Publisher could not upload inline asset or template fallback',
    }
  }

  return {
    ...asset,
    url: fallbackUrl,
    mimeType: rendered.mimeType,
    imageBase64: rendered.imageBase64,
    renderMode: 'template',
    coverMode: asset.imageType === 'cover-hero' ? 'template' : asset.coverMode,
    uploadStatus: 'uploaded',
    qualityStatus: 'downgraded',
    fallbackReason: asset.fallbackReason ?? 'Publisher replaced inline image with template fallback',
  }
}

function buildTemplateFallbackItem(asset: GeneratedImageAsset): ImagePlanItem {
  return {
    slotId: asset.slotId,
    marker: asset.marker,
    alt: asset.alt,
    sectionTitle: asset.caption.split('｜')[0] || asset.alt,
    imageType: asset.imageType === 'cover-hero' ? 'cover-hero' : asset.imageType === 'data-card' ? 'data-card' : 'section-card',
    renderMode: 'template',
    coverMode: asset.imageType === 'cover-hero' ? 'template' : asset.coverMode,
    aspectRatio: asset.imageType === 'cover-hero' ? '16:9' : '4:3',
    prompt:
      asset.imageType === 'cover-hero'
        ? `${asset.caption.split('｜')[0] || asset.alt}｜platform-cover｜平台规则与权限结构｜默认开关、授权面板、代码仓库与产品权限关系｜${asset.caption || asset.alt}`
        : asset.sourcePrompt || `${asset.alt}｜${asset.caption || '模板降级卡片'}`,
    caption: asset.caption || `${asset.alt}｜模板降级`,
    priority: 0,
  }
}

async function uploadWithRetry(accountId: string, base64: string, maxRetries = 3): Promise<string | null> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadImage(accountId, base64)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        await sleep(attempt * 1000)
      }
    }
  }
  console.warn(`Failed to upload image to WeChat after ${maxRetries} attempts: ${lastError?.message}`)
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseStoredAssets(imagesJson: string | null): GeneratedImageAsset[] {
  if (!imagesJson) return []
  try {
    const parsed = JSON.parse(imagesJson)
    return Array.isArray(parsed) ? (parsed as GeneratedImageAsset[]) : []
  } catch {
    return []
  }
}

function isInlineAsset(asset: GeneratedImageAsset): boolean {
  return !asset.url || asset.url.startsWith('data:image/') || asset.uploadStatus === 'inline'
}

function replaceMarkdownImageUrl(body: string, asset: GeneratedImageAsset, nextUrl: string): string {
  const currentUrl = asset.url ?? ''
  const exact = currentUrl ? `![${asset.alt}](${currentUrl})` : ''
  if (exact && body.includes(exact)) {
    return body.replace(exact, `![${asset.alt}](${nextUrl})`)
  }

  if (!currentUrl) return body
  const pattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(currentUrl)}\\)`, 'g')
  return body.replace(pattern, (_match, alt: string) => `![${alt || asset.alt}](${nextUrl})`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
