import { createAgentProvider, type ModelConfig } from '@/lib/ai'
import { BaseAgent } from './base'
import { createGenerateImageTool, generatedImagesStore } from '@/tools/generate-image'

export interface ImageSuggestion {
  location: string
  description: string
  reason: string
}

export interface ImageAgentResult {
  imagePlaceholders: Array<{
    marker: string
    imageBase64: string
    alt: string
    caption: string
  }>
}

// Style presets for consistent visual language
const STYLE_PRESETS = {
  TECH: 'photorealistic, cinematic lighting, high contrast, sharp focus, global illumination',
  MODERN: 'minimalist modern aesthetic, soft ambient light, clean composition, 8k quality, studio photography',
  DYNAMIC: 'action photography style, motion blur, dramatic rim lighting, gritty realism',
}

// Aspect ratio assignment per image role
const ASPECT_RATIOS = {
  COVER: '16:9',   // Article cover / hero image
  INLINE: '4:3',    // Inline illustration within article body
}

// Few-shot examples with style and aspect ratio guidance
const IMG_PROMPT_EXAMPLES = [
  '',
  '## 配图 Prompt 示例（封面图 16:9 — 开篇 Hook）',
  'Prompt: Futuristic Shanghai skyline at blue hour, holographic AI data streams cascading between skyscrapers, autonomous drone swarm flying through the city, lens flare and volumetric light rays, ' + STYLE_PRESETS.TECH + ', no text, 16:9',
  '',
  '## 配图 Prompt 示例（章节配图 4:3 — 文中插图）',
  'Prompt: Close-up of advanced AI chip circuitry under electron microscope, iridescent copper traces and golden solder points, shallow depth of field, ' + STYLE_PRESETS.MODERN + ', no text, 4:3',
  '',
  '## 配图 Prompt 示例（数据/对比图 4:3）',
  'Prompt: Split screen: elderly Chinese factory worker on left reviewing handwritten notes, young engineer on right controlling robotic arm via tablet, warm vs cool tone contrast, ' + STYLE_PRESETS.DYNAMIC + ', cinematic composition, no text, 4:3',
  '',
  '## 配图 Prompt 示例（人物场景 16:9）',
  'Prompt: Young Chinese AI researcher in a modern lab, neural network visualization screens reflecting on her glasses, purple and blue accent lighting, ' + STYLE_PRESETS.MODERN + ', confident expression, no text, 16:9',
].join('\n')

const SYSTEM_PROMPT = [
  '你是「科技猫」公众号的资深配图编辑，为科技/AI类文章设计高质量配图方案。',
  '品牌调性：科技感、写实摄影、有画面张力。不要抽象概念图，要具象有冲击力的视觉。',
  '',
  '## 风格预设（可组合使用）',
  `TECH:   ${STYLE_PRESETS.TECH}`,
  `MODERN: ${STYLE_PRESETS.MODERN}`,
  `DYNAMIC: ${STYLE_PRESETS.DYNAMIC}`,
  '',
  '## 图片比例规则',
  `封面图（文章顶部第一张）：${ASPECT_RATIOS.COVER}，强调大气、冲击力`,
  `文中插图（每个章节）：${ASPECT_RATIOS.INLINE}，强调细节、可读性`,
  '',
  '## 工作流程',
  '',
  '1. 分析文章：识别标题关键词情感 + 3-4 个关键章节',
  '2. 封面图 Prompt：以文章标题核心词为中心，构造宏大场景，增强视觉冲击力',
  '   例如：标题含"AI芯片"→ 芯片微观+宏观城市结合画面',
  '3. 章节配图 Prompt：紧扣章节主题，融入科技元素，用 ${STYLE_PRESETS.MODERN} 风格',
  '4. 调用 generate_image 工具生成，传入对应 aspectRatio：封面用 16:9，章节用 4:3',
  '5. 嵌入文章：在配图位置插入 __IMG_ID_X__ 占位符标记',
  '',
  '## 配图数量',
  '一篇 2000 字文章：封面 1 张（16:9）+ 章节 2-3 张（4:3），共 3-4 张',
  '',
  '## 图片 Prompt 规范',
  IMG_PROMPT_EXAMPLES,
  '',
  '禁止：人脸特写、文字图表、过于抽象的纯概念图',
  '推荐：AI芯片、服务器机房、办公场景、产品展示、数据可视化',
  '',
  '## 输出格式',
  '',
  '分析完成后，先描述配图计划（标注每张图的 role + aspect ratio），然后逐个调用工具生成。',
  '每张配图生成后，用 __IMG_ID_X__ 占位符标记（X 是工具返回的 imageIds 中的值）。',
  '示例：__IMG_ID_IMG_0__',
  '生成完整后，输出"配图完成：X 张图片已生成"。',
].join('\n')

export async function runImageAgent(
  articleTitle: string,
  articleBody: string,
  apiKey: string,
  modelConfig: ModelConfig,
): Promise<ImageAgentResult> {
  // Clear store at function scope to avoid stale image data from previous runs
  generatedImagesStore.clear()

  const provider = createAgentProvider('image', modelConfig)

  const agent = new BaseAgent(provider, { maxSteps: 12 })
  agent.registerTool(createGenerateImageTool(apiKey))

  const task = [
    '请为以下微信公众号文章设计并生成配图。',
    '',
    '## 文章标题',
    articleTitle,
    '',
    '## 文章正文',
    articleBody.slice(0, 2000),
    '',
    '## 要求',
    '1. 分析文章标题和结构，确定 1 个封面位置 + 2-3 个章节位置',
    '2. 为封面图写一个有视觉冲击力的 Prompt（16:9），突出文章核心概念',
    '3. 为每个章节图写一个细节丰富的 Prompt（4:3），紧扣章节主题',
    '4. 调用 generate_image 工具生成图片，传入正确的 aspectRatio：',
    '   - 封面/开篇图：aspectRatio="16:9"',
    '   - 章节插图：aspectRatio="4:3"',
    '5. 在配图位置用 __IMG_ID_X__ 占位符替换（X 为 imageIds 中的值），',
    '   例如：__IMG_ID_IMG_0__',
    '   不要用 ![描述](data:image/jpeg;base64,...) 格式',
    '6. 总结：配图完成：X 张图片已生成（含封面 N 张，章节 M 张）',
  ].join('\n')

  const result = await agent.run(task, {
    temperature: 0.4,
    maxTokens: 8000,
    systemPrompt: SYSTEM_PROMPT,
  })

  const placeholders = extractImagePlaceholders(result.output)

  // Validate: count ![...](cover) placeholders in the original article body
  const expectedCount = (articleBody.match(/!\[[^\]]*\]\(cover\)/g) ?? []).length
  if (expectedCount > 0 && placeholders.length < expectedCount) {
    console.warn(
      `[ImageAgent] Generated ${placeholders.length} images but article has ${expectedCount} placeholders. Some placeholders will remain unreplaced.`,
    )
  }

  return { imagePlaceholders: placeholders }
}

function extractImagePlaceholders(
  output: string,
): Array<{ marker: string; imageBase64: string; alt: string; caption: string }> {
  const results: Array<{ marker: string; imageBase64: string; alt: string; caption: string }> = []

  // Match __IMG_ID_X__ markers (base64 stored in tool's generatedImagesStore)
  // Use [a-zA-Z0-9_]+ instead of \w+ to avoid matching Chinese alt text as IDs.
  const idRegex = /__IMG_ID_([a-zA-Z0-9_]+)__/g
  let match
  const seenIds = new Set<string>()

  while ((match = idRegex.exec(output)) !== null) {
    const imgId = match[1]
    if (seenIds.has(imgId)) continue
    seenIds.add(imgId)

    const imageBase64 = generatedImagesStore.get(imgId)
    if (!imageBase64) continue

    const marker = match[0]
    const caption = imgId
    const alt = `配图 ${results.length + 1}`

    results.push({ marker, imageBase64, alt, caption })
  }

  // Also match inline ![alt](data:image/jpeg;base64,xxx) patterns (fallback)
  const inlineRegex = /!\[([^\]]*)\]\(data:image\/jpeg;base64,([^)]+)\)/g
  while ((match = inlineRegex.exec(output)) !== null) {
    const alt = match[1]?.trim() || '配图'
    const imageBase64 = match[2]
    const marker = match[0]
    results.push({ marker, imageBase64, alt, caption: alt })
  }

  return results
}
