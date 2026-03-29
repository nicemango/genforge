/**
 * 春天主题壁纸批量生成脚本
 * 使用 MiniMax image-01 模型生成各种风格的春天壁纸
 *
 * 用法:
 *   npx tsx scripts/spring-wallpaper.ts
 *   npx tsx scripts/spring-wallpaper.ts --output ./wallpapers/
 *   npx tsx scripts/spring-wallpaper.ts --aspect 9:16 --count 3
 *
 * 输出目录: 默认 ./outputs/spring-wallpapers/
 */

import { parseArgs } from 'util'
import { generateImages } from '../src/lib/minimax-image'
import * as fs from 'fs/promises'
import * as path from 'path'

const DEFAULT_MODEL = 'image-01'
const DEFAULT_ASPECT = '9:16' // 小红书/手机壁纸常用比例
const DEFAULT_OUTPUT = './outputs/spring-wallpapers/'
const DEFAULT_COUNT = 2 // 每个主题生成的数量

const SPRING_THEMES = [
  // 樱花主题
  {
    name: 'sakura_pink',
    prompt: 'Beautiful cherry blossom (sakura) wallpaper, soft pink petals falling gently, spring morning light, Japanese aesthetic, dreamy atmosphere, ultra detailed, 4K',
  },
  {
    name: 'sakura_pink_2',
    prompt: 'Cherry blossom branch with delicate pink flowers, morning dew on petals, soft bokeh background, warm spring sunlight, elegant and peaceful, high quality wallpaper',
  },
  // 油菜花田
  {
    name: 'canola_field',
    prompt: 'Vast golden canola flower field in spring, blue sky with fluffy clouds, warm sunlight, pastoral scenery, Chinese countryside style, expansive perspective, beautiful wallpaper composition',
  },
  {
    name: 'canola_field_2',
    prompt: 'Close-up of vibrant yellow rapeseed flowers, honeybees collecting pollen, morning mist, golden hour lighting, macro photography style, spring countryside beauty',
  },
  // 桃花
  {
    name: 'peach_blossom',
    prompt: 'Romantic peach blossoms (tao hua) in full bloom, soft pink and white petals, traditional Chinese garden background, spring sunshine, poetic and dreamy atmosphere, wallpaper quality',
  },
  {
    name: 'peach_blossom_2',
    prompt: 'Peach blossom branch against soft gradient sky, delicate flowers with dew drops, minimalist composition, serene spring mood, elegant Chinese painting style influence',
  },
  // 嫩叶新芽
  {
    name: 'fresh_greens',
    prompt: 'Fresh green leaves and tender sprouts in spring, morning dew on foliage, soft natural lighting, growth and renewal concept, calming nature wallpaper, detailed macro shot',
  },
  {
    name: 'fresh_greens_2',
    prompt: 'Cascade of green leaves with soft spring backlight, translucent leaves showing veins, peaceful forest ambiance, fresh and invigorating spring atmosphere, high resolution',
  },
  // 春天风景
  {
    name: 'spring_meadow',
    prompt: 'Lush green meadow with wildflowers in spring, gentle rolling hills, blue sky with white clouds, butterflies fluttering, idyllic countryside landscape, peaceful and harmonious',
  },
  {
    name: 'spring_meadow_2',
    prompt: 'Sunny spring grassland with colorful wildflowers, a winding path through the meadow, warm golden hour lighting, pastoral tranquility, beautiful landscape wallpaper',
  },
  // 郁金香
  {
    name: 'tulip_garden',
    prompt: 'Garden filled with colorful tulips in full bloom, red yellow pink purple flowers, Dutch spring garden style, bright sunny day, cheerful and vibrant wallpaper composition',
  },
  {
    name: 'tulip_garden_2',
    prompt: 'Field of blooming tulips from a low angle perspective, blue sky backdrop, vivid colors reflecting spring joy, windmill in distant background, postcard perfect scenery',
  },
  // 紫藤花
  {
    name: 'wisteria',
    prompt: 'Elegant purple wisteria (liu hua) hanging from pergola, cascading flower clusters, Japanese garden atmosphere, soft diffused light, romantic and dreamy spring scene',
  },
  {
    name: 'wisteria_2',
    prompt: 'Close-up of delicate wisteria flowers, purple and blue gradient petals, raindrops on flowers, moody spring atmosphere, artistic macro photography, elegant wallpaper',
  },
  // 春天小雨
  {
    name: 'spring_rain',
    prompt: 'Spring rain scene with cherry petals on wet ground, gentle raindrops creating ripples in puddles, soft overcast lighting, melancholic yet beautiful spring mood, cinematic',
  },
  {
    name: 'spring_rain_2',
    prompt: 'Rainy spring morning in a quiet alley, fresh green plants on both sides, droplets on leaves, cozy and contemplative atmosphere, soft natural colors, peaceful wallpaper',
  },
  // 蝴蝶花
  {
    name: 'butterfly_meadow',
    prompt: 'Colorful butterflies hovering over spring flowers, monarch butterflies and various species, meadow in full bloom, magical fairy-tale atmosphere, enchanting spring moment',
  },
  {
    name: 'butterfly_meadow_2',
    prompt: 'Elegant butterfly with spread wings on a flower, macro photography style, dew on wings, spring garden background, miniature world perspective, stunning detail',
  },
  // 柳树
  {
    name: 'willow_spring',
    prompt: 'Graceful weeping willow trees by lake in early spring, fresh green young leaves, soft misty atmosphere, Chinese classical garden style, tranquil and poetic scenery',
  },
  {
    name: 'willow_spring_2',
    prompt: 'Willow branches swaying gently by the water, tender green leaves backlit by afternoon sun, reflection in calm lake, serene spring landscape, elegant wallpaper',
  },
  // 田园风
  {
    name: 'countryside_spring',
    prompt: 'Chinese rural village in spring, white walls with tiled roofs, blooming flowers in foreground, green fields beyond, peaceful countryside life, warm nostalgic atmosphere',
  },
  {
    name: 'countryside_spring_2',
    prompt: 'Country road lined with trees in spring, new leaves creating canopy overhead, golden sunlight filtering through, peaceful journey atmosphere, beautiful wallpaper composition',
  },
  // 玉兰花
  {
    name: 'magnolia',
    prompt: 'Magnificent magnolia flowers (yu lan) in full bloom, large white and pink petals, elegant and noble presence, classical Chinese aesthetic, refined spring beauty, detailed wallpaper',
  },
  {
    name: 'magnolia_2',
    prompt: 'Magnolia branch against soft blue sky, delicate flowers with perfect form, minimalist composition, sophisticated and elegant atmosphere, artistic photography style',
  },
  // 雏菊野花
  {
    name: 'daisy_field',
    prompt: 'Field of cheerful daisies and wildflowers, white yellow pink blooms, sunny spring day, carefree and joyful atmosphere, meadow as far as eye can see, fresh and uplifting wallpaper',
  },
  {
    name: 'daisy_field_2',
    prompt: 'Close-up of daisy flowers swaying in gentle breeze, soft focus background of more flowers, butterflies visiting, simple yet beautiful spring moment, warm lighting',
  },
  // 春天日落
  {
    name: 'spring_sunset',
    prompt: 'Beautiful spring sunset over flower fields, golden orange pink sky, silhouetted flowers in foreground, peaceful ending of spring day, warm romantic atmosphere, cinematic wallpaper',
  },
  {
    name: 'spring_sunset_2',
    prompt: 'Sunrise over spring landscape, soft pink and orange dawn colors, mist rising from meadows, birds flying in formation, new day beginning, hopeful spring mood, serene beauty',
  },
  // 薰衣草（春天版）
  {
    name: 'lavender_spring',
    prompt: 'Rows of fresh green lavender plants in spring, purple buds just beginning to bloom, Provence style field, soft afternoon light, fragrant and peaceful, beautiful wallpaper',
  },
  {
    name: 'lavender_spring_2',
    prompt: 'Close-up of young lavender stems with green leaves and early purple buds, morning dew, soft spring colors, aromatic spring garden, refreshing and calming, macro detail',
  },
]

async function main() {
  const args = parseArgs({
    options: {
      output: { type: 'string', short: 'o', default: DEFAULT_OUTPUT },
      aspect: { type: 'string', short: 'a', default: DEFAULT_ASPECT },
      count: { type: 'string', short: 'c', default: DEFAULT_COUNT.toString() },
      'api-key': { type: 'string' },
    },
  })

  const apiKey = args.values['api-key'] as string | undefined ?? process.env.MINIMAX_API_KEY
  if (!apiKey) {
    console.error('MINIMAX_API_KEY')
    console.error('  .env  --api-key')
    process.exit(1)
  }

  const outputDir = args.values.output as string
  const aspectRatio = args.values.aspect as string
  const count = Math.min(Math.max(Number(args.values.count), 1), 4)

  // 创建输出目录
  await fs.mkdir(outputDir, { recursive: true })
  console.log(`\n🌸 Spring Wallpaper Generator`)
  console.log(`   : ${outputDir}`)
  console.log(`   : ${aspectRatio}`)
  console.log(`   : ${count}`)
  console.log(`   : ${SPRING_THEMES.length}`)
  console.log()

  let successCount = 0
  let failCount = 0

  for (const theme of SPRING_THEMES) {
    console.log(`🎨 ${theme.name}...`)

    try {
      const result = await generateImages(apiKey, {
        prompt: theme.prompt,
        model: DEFAULT_MODEL,
        aspectRatio,
        responseFormat: 'base64',
        n: count,
      })

      for (let i = 0; i < result.images.length; i++) {
        const imageBase64 = result.images[i]
        const extension = 'jpg'
        const outputFile = path.join(outputDir, `${theme.name}_${i + 1}.${extension}`)

        const buffer = Buffer.from(imageBase64, 'base64')
        await fs.writeFile(outputFile, buffer)

        const sizeKB = (buffer.length / 1024).toFixed(1)
        console.log(`   ✅ ${theme.name}_${i + 1}.${extension} (${sizeKB}KB)`)
      }

      successCount++
    } catch (err) {
      console.log(`   ❌ ${theme.name}: ${err instanceof Error ? err.message : String(err)}`)
      failCount++
    }

    // 避免API限流
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log(`\n📊 : ${successCount}/${SPRING_THEMES.length}`)
  console.log(`   ✅ : ${successCount}`)
  console.log(`   ❌ : ${failCount}`)
  console.log(`   📁 : ${outputDir}`)
}

main()
