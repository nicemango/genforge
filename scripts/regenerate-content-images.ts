import { prisma } from '@/lib/prisma'
import { runImageAgent } from '@/agents/image'
import { replaceImageSlots, type GeneratedImageAsset } from '@/lib/image-plan'
import { uploadImage } from '@/lib/wechat'
import { parseModelConfig, parseWechatConfig, parseWritingStyle } from '@/lib/json'
import { getDefaultModelConfig } from '@/config/llm'

async function main() {
  const contentId = process.argv[2]
  if (!contentId) {
    throw new Error('Usage: pnpm exec tsx scripts/regenerate-content-images.ts <contentId>')
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

  const assets = await Promise.all(
    result.assets.map(async (asset) => {
      if (!asset.imageBase64) {
        return { ...asset, uploadStatus: 'failed' as const }
      }
      try {
        const url = await uploadImage(content.accountId, asset.imageBase64)
        return { ...asset, url, uploadStatus: 'uploaded' as const }
      } catch {
        return {
          ...asset,
          url: `data:${asset.mimeType};base64,${asset.imageBase64}`,
          uploadStatus: 'inline' as const,
        }
      }
    }),
  )

  const updatedBody = replaceImageSlots(bodyWithPlaceholders, assets)
  await prisma.content.update({
    where: { id: content.id },
    data: {
      body: updatedBody,
      images: JSON.stringify(assets),
    },
  })

  console.log(
    JSON.stringify(
      {
        contentId: content.id,
        imageCount: assets.length,
        uploads: assets.map((asset) => ({
          slotId: asset.slotId,
          uploadStatus: asset.uploadStatus,
          url: String(asset.url || '').slice(0, 120),
        })),
      },
      null,
      2,
    ),
  )
}

function restoreImagePlaceholders(body: string, imagesJson: string | null): string {
  const assets = parseStoredImages(imagesJson)
  if (assets.length === 0) return body

  let restored = body
  for (const asset of assets) {
    if (!asset.marker) continue

    if (asset.url) {
      const exact = `![${asset.alt}](${asset.url})`
      if (restored.includes(exact)) {
        restored = restored.replace(exact, asset.marker)
        continue
      }

      const pattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(asset.url)}\\)`, 'g')
      restored = restored.replace(pattern, asset.marker)
    }
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
