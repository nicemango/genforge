import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { runImageAgent } from '@/agents/image'
import type { GeneratedImageAsset } from '@/lib/image-plan'
import { parseModelConfig, parseWechatConfig, parseWritingStyle } from '@/lib/json'
import { getDefaultModelConfig } from '@/config/llm'

async function main() {
  const contentId = process.argv[2]
  const outputDir = process.argv[3] || '/tmp/content-center-exported-images'
  if (!contentId) {
    throw new Error('Usage: pnpm exec tsx scripts/export-content-images.ts <contentId> [outputDir]')
  }

  const content = await prisma.content.findUniqueOrThrow({
    where: { id: contentId },
    include: { account: true },
  })

  const parsedModel = parseModelConfig(content.account.modelConfig)
  const modelConfig = parsedModel.apiKey
    ? parsedModel
    : { ...getDefaultModelConfig(), minimaxApiKey: parsedModel.minimaxApiKey }

  const writingStyle = parseWritingStyle(content.account.writingStyle)
  const wechatConfig = parseWechatConfig(content.account.wechatConfig)
  const bodyWithPlaceholders = restoreImagePlaceholders(content.body, content.images)

  const result = await runImageAgent(
    content.title,
    bodyWithPlaceholders,
    modelConfig.minimaxApiKey ?? process.env.MINIMAX_API_KEY ?? undefined,
    modelConfig,
    {
      writingStyle,
      layoutConfig: {
        themeId: wechatConfig.themeId,
        brandName: wechatConfig.brandName ?? writingStyle.brandName,
        primaryColor: wechatConfig.primaryColor,
        accentColor: wechatConfig.accentColor,
        titleAlign: wechatConfig.titleAlign,
        showEndingCard: wechatConfig.showEndingCard,
        endingCardText: wechatConfig.endingCardText,
        imageStyle: wechatConfig.imageStyle,
      },
    },
  )

  await mkdir(outputDir, { recursive: true })

  const exported: Array<{ slotId: string; path: string }> = []
  for (const asset of result.assets) {
    if (!asset.imageBase64) continue
    const ext = asset.mimeType === 'image/png' ? 'png' : 'jpg'
    const path = join(outputDir, `${asset.slotId}.${ext}`)
    await writeFile(path, Buffer.from(asset.imageBase64, 'base64'))
    exported.push({ slotId: asset.slotId, path })
  }

  console.log(JSON.stringify({ contentId, outputDir, exported }, null, 2))
}

function restoreImagePlaceholders(body: string, imagesJson: string | null): string {
  const assets = parseStoredImages(imagesJson)
  if (assets.length === 0) return body

  let restored = body
  for (const asset of assets) {
    if (!asset.marker || !asset.url) continue
    const exact = `![${asset.alt}](${asset.url})`
    if (restored.includes(exact)) {
      restored = restored.replace(exact, asset.marker)
      continue
    }
    const pattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(asset.url)}\\)`, 'g')
    restored = restored.replace(pattern, asset.marker)
  }
  return restored
}

function parseStoredImages(imagesJson: string | null): GeneratedImageAsset[] {
  if (!imagesJson) return []
  try {
    const parsed = JSON.parse(imagesJson)
    return Array.isArray(parsed) ? (parsed as GeneratedImageAsset[]) : []
  } catch {
    return []
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
