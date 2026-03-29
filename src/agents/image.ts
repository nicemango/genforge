import { createAgentProvider, type ModelConfig } from '@/lib/ai'
import type { WritingStyleJSON } from '@/lib/json'
import type { WechatLayoutConfig } from '@/lib/wechat-layout'
import type { GeneratedImageAsset, ImagePlan, ImagePlanItem } from '@/lib/image-plan'
import { listImagePlanItems, planArticleImages } from '@/lib/image-plan'
import { generateImageWithFallback } from '@/lib/minimax-image'
import { renderTemplateImage } from '@/lib/template-image'
import { BaseAgent } from './base'

export interface ImageSuggestion {
  location: string
  description: string
  reason: string
}

export interface ImageAgentResult {
  imagePlan: ImagePlan
  assets: GeneratedImageAsset[]
  imagePlaceholders: Array<{
    slotId: string
    marker: string
    imageBase64: string
    alt: string
    caption: string
    imageType: ImagePlanItem['imageType']
    renderMode: ImagePlanItem['renderMode']
    sourcePrompt: string
    mimeType: string
    width?: number
    height?: number
  }>
}

interface RunImageAgentOptions {
  writingStyle?: WritingStyleJSON
  layoutConfig?: WechatLayoutConfig
}

export async function runImageAgent(
  articleTitle: string,
  articleBody: string,
  apiKey: string | undefined,
  modelConfig: ModelConfig,
  options: RunImageAgentOptions = {},
): Promise<ImageAgentResult> {
  const rulePlan = planArticleImages(articleTitle, articleBody, options)
  const imagePlan = await enrichImagePlan(rulePlan, articleTitle, articleBody, modelConfig)
  const assets = await materializeImagePlan(imagePlan, apiKey)

  return {
    imagePlan,
    assets,
    imagePlaceholders: assets
      .filter((asset): asset is GeneratedImageAsset & { imageBase64: string } => Boolean(asset.imageBase64))
      .map((asset) => ({
        slotId: asset.slotId,
        marker: asset.marker,
        imageBase64: asset.imageBase64,
        alt: asset.alt,
        caption: asset.caption,
        imageType: asset.imageType,
        renderMode: asset.renderMode,
        sourcePrompt: asset.sourcePrompt ?? '',
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      })),
  }
}

async function enrichImagePlan(
  rulePlan: ImagePlan,
  articleTitle: string,
  articleBody: string,
  modelConfig: ModelConfig,
): Promise<ImagePlan> {
  const aiItems = listImagePlanItems(rulePlan).filter((item) => item.renderMode === 'ai')
  const hasModelAuth = Boolean(modelConfig.apiKey || process.env.DEFAULT_AI_API_KEY)
  if (aiItems.length === 0 || !hasModelAuth) {
    return rulePlan
  }

  try {
    const provider = createAgentProvider('image', modelConfig)
    const agent = new BaseAgent(provider, { maxSteps: 2 })
    const task = [
      '你是中文公众号配图策划编辑。请只返回 JSON，不要返回解释。',
      '',
      '你会收到一篇文章和一组已存在的 imagePlan 草案。',
      '请只优化 renderMode=ai 的 prompt 和 caption，保留 slotId，不要新增或删除项目。',
      'caption 要简短中文，prompt 要适合写实科技类或内容型封面，不要有英文大字，不要水印。',
      '',
      '返回格式：',
      '{"items":[{"slotId":"cover","prompt":"...","caption":"..."}]}',
      '',
      `文章标题：${articleTitle}`,
      `文章摘要：${articleBody.slice(0, 1200)}`,
      `草案：${JSON.stringify(aiItems.map((item) => ({ slotId: item.slotId, prompt: item.prompt, caption: item.caption, sectionTitle: item.sectionTitle })))}`,
    ].join('\n')

    const result = await agent.run(task, {
      temperature: 0.3,
      maxTokens: 2400,
      systemPrompt: '你只输出合法 JSON。',
    })

    const parsed = parseJsonObject<{ items?: Array<{ slotId: string; prompt?: string; caption?: string }> }>(result.output)
    if (!parsed?.items?.length) {
      return rulePlan
    }

    const patchMap = new Map(parsed.items.map((item) => [item.slotId, item]))
    return {
      ...rulePlan,
      cover: rulePlan.cover
        ? {
            ...rulePlan.cover,
            prompt: patchMap.get(rulePlan.cover.slotId)?.prompt?.trim() || rulePlan.cover.prompt,
            caption: patchMap.get(rulePlan.cover.slotId)?.caption?.trim() || rulePlan.cover.caption,
          }
        : undefined,
      items: rulePlan.items.map((item) => ({
        ...item,
        prompt: patchMap.get(item.slotId)?.prompt?.trim() || item.prompt,
        caption: patchMap.get(item.slotId)?.caption?.trim() || item.caption,
      })),
    }
  } catch (error) {
    console.warn(`[ImageAgent] Prompt enrichment skipped: ${error instanceof Error ? error.message : String(error)}`)
    return rulePlan
  }
}

async function materializeImagePlan(plan: ImagePlan, apiKey: string | undefined): Promise<GeneratedImageAsset[]> {
  const results: GeneratedImageAsset[] = []

  for (const item of listImagePlanItems(plan)) {
    if (item.renderMode === 'template') {
      const templateAsset = await materializeTemplateItem(item, plan.themeId)
      results.push(templateAsset)
      continue
    }

    const aiAsset = await materializeAiItem(item, apiKey, plan.themeId)
    results.push(aiAsset)
  }

  return results
}

async function materializeAiItem(
  item: ImagePlanItem,
  apiKey: string | undefined,
  themeId: WechatLayoutConfig['themeId'],
): Promise<GeneratedImageAsset> {
  if (!apiKey || apiKey.trim() === '') {
    console.warn(`[ImageAgent] MiniMax API key is missing, using template fallback for ${item.slotId}.`)
    return materializeTemplateItem(
      {
        ...item,
        imageType: item.imageType === 'cover-hero' ? 'cover-hero' : 'section-card',
        renderMode: 'template',
        coverMode: item.imageType === 'cover-hero' ? 'template' : item.coverMode,
        caption: `${item.sectionTitle || item.alt}｜模板降级`,
      },
      themeId ?? 'wechat-pro',
      'MiniMax API key is missing',
    )
  }

  const generated = await generateImageWithFallback(apiKey, {
    prompt: item.prompt,
    aspectRatio: item.aspectRatio,
    responseFormat: 'base64',
  })

  if (generated.imageBase64) {
    return {
      slotId: item.slotId,
      marker: item.marker,
      alt: item.alt,
      caption: item.caption,
      imageType: item.imageType,
      renderMode: item.renderMode,
      coverMode: item.coverMode,
      mimeType: 'image/jpeg',
      imageBase64: generated.imageBase64,
      sourcePrompt: item.prompt,
      qualityStatus: 'passed',
    }
  }

  console.warn(`[ImageAgent] AI image failed for ${item.slotId}, falling back to template card.`)
  return materializeTemplateItem(
    {
      ...item,
      imageType: item.slotId === 'cover' ? 'cover-hero' : 'section-card',
      renderMode: 'template',
      coverMode: item.slotId === 'cover' ? 'template' : item.coverMode,
      caption: `${item.sectionTitle || item.alt}｜自动降级卡片`,
    },
    themeId ?? 'wechat-pro',
    'AI image generation failed',
  )
}

async function materializeTemplateItem(
  item: ImagePlanItem,
  themeId: WechatLayoutConfig['themeId'],
  fallbackReason?: string,
): Promise<GeneratedImageAsset> {
  const rendered = await renderTemplateImage(item, themeId ?? 'wechat-pro')
  return {
    slotId: item.slotId,
    marker: item.marker,
    alt: item.alt,
    caption: item.caption,
    imageType: item.imageType,
    renderMode: item.renderMode,
    coverMode: item.coverMode,
    mimeType: rendered.mimeType,
    imageBase64: rendered.imageBase64,
    width: rendered.width,
    height: rendered.height,
    sourcePrompt: item.prompt,
    qualityStatus: fallbackReason ? 'downgraded' : 'passed',
    fallbackReason,
  }
}

function parseJsonObject<T>(value: string): T | null {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]+?)```/)
  const candidate = fencedMatch?.[1] ?? value
  const objectMatch = candidate.match(/\{[\s\S]+\}/)
  const jsonText = objectMatch?.[0] ?? candidate
  try {
    return JSON.parse(jsonText) as T
  } catch {
    return null
  }
}
