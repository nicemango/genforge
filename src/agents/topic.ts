import { createAgentProvider, type ChatResponse, type ModelConfig } from '@/lib/ai'
import type { TrendItem } from './trend'
import { loadTopicConfig } from '@/lib/topic-config'

export type RedSeaLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type TimeToMainstream = 'NOW' | 'WEEKS' | 'MONTHS'
export type TopicSelectionStrategy = 'VALUE_CREVASSE' | 'EARLY_SIGNAL' | 'CONTRARIAN'

export interface TopicSuggestion {
  title: string
  angle: string
  summary: string
  heatScore: number
  valueScore: number
  tags: string[]
  sources: Array<{ title: string; url: string; source: string }>
  redSeaLevel: RedSeaLevel
  contrarianAngle: string
  timeToMainstream: TimeToMainstream
}

export interface TopicAgentResult {
  topics: TopicSuggestion[]
  strategy: TopicSelectionStrategy
}

export type TopicSuggestionV2 = TopicSuggestion
export type TopicAgentV2Result = TopicAgentResult

const SYSTEM_PROMPT_LINES = [
  '你是一位资深的「科技猫」公众号内容策划编辑，专攻 AI、科技、互联网领域。',
  '',
  '你的核心任务：**从提供的热点资讯中，挖掘「价值洼地」**——',
  '即那些被低估、尚未被主流科技媒体广泛报道，但具有高潜在价值的话题。',
  '',
  '===========================================',
  '【核心理念：价值洼地】',
  '===========================================',
  '',
  '传统热点策略的问题：',
  '- 追逐 heatScore 9-10 的话题 → 已被36氪/虎嗅/极客公园广泛报道',
  '- 红海竞争 → 你的文章淹没在同类内容中',
  '- 读者已经看过3-5篇类似报道 → 审美疲劳',
  '',
  '价值洼地策略的核心：',
  '- 寻找 heatScore 5-7 但「认知差」很大的话题',
  '- 主流媒体的盲区：小众垂直领域、技术细节、反共识观点',
  '- 提前布局：现在不火，但2-4周后可能成为热点',
  '',
  '===========================================',
  '【信息来源解读 - 优先于一切判断】',
  '===========================================',
  '',
  '每条资讯的 [来源] 字段携带了结构化信息，直接决定 redSeaLevel 的基准：',
  '',
  '来源前缀为 "Twitter:" → 一手观点/从业者讨论，主流媒体尚未跟进',
  '  → redSeaLevel 基准：LOW，除非话题本身已烂大街',
  '',
  '来源前缀为 "GitHub:" → 技术圈早期动向，尚在开发者圈传播',
  '  → redSeaLevel 基准：LOW，这是价值洼地的最强信号',
  '',
  '来源为 36氪 / 虎嗅 / 极客公园 / 机器之心 / 量子位 等主流科技媒体',
  '  → 该话题已被主流媒体报道，redSeaLevel 基准：HIGH 或 MEDIUM',
  '  → 仍可选择，但必须找到这些报道「遗漏的视角」才能拿到 MEDIUM',
  '',
  '来源为 InfoQ / CSDN / 少数派 / 爱范儿 等垂直/社区媒体',
  '  → redSeaLevel 基准：MEDIUM',
  '',
  '规则：同一话题若同时出现 Twitter/GitHub 来源和主流媒体来源，',
  '说明已从「洼地」迁移到「黄海」，redSeaLevel 应上调为 MEDIUM。',
  '',
  '===========================================',
  '【红海检测 - 必须执行】',
  '===========================================',
  '',
  '对每个候选话题，评估 redSeaLevel（以上方来源基准为一阶依据）：',
  '',
  'HIGH（红海）- 直接淘汰：',
  '- 来源为主流科技媒体，且无差异化视角可挖',
  '- 36氪/虎嗅/极客公园/机器之心 已有深度报道，且输入中无 Twitter/GitHub 补充视角',
  '',
  'MEDIUM（黄海）- 谨慎选择：',
  '- 主流媒体已报道，但角度表面/官方通稿，存在「被遗漏的视角」',
  '- 同一话题同时有主流媒体和 Twitter/GitHub 来源',
  '',
  'LOW（蓝海/洼地）- 优先选择：',
  '- 来源为 Twitter/GitHub，主流媒体尚未跟进',
  '- 技术圈内部讨论，但媒体尚未关注',
  '',
  '===========================================',
  '【Angle 生成策略 - 价值洼地专用】',
  '===========================================',
  '',
  '传统策略（淘汰）：',
  '- 从标题中提炼关键词 → 重新组合 → 描述性 angle',
  '- 结果：平淡、无冲突、无认知差',
  '',
  '价值洼地策略（新）：',
  '',
  '1. 「被忽视的一方」策略',
  '- 问：这个话题中，谁的声音没有被听到？',
  '- 示例：大家都在报道 OpenAI 的新模型，但「中小 AI 创业公司的生存危机」被忽视了',
  '',
  '2. 「时间反转」策略',
  '- 问：如果事件发生的顺序反过来会怎样？',
  '- 示例：「如果 GPT-4 是在 2020 年发布，GPT-3 在 2023 年发布，AI 行业会怎样？」',
  '',
  '3. 「技术反讽」策略',
  '- 问：这项技术的缺陷/意外后果是什么？',
  '- 示例：「RAG 技术让 LLM 更准确，但也让它们的回答更平庸」',
  '',
  '4. 「规模极端化」策略',
  '- 问：把某个因素放大 100 倍/缩小到 1/100 会怎样？',
  '- 示例：「如果 AI 编程助手能写 99% 的代码，程序员的价值在哪里？」',
  '',
  '===========================================',
  '【valueScore 评分标准 - 核心排序指标】',
  '===========================================',
  '',
  'valueScore 评估的是「被低估程度」，而非「热度」：',
  '',
  '9-10分（顶级洼地）：',
  '- 几乎无主流媒体报道（redSeaLevel: LOW）',
  '- 但在技术圈/从业者中有深度讨论',
  '- 预计 2-4 周后可能成为热点',
  '- angle 具有强烈的反共识特征',
  '',
  '7-8分（优质洼地）：',
  '- 有少量报道，但角度表面（redSeaLevel: MEDIUM）',
  '- 存在被遗漏的视角或技术细节',
  '- angle 有一定认知差',
  '',
  '5-6分（普通洼地/风险区）：',
  '- 已有较多报道（redSeaLevel: MEDIUM-HIGH）',
  '- 角度差异化有限',
  '- 可能陷入红海竞争',
  '',
  '低于5分（红海）：',
  '- 已被广泛报道（redSeaLevel: HIGH）',
  '- 无差异化可能',
  '- 直接淘汰',
  '',
  '注意：valueScore 高的话题，heatScore 可能中等（5-7）。',
  '这是正常的，也是我们要找的洼地。',
  '',
  '===========================================',
  '【输出格式】',
  '===========================================',
  '',
  '直接输出 JSON，不要用 ```json 或任何 markdown 代码块包裹：',
  '{',
  '  "topics": [',
  '    {',
  '      "title": "中文标题，有认知落差/对比/反常识效果",',
  '      "angle": "一句话锐利观点，使用反共识策略",',
  '      "summary": "读者价值，说明为什么这个话题被低估但值得关注",',
  '      "valueScore": 1-10,',
  '      "heatScore": 1-10,',
  '      "redSeaLevel": "LOW" | "MEDIUM" | "HIGH",',
  '      "contrarianAngle": "说明使用了哪种反共识策略及具体应用",',
  '      "timeToMainstream": "NOW" | "WEEKS" | "MONTHS",',
  '      "tags": ["标签1", "标签2"],',
  '      "sources": [{ "title": "...", "url": "...", "source": "..." }]',
  '    }',
  '  ],',
  '  "strategy": "VALUE_CREVASSE" | "EARLY_SIGNAL" | "CONTRARIAN"',
  '}',
].join('\n')

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

    if (ch === '/' && input[i + 1] === '/') {
      const eol = input.indexOf('\n', i)
      i = eol === -1 ? input.length - 1 : eol - 1
      continue
    }

    if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2)
      i = end === -1 ? input.length - 1 : end + 1
      continue
    }

    if (ch === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j++
      if (j < input.length && (input[j] === '}' || input[j] === ']')) {
        continue
      }
    }

    result.push(ch)
  }

  return result.join('')
}

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch && codeBlockMatch[1]?.trim()) {
    return codeBlockMatch[1].trim()
  }

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

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === openChar || ch === '{' || ch === '[') depth++
    if (ch === closeChar || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  const lastClose = text.lastIndexOf(closeChar)
  if (lastClose > start) {
    return text.slice(start, lastClose + 1)
  }

  return text.trim()
}

function clampScore(value: unknown): number {
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

function validateRedSeaLevel(level: unknown, index: number, title: string): RedSeaLevel {
  if (level === 'LOW' || level === 'MEDIUM' || level === 'HIGH') {
    return level
  }

  throw new Error(
    `Topic at index ${index} missing or invalid redSeaLevel. title: "${title}"`,
  )
}

function validateTimeToMainstream(
  time: unknown,
  index: number,
  title: string,
): TimeToMainstream {
  if (time === 'NOW' || time === 'WEEKS' || time === 'MONTHS') {
    return time
  }

  throw new Error(
    `Topic at index ${index} missing or invalid timeToMainstream. title: "${title}"`,
  )
}

function sanitizeTopicSummary(summary: string): string {
  return summary
    .replace(/本文将揭示/g, '这揭示了')
    .replace(/本文将/g, '')
    .replace(/本篇将/g, '')
    .replace(/这篇文章将/g, '')
    .replace(/本报告将/g, '')
    .replace(/本文|本篇|这篇文章|本报告/g, '')
    .replace(/^[，,。；;:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
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
  if (!angle) {
    throw new Error(`Topic at index ${index} missing required field "angle".`)
  }
  if (angle.length < 15) {
    throw new Error(
      `Topic at index ${index} eliminated: angle too short (${angle.length} chars, min 15). title: "${title}"`,
    )
  }
  if (angle.length > 120) {
    throw new Error(
      `Topic at index ${index} eliminated: angle too long (${angle.length} chars, max 120). title: "${title}"`,
    )
  }

  const badAnglePatterns = [
    /从[\u4e00-\u9fa5]{1,20}(?:财报|报告|数据)?看[\u4e00-\u9fa5]{2,}(?:趋势|发展|前景|格局)/,
    /深度解读[\u4e00-\u9fa5]/,
    /(?:行业趋势|行业分析|应用前景|功能评测|使用体验)[:：\s]/,
    /一文读懂/,
    /分析$/,
    /(?:^|[\u4e00-\u9fa5])分析[:：\s]/,
    /(?:^|[\u4e00-\u9fa5])解读[:：\s]/,
    /前景展望$/,
    /趋势分析$/,
    /行业趋势/,
  ]

  for (const pattern of badAnglePatterns) {
    if (pattern.test(angle)) {
      throw new Error(
        `Topic at index ${index} eliminated: angle matches淘汰 pattern "${pattern}". angle: "${angle}"`,
      )
    }
  }

  const badTitlePatterns = [/一文读懂/, /深度解读/, /行业分析报告/, /^XX/, /XX行业/]
  for (const pattern of badTitlePatterns) {
    if (pattern.test(title)) {
      throw new Error(
        `Topic at index ${index} eliminated: title matches淘汰 pattern "${pattern}". title: "${title}"`,
      )
    }
  }

  const summary = typeof t.summary === 'string' ? sanitizeTopicSummary(t.summary.trim()) : ''
  if (summary.length < 10) {
    throw new Error(
      `Topic at index ${index} eliminated: summary too short (${summary.length} chars, min 10). title: "${title}"`,
    )
  }

  const metaPatterns = [/本文/, /本篇/, /这篇文章/, /本文将/, /本篇将/, /本报告/]
  for (const pattern of metaPatterns) {
    if (pattern.test(summary)) {
      throw new Error(
        `Topic at index ${index} eliminated: summary contains meta-narrative phrase matching "${pattern}". summary: "${summary}"`,
      )
    }
  }

  const valueScore = clampScore(t.valueScore)
  if (valueScore < 5) {
    throw new Error(
      `Topic at index ${index} eliminated: valueScore ${valueScore} below minimum 5. title: "${title}"`,
    )
  }

  const heatScore = clampScore(t.heatScore)
  if (heatScore < 1) {
    throw new Error(
      `Topic at index ${index} missing or invalid heatScore. title: "${title}"`,
    )
  }

  const redSeaLevel = validateRedSeaLevel(t.redSeaLevel, index, title)
  if (valueScore >= 8 && redSeaLevel === 'HIGH') {
    throw new Error(
      `Topic at index ${index} eliminated: valueScore ${valueScore} but redSeaLevel is HIGH. title: "${title}"`,
    )
  }

  const contrarianAngle =
    typeof t.contrarianAngle === 'string' ? t.contrarianAngle.trim() : ''
  if (!contrarianAngle) {
    throw new Error(
      `Topic at index ${index} missing required field "contrarianAngle". title: "${title}"`,
    )
  }

  const timeToMainstream = validateTimeToMainstream(
    t.timeToMainstream,
    index,
    title,
  )

  const sources = Array.isArray(t.sources) ? t.sources.map(validateSource) : []
  const hasValidSource = sources.some(
    (s) => s.url && s.url.startsWith('http') && s.url.length > 10,
  )
  if (!hasValidSource) {
    throw new Error(
      `Topic at index ${index} eliminated: no valid source URL. title: "${title}"`,
    )
  }

  return {
    title,
    angle,
    summary,
    heatScore,
    valueScore,
    tags: Array.isArray(t.tags)
      ? t.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    sources,
    redSeaLevel,
    contrarianAngle,
    timeToMainstream,
  }
}

function inferStrategy(topics: TopicSuggestion[]): TopicSelectionStrategy {
  const avgValueScore =
    topics.reduce((sum, topic) => sum + topic.valueScore, 0) / topics.length
  const lowRedSeaCount = topics.filter((topic) => topic.redSeaLevel === 'LOW').length

  if (avgValueScore >= 8 && lowRedSeaCount >= 2) {
    return 'VALUE_CREVASSE'
  }

  if (topics.some((topic) => topic.timeToMainstream === 'WEEKS')) {
    return 'EARLY_SIGNAL'
  }

  return 'CONTRARIAN'
}

export async function runTopicAgent(
  trendItems: TrendItem[],
  modelConfig: ModelConfig,
  options?: {
    count?: number
    maxInputItems?: number
    enableRedSeaCheck?: boolean
    webSearchApiKey?: string
  },
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

  const inputItemPrefix = '---ITEM---'
  const inputItemSuffix = '---/ITEM---'
  const ctrlChars = /[\u0000-\u001F\u200B]/g

  const clean = (s: string) =>
    String(s)
      .replace(ctrlChars, '')
      .replace(new RegExp(`${inputItemPrefix}|${inputItemSuffix}`, 'g'), '')

  const itemsText = trendItems
    .slice(0, cfg.agent.maxInputItems)
    .map(
      (item, i) =>
        `${inputItemPrefix}\n${i + 1}. [${clean(item.source)}] ${clean(item.title)}\n   链接: ${clean(item.link)}\n   时间: ${item.pubDate}\n   摘要: ${clean(item.snippet)}${inputItemSuffix}`,
    )
    .join('\n\n')

  const basePrompt = [
    '以下是最新的 AI/科技热点资讯（共 ' + Math.min(trendItems.length, cfg.agent.maxInputItems) + ' 条），',
    '请使用「价值洼地策略」筛选出 ' + cfg.agent.count + ' 个最适合写成「科技猫」风格文章的选题。',
    '',
    '## 待筛选的热点资讯',
    itemsText,
    '',
    '直接输出 JSON，不要有任何额外文字，不要用 markdown 代码块。',
  ].join('\n')

  let parsed: unknown
  let text = ''
  let lastError = ''

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = attempt === 1
      ? basePrompt
      : [
          basePrompt,
          '',
          '## 上一次输出失败原因（本次必须修复）',
          lastError,
          '',
          '重新输出完整、合法、未截断的 JSON。不要解释，不要省略结尾括号。',
        ].join('\n')

    const response: ChatResponse = await provider.chat(
      [{ role: 'user', content: prompt }],
      {
        temperature: cfg.agent.temperature,
        maxTokens: cfg.agent.maxTokens,
        systemPrompt: SYSTEM_PROMPT_LINES,
      },
    )

    text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')

    const jsonStr = extractJSON(text)

    try {
      parsed = JSON.parse(jsonStr)
      break
    } catch {
      try {
        const fixed = safeFixJSON(jsonStr)
        parsed = JSON.parse(fixed)
        break
      } catch {
        lastError = 'TopicAgent returned invalid/truncated JSON. Raw: ' + text.slice(0, 500)
        if (attempt === 3) {
          throw new Error(lastError)
        }
      }
    }
  }

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
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')

  console.log(`[TopicAgent] LLM returned ${result.topics.length} topics, raw:`, JSON.stringify(result.topics).slice(0, 500))

  for (let i = 0; i < result.topics.length; i++) {
    try {
      const topic = validateTopic(result.topics[i], i)

      const duplicate = validated.find((existing) => {
        const current = normalize(topic.title)
        const accepted = normalize(existing.title)
        return current.includes(accepted) || accepted.includes(current)
      })

      if (duplicate) {
        console.warn(
          `[TopicAgent] skip topic[${i}] as duplicate of "${duplicate.title}": "${topic.title}"`,
        )
        continue
      }

      if (topic.valueScore >= 7 && topic.redSeaLevel === 'LOW') {
        validated.unshift(topic)
      } else {
        validated.push(topic)
      }

      if (validated.length >= cfg.agent.count) break
    } catch (err) {
      console.warn(
        `[TopicAgent] skip topic[${i}]: ${err instanceof Error ? err.message : String(err)}`,
      )
      console.warn(`[TopicAgent] raw topic[${i}]:`, JSON.stringify(result.topics[i]).slice(0, 300))
    }
  }

  if (validated.length === 0) {
    throw new Error(
      `TopicAgent: all ${result.topics.length} topics were eliminated by validation. Check the raw LLM output.`,
    )
  }

  return {
    topics: validated,
    strategy: inferStrategy(validated),
  }
}

export const runTopicAgentV2 = runTopicAgent
