import { createAgentProvider, type ChatResponse, type ModelConfig } from '@/lib/ai'
import type { TrendItem } from './trend'
import { loadTopicConfig, type TopicAgentConfig } from '@/lib/topic-config'

export interface TopicSuggestion {
  title: string
  angle: string
  summary: string
  heatScore: number
  tags: string[]
  sources: Array<{ title: string; url: string; source: string }>
}

export interface TopicAgentResult {
  topics: TopicSuggestion[]
}

// ============================================================
// System Prompt
// ============================================================
const SYSTEM_PROMPT_LINES = [
  '你是一位资深的「科技猫」公众号内容策划编辑，专攻 AI、科技、互联网领域。',
  '',
  '「科技猫」的品牌调性：犀利有观点，敢下判断，有温度也有锋芒。',
  '读者是有独立思考能力的科技爱好者，不喜欢被喂鸡汤、不喜欢标题党。',
  '',
  '你的任务：从提供的热点资讯中，筛选并改写为符合「科技猫」风格的高质量选题。',
  '',
  '【angle 质量标准 - 必须逐条检查】',
  '1. angle 必须是一句"让人想反驳"或"颠覆认知"的话',
  '2. angle 必须包含具体数据或具体公司/产品',
  '3. 禁止：描述性 angle（如"从XX财报看XX趋势"、"XX行业分析"）',
  '4. 好的 angle 示例：',
  '   - "宇树60%毛利率背后，是中国机器人供应链对全球的降维打击"',
  '   - "GitHub Copilot 让程序员效率提升50%，但代价是让你的代码越来越像拼装货"',
  '5. 坏的 angle 示例（直接淘汰）：',
  '   - "从XX公司财报看行业发展趋势"',
  '   - "深度解读XX报告的产业洞察"',
  '   - "XX产品的功能评测与使用体验"',
  '   - "AI在XX领域的应用前景"',
  '',
  '【事实锚点验证 - 每个选题必须包含】',
  '1. 至少 1 个具体数据点（公司名+数字/百分比）',
  '2. 至少 1 个具体公司/产品名',
  '3. 至少 1 个可验证的来源 URL',
  '无上述三点的选题直接淘汰',
  '',
  '【heatScore 评分标准】',
  '9-10分：强事件驱动（融资/收购/爆雷/重磅发布），且 angle 锐利',
  '7-8分：有具体数据支撑，且 angle 有一定洞察',
  '5-6分：有话题性，但缺乏具体数据和锐利角度',
  '低于5分：直接淘汰（泛泛而谈，无数据支撑）',
  '',
  '【标题质量标准】',
  '合格标题：',
  '  - 有认知落差（对比/反常识/数字）',
  '  - 非关键词堆砌',
  '不合格标题直接淘汰：',
  '  - "XX行业分析报告"',
  '  - "深度解读XX"',
  '  - "一文读懂XX"',
  '  - 震惊体、UC风、标题党',
  '',
  '【写作可行性】',
  '必须能支撑 2000-2800 字的深度内容。三句话能说清楚的话题不要。',
  '',
  '【受众价值】',
  '读者读完能得到什么？是新认知？决策参考？还是行动指引？',
  '没有受众价值的纯信息罗列直接淘汰。',
  '',
  '【本土视角】',
  '必须有中国市场的独特洞察。',
  '纯翻译海外资讯而无本土角度的直接淘汰。',
].join('\n')

// ============================================================
// Output format guide
// ============================================================
const OUTPUT_GUIDE_LINES = [
  '',
  '## 输出格式（严格按此结构，不要多一个字废话）',
  '',
  '直接输出 JSON，不要用 ```json 或任何 markdown 代码块包裹：',
  '  { "topics": [',
  '    {',
  '      "title": "中文标题，有认知落差/对比/反常识效果，禁止标题党",',
  '      "angle": "一句话锐利观点，30-60字，包含具体数据或具体公司名，表达文章核心结论而非描述性语句",',
  '      "summary": "读者价值，1-2句具体说明。禁止写这篇文章将/本文/本篇等元叙述",',
  '      "heatScore": 1-10整数，9分以上需强事件驱动+锐利angle，7-8分需具体数据，低于5分直接淘汰",',
  '      "tags": ["标签1", "标签2"]',
  '      "sources": [{ "title": "来源标题", "url": "可验证URL", "source": "来源名称" }]',
  '    }',
  '  ] }',
  '',
  '【严格检查清单 - 输出前逐项确认】',
  '□ angle 长度 15-80 字，不含"从XX看"、"深度解读"、"分析"、"行业趋势"、"前景展望"等描述性词汇',
  '□ angle 包含至少1个具体公司名/产品名或数字/百分比',
  '□ title 不含"一文读懂"、"深度解读"、"行业报告"等淘汰词',
  '□ summary 长度 >= 10 字，不含"本文"、"本篇"、"这篇文章"等元叙述',
  '□ sources 中每个 URL 可验证（非空字符串）',
  '□ heatScore 与 angle 锐度匹配（高分必须 angle 够锐）',
].join('\n')

// ============================================================
// JSON Repair Utilities
// ============================================================

/**
 * Safely fix common JSON issues (trailing commas, comments) without damaging
 * content inside string literals.
 */
function safeFixJSON(input: string): string {
  const result: string[] = []
  let inString = false
  let escape = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escape) {
      result.push(ch)
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      result.push(ch)
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      result.push(ch)
      continue
    }

    if (inString) {
      result.push(ch)
      continue
    }

    // Outside strings: skip // line comments
    if (ch === '/' && input[i + 1] === '/') {
      const eol = input.indexOf('\n', i)
      i = eol === -1 ? input.length - 1 : eol - 1
      continue
    }

    // Outside strings: skip /* block comments */
    if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2)
      i = end === -1 ? input.length - 1 : end + 1
      continue
    }

    // Outside strings: remove trailing commas before } or ]
    if (ch === ',') {
      // Look ahead past whitespace for } or ]
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j++
      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        continue // skip this comma
      }
    }

    result.push(ch)
  }

  return result.join('')
}

// ============================================================
// JSON Extraction
// ============================================================

/**
 * Robustly extract JSON from LLM response text.
 * Strategy: prefer code blocks, then bracket-match from first `{` or `[` to its balanced closing.
 */
function extractJSON(text: string): string {
  // 1. Try ```json ... ``` or ``` ... ``` code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch && codeBlockMatch[1]?.trim()) {
    return codeBlockMatch[1].trim()
  }

  // 2. Find balanced JSON structure starting from first `{` or `[`
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  let start = -1
  let openChar: string
  let closeChar: string

  if (firstBrace === -1 && firstBracket === -1) return text.trim()

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket
    openChar = '['
    closeChar = ']'
  } else {
    start = firstBrace
    openChar = '{'
    closeChar = '}'
  }

  // Walk forward to find balanced close
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === openChar || ch === '{' || ch === '[') depth++
    if (ch === closeChar || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  // Fallback: first open to last close
  const lastClose = text.lastIndexOf(closeChar)
  if (lastClose > start) {
    return text.slice(start, lastClose + 1)
  }

  return text.trim()
}

// ============================================================
// Topic Validation
// ============================================================

function clampHeatScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.round(Math.min(10, Math.max(1, value)))
}

function validateSource(source: unknown): { title: string; url: string; source: string } {
  if (!source || typeof source !== 'object') {
    return { title: '', url: '', source: '' }
  }
  const s = source as Record<string, unknown>
  return {
    title: typeof s.title === 'string' ? s.title.trim() : '',
    url: typeof s.url === 'string' ? s.url.trim() : '',
    source: typeof s.source === 'string' ? s.source.trim() : '',
  }
}

function validateTopic(topic: unknown, index: number): TopicSuggestion {
  if (!topic || typeof topic !== 'object') {
    throw new Error(`Topic at index ${index} is not a valid object.`)
  }

  const t = topic as Record<string, unknown>

  const title = typeof t.title === 'string' ? t.title.trim() : ''
  if (!title) {
    throw new Error(`Topic at index ${index} missing required field "title".`)
  }

  const angle = typeof t.angle === 'string' ? t.angle.trim() : ''

  // Validate angle quality
  if (!angle) {
    throw new Error(`Topic at index ${index} missing required field "angle".`)
  }

  // angle length: 15-80 chars (prompt says 30-60, use a slightly wider range)
  if (angle.length < 15) {
    throw new Error(
      `Topic at index ${index} eliminated: angle too short (${angle.length} chars, min 15). title: "${title}"`,
    )
  }
  if (angle.length > 80) {
    throw new Error(
      `Topic at index ${index} eliminated: angle too long (${angle.length} chars, max 80). title: "${title}"`,
    )
  }

  const badAnglePatterns = [
    /从[\u4e00-\u9fa5]{1,20}(?:财报|报告|数据)?看[\u4e00-\u9fa5]{2,}(?:趋势|发展|前景|格局)/, // "从XX看YY趋势"
    /深度解读[\u4e00-\u9fa5]/, // "深度解读XX"
    /(?:行业趋势|行业分析|应用前景|功能评测|使用体验)[:：\s]/, // 纯描述性短语
    /一文读懂/,
    /分析$/, // "XX分析" — 以分析结尾
    /(?:^|[\u4e00-\u9fa5])分析[:：\s]/, // "来分析XX"
    /(?:^|[\u4e00-\u9fa5])解读[:：\s]/,
    /前景展望$/,
    /趋势分析$/,
    /行业趋势/, // "XX行业趋势" — 中间出现
  ]

  for (const pattern of badAnglePatterns) {
    if (pattern.test(angle)) {
      throw new Error(
        `Topic at index ${index} eliminated: angle matches淘汰 pattern "${pattern}". angle: "${angle}"`,
      )
    }
  }

  // Validate title quality
  const badTitlePatterns = [
    /一文读懂/,
    /深度解读/,
    /行业分析报告/,
    /^XX/,
    /XX行业/,
  ]

  for (const pattern of badTitlePatterns) {
    if (pattern.test(title)) {
      throw new Error(
        `Topic at index ${index} eliminated: title matches淘汰 pattern "${pattern}". title: "${title}"`,
      )
    }
  }

  // Validate sources have valid URLs
  const sources = Array.isArray(t.sources) ? t.sources.map(validateSource) : []
  const hasValidSource = sources.some(
    (s) => s.url && s.url.startsWith('http') && s.url.length > 10,
  )
  if (!hasValidSource) {
    throw new Error(
      `Topic at index ${index} eliminated: no valid source URL. title: "${title}"`,
    )
  }

  // HeatScore must be >= 5
  const heatScore = clampHeatScore(t.heatScore)
  if (heatScore < 5) {
    throw new Error(
      `Topic at index ${index} eliminated: heatScore ${heatScore} below minimum 5. title: "${title}"`,
    )
  }

  const summary = typeof t.summary === 'string' ? t.summary.trim() : ''

  // summary must be non-empty and >= 10 chars
  if (summary.length < 10) {
    throw new Error(
      `Topic at index ${index} eliminated: summary too short (${summary.length} chars, min 10). title: "${title}"`,
    )
  }

  // summary must not contain meta-narrative phrases
  const metaPatterns = [/本文/, /本篇/, /这篇文章/, /本文将/, /本篇将/, /本报告/]
  for (const pattern of metaPatterns) {
    if (pattern.test(summary)) {
      throw new Error(
        `Topic at index ${index} eliminated: summary contains meta-narrative phrase matching "${pattern}". summary: "${summary}"`,
      )
    }
  }

  return {
    title,
    angle,
    summary,
    heatScore,
    tags: Array.isArray(t.tags) ? t.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    sources,
  }
}

export async function runTopicAgent(
  trendItems: TrendItem[],
  modelConfig: ModelConfig,
  options?: { count?: number; maxInputItems?: number },
): Promise<TopicAgentResult> {
  const baseConfig = loadTopicConfig()
  const cfg = {
    agent: {
      ...baseConfig.agent,
      ...options,
    },
  }
  if (cfg.agent.count < 1) cfg.agent.count = 1

  const provider = createAgentProvider('topic', modelConfig)

  const INPUT_ITEM_PREFIX = '---ITEM---'
  const INPUT_ITEM_SUFFIX = '---/ITEM---'
  const ctrlChars = /[\u0000-\u001F\u200B]/

  const clean = (s: string) =>
    String(s).replace(ctrlChars, '').replace(new RegExp(INPUT_ITEM_PREFIX + '|' + INPUT_ITEM_SUFFIX, 'g'), '')

  const itemsText = trendItems
    .slice(0, cfg.agent.maxInputItems)
    .map(
      (item, i) =>
        `${INPUT_ITEM_PREFIX}\n${i + 1}. [${clean(item.source)}] ${clean(item.title)}\n   链接: ${clean(item.link)}\n   时间: ${item.pubDate}\n   摘要: ${clean(item.snippet)}${INPUT_ITEM_SUFFIX}`,
    )
    .join('\n\n')

  const prompt = [
    '以下是最新的 AI/科技热点资讯（共 ' + Math.min(trendItems.length, cfg.agent.maxInputItems) + ' 条），',
    '请筛选出 ' + cfg.agent.count + ' 个最适合写成「科技猫」风格文章的选题。',
    '',
    OUTPUT_GUIDE_LINES,
    '',
    '## 待筛选的热点资讯',
    itemsText,
    '',
    '直接输出 JSON，不要有任何额外文字，不要用 markdown 代码块。',
  ].join('\n')

  const response: ChatResponse = await provider.chat(
    [{ role: 'user', content: prompt }],
    {
      temperature: cfg.agent.temperature,
      maxTokens: cfg.agent.maxTokens,
      systemPrompt: SYSTEM_PROMPT_LINES,
    },
  )

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')

  // Extract JSON with robust markdown code block and raw format support
  const jsonStr = extractJSON(text)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    // Safely remove trailing commas outside of string literals
    const fixed = safeFixJSON(jsonStr)
    try {
      parsed = JSON.parse(fixed)
    } catch {
      throw new Error('TopicAgent returned invalid JSON. Raw: ' + text.slice(0, 500))
    }
  }

  // Handle direct array response (LLM sometimes returns [{...}] instead of {topics: [{...}]})
  if (Array.isArray(parsed)) {
    parsed = { topics: parsed }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('TopicAgent returned non-object JSON. Raw: ' + text.slice(0, 500))
  }

  const result = parsed as Record<string, unknown>
  if (!Array.isArray(result.topics)) {
    throw new Error('TopicAgent JSON missing "topics" array. Raw: ' + text.slice(0, 500))
  }

  const validated: TopicSuggestion[] = []
  for (let i = 0; i < result.topics.length; i++) {
    try {
      const topic = validateTopic(result.topics[i], i)

      // Duplicate detection: reject if normalized title is a substring of an already-accepted one
      const normalized = (s: string) =>
        s.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')

      const dup = validated.find((v) => {
        const a = normalized(topic.title)
        const b = normalized(v.title)
        return a.includes(b) || b.includes(a)
      })

      if (dup) {
        console.warn(
          `[TopicAgent] skip topic[${i}] as duplicate of "${dup.title}": "${topic.title}"`,
        )
        continue
      }

      validated.push(topic)
      if (validated.length >= cfg.agent.count) break
    } catch (err) {
      console.warn(`[TopicAgent] skip topic[${i}]: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (validated.length === 0) {
    throw new Error(
      `TopicAgent: all ${result.topics.length} topics were eliminated by validation. ` +
      `LLM may have returned only low-quality angles. Check the raw LLM output.`,
    )
  }

  return { topics: validated }
}
