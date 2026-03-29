/**
 * MiniMax Image Generation 图片生成脚本
 * 使用 MiniMax image-01 模型生成图片
 *
 * 用法:
 *   npx tsx scripts/minimax-image.ts --prompt "未来城市，赛博朋克风格"
 *   npx tsx scripts/minimax-image.ts --prompt "一只可爱的猫" --aspect 1:1 --output ./cat.png
 *   npx tsx scripts/minimax-image.ts --prompt "科技感背景" --n 4 --output ./imgs/
 */

import { parseArgs } from 'util'
import { generateImages } from '../src/lib/minimax-image'

const DEFAULT_MODEL = 'image-01'
const DEFAULT_ASPECT = '16:9'
const SUPPORTED_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4']

async function main() {
  const args = parseArgs({
    options: {
      prompt: { type: 'string', short: 'p' },
      output: { type: 'string', short: 'o', default: './generated_image.png' },
      aspect: { type: 'string', short: 'a', default: DEFAULT_ASPECT },
      model: { type: 'string', short: 'm', default: DEFAULT_MODEL },
      n: { type: 'string', short: 'n', default: '1' },
      'api-key': { type: 'string' },
    },
  })

  const prompt = args.values.prompt as string | undefined

  if (!prompt?.trim()) {
    console.error('❌ 请提供 --prompt 参数')
    console.error('   npx tsx scripts/minimax-image.ts --prompt "一只可爱的猫"')
    process.exit(1)
  }

  const apiKey = args.values['api-key'] as string | undefined ?? process.env.MINIMAX_API_KEY
  if (!apiKey) {
    console.error('❌ 未设置 MINIMAX_API_KEY')
    console.error('   请在 .env 文件中设置或使用 --api-key 参数')
    process.exit(1)
  }

  const aspectRatio = args.values.aspect as string
  const n = Math.min(Number(args.values.n), 4)
  const outputPath = args.values.output as string

  if (!SUPPORTED_RATIOS.includes(aspectRatio)) {
    console.error(`❌ 不支持的宽高比: ${aspectRatio}`)
    console.error(`   支持: ${SUPPORTED_RATIOS.join(', ')}`)
    process.exit(1)
  }

  console.log(`\n🎨 MiniMax 图片生成中...`)
  console.log(`   模型: ${args.values.model}`)
  console.log(`   prompt: ${prompt}`)
  console.log(`   宽高比: ${aspectRatio}`)
  console.log(`   数量: ${n}`)
  console.log()

  const startTime = Date.now()

  try {
    const result = await generateImages(apiKey, {
      prompt,
      model: args.values.model as string,
      aspectRatio,
      responseFormat: 'base64',
      n,
    })

    const duration = Date.now() - startTime

    // 保存图片
    const fs = await import('fs/promises')

    for (let i = 0; i < result.images.length; i++) {
      const imageBase64 = result.images[i]
      const extension = outputPath.endsWith('.png') ? 'png' : 'jpg'
      const outputFile = n === 1
        ? outputPath
        : outputPath.replace(/(\.[^.]+)$/, `_${i + 1}$1`)

      const buffer = Buffer.from(imageBase64, 'base64')
      await fs.writeFile(outputFile, buffer)
      console.log(`✅ 图片 ${i + 1} 生成成功 (${duration}ms)`)
      console.log(`   文件: ${outputFile}`)
      console.log(`   大小: ${(buffer.length / 1024).toFixed(2)} KB`)
    }

    console.log(`\n📋 traceId: ${result.id}`)
  } catch (err) {
    console.error(`\n❌ 图片生成失败`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
