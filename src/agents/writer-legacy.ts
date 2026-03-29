import { z, type ZodSchema } from 'zod'
import { createAgentProvider, type ModelConfig, type ChatResponse } from '@/lib/ai'
import { parseAgentOutput } from '@/lib/parse-agent-output'
import { normalizeParagraphImageSlots } from '@/lib/paragraph-image-slots'
import type { TopicSuggestion } from './topic'
import type { ResearchResult } from './research'

export const WRITER_PROMPT_VERSION = '3.0.0'

export interface WritingStyle {
  tone?: string
  length?: string
  style?: string[]
  brandName?: string
  targetAudience?: string
  preferredHookMode?: 'auto' | 'A' | 'B' | 'C'
  tonePreset?: 'sharp' | 'balanced' | 'professional'
}

export interface WriterOutlineSection {
  title: string
  corePoint: string
}

export interface WriterOutline {
  titles: string[]
  hook: string
  sections: WriterOutlineSection[]
  ending: string
}

export interface WriterDraftSection {
  sectionTitle: string
  content: string
}

export type WriterRewriteStyle = 'emotional' | 'rational' | 'casual'

export interface WriterRewriteSection {
  sectionTitle: string
  emotional: string
  rational: string
  casual: string
  selectedStyle: WriterRewriteStyle
}

export interface WriterFinal {
  title: string
  content: string
}

export interface WriterScoreMetrics {
  engagement: number
  realism: number
  emotion: number
  value: number
}

export interface WriterScoreRound {
  attempt: number
  metrics: WriterScoreMetrics
  issues: string[]
  optimizations: string[]
  passed: boolean
}

export interface WriterResult {
  outline: WriterOutline
  draft: WriterDraftSection[]
  rewrite: WriterRewriteSection[]
  final: WriterFinal
  scores: WriterScoreRound[]
  title: string
  body: string
  summary: string
  wordCount: number
  promptVersion: string
}

function isConstrainedWriterModel(modelConfig: ModelConfig): boolean {
  const model = (modelConfig.defaultModel ?? modelConfig.model ?? '').toLowerCase()
  const baseURL = (modelConfig.baseURL ?? '').toLowerCase()
  return model.includes('minimax') || baseURL.includes('minimaxi.com')
}

const OutlineSchema = z.object({
  titles: z.array(z.string().min(8)).length(3),
  hook: z.string().min(30),
  sections: z.array(
    z.object({
      title: z.string().min(6),
      corePoint: z.string().min(10),
    }),
  ).min(3).max(5),
  ending: z.string().min(20),
})

const DraftSchema = z.array(
  z.object({
    sectionTitle: z.string().min(1),
    content: z.string().min(120),
  }),
).min(3).max(5)

const RewriteSchema = z.array(
  z.object({
    sectionTitle: z.string().min(1),
    emotional: z.string().min(120),
    rational: z.string().min(120),
    casual: z.string().min(120),
    selectedStyle: z.enum(['emotional', 'rational', 'casual']),
  }),
).min(3).max(5)

const FinalSchema = z.object({
  title: z.string().min(8),
  content: z.string().min(800),
})

const ScoreSchema = z.object({
  metrics: z.object({
    engagement: z.number().min(0).max(10),
    realism: z.number().min(0).max(10),
    emotion: z.number().min(0).max(10),
    value: z.number().min(0).max(10),
  }),
  issues: z.array(z.string()).max(8),
  optimizations: z.array(z.string()).max(8),
  passed: z.boolean().optional(),
})

const TONE_PRESET_INSTRUCTIONS: Record<NonNullable<WritingStyle['tonePreset']>, string> = {
  sharp: '语气：极度犀利，敢于下刀，不做理中客，直接给出判断和立场',
  balanced: '语气：有观点但克制，数据说话，结论留有余地，适合技术型读者',
  professional: '语气：专业沉稳，逻辑严密，减少情绪化措辞，适合商业和企业受众',
}

const OUTLINE_SYSTEM_PROMPT = [
  '你是内容总编。你的任务是先设计文章骨架，再交给后续阶段执行。',
  '只输出 JSON。禁止 markdown 代码块，禁止解释。',
  '标题必须输出 3 个候选，都要有认知落差、数字/对比/反常识。',
  'hook 必须是一段 80-160 字的开篇策略说明，不要写成完整正文。',
  'sections 必须 3-5 个，每个标题都必须是观点句，不能是“行业分析/市场现状”这类描述性标题。',
  'ending 必须是结尾策略，不是鸡汤。',
].join('\n')

const DRAFT_SYSTEM_PROMPT = [
  '你是资深特稿作者，负责把骨架扩成可写的分段初稿。',
  '只输出 JSON 数组。禁止 markdown 代码块，禁止解释。',
  '每段 220-420 字，必须有场景、细节、数据或命名实体。',
  '每段只写对应章节，不要写总起、总分总或结尾总结句。',
].join('\n')

const REWRITE_SYSTEM_PROMPT = [
  '你是改稿编辑，负责为每个章节生成 3 种改写版本。',
  '只输出 JSON 数组。禁止 markdown 代码块，禁止解释。',
  '每个章节必须提供 emotional、rational、casual 三个版本，并明确 selectedStyle。',
  '三个版本必须基于同一事实，但表达重心不同。',
].join('\n')

const HUMANIZE_SYSTEM_PROMPT = [
  '你是最终成稿编辑，负责把章节改写整合成可发布文章。',
  '只输出 JSON 对象。禁止 markdown 代码块，禁止解释。',
  'content 必须是完整 Markdown 正文，第一行必须是 # 标题。',
  'Hook 后插入 1 张 ![开篇配图，有画面感](image:cover)。除封面图外，不要手动插入章节配图占位符，系统会自动选择段落插图位置。',
  '禁止空洞开场、禁止废话结尾、禁止“本文将”“综上所述”“感谢阅读”。',
].join('\n')

const SCORE_SYSTEM_PROMPT = [
  '你是文章终审，只负责打分和给出结构化优化建议。',
  '只输出 JSON 对象。禁止 markdown 代码块，禁止解释。',
  '四个维度必须是 0-10 分，可带 1 位小数：engagement、realism、emotion、value。',
  '只要任一维度低于 8 分，passed 必须为 false，并给出针对性的 issues 和 optimizations。',
  'issues 说清楚哪里差，optimizations 说清楚下一轮如何改。',
].join('\n')

function buildBrandVoice(
  brandName: string = '科技猫',
  targetAudience: string = '25-40岁科技爱好者，有独立思考能力',
): string {
  return [
    `你是「${brandName}」公众号的主笔，这是一个有态度的科技内容品牌。`,
    '',
    '【人格定位】',
    '科技圈里最敢说真话的那个朋友。不端不装，有数据有态度，有温度也有锋芒。',
    `读者是${targetAudience}，不需要被喂鸡汤。`,
  ].join('\n')
}

function buildStyleInstructions(style?: WritingStyle): string {
  const defaults = [
    '语气：犀利有观点，敢下判断，不做理中客',
    '长度：2000-2800字',
    '风格：公众号深度爆款风格，有数据有案例，深度与可读性兼顾',
    '目标读者：25-40岁科技爱好者，有独立思考能力',
  ]
  if (!style) return defaults.join('\n')

  const lines = [...defaults]
  if (style.tone) lines[0] = '语气：' + style.tone
  if (style.length) lines[1] = '长度：' + style.length
  if (style.style?.length) lines[2] = '风格：' + style.style.join('、')
  if (style.targetAudience) lines[3] = '目标读者：' + style.targetAudience

  return lines.join('\n')
}

function sanitizeFeedback(feedback?: string): string | null {
  if (!feedback) return null
  return feedback
    .replace(/^#{1,6}\s+/gm, '- ')
    .replace(/```[\s\S]*?```/g, '[code block omitted]')
    .trim()
}

function buildFeedbackContext(reviewFeedback?: string, optimizationFeedback?: string): string {
  const parts: string[] = []
  const externalFeedback = sanitizeFeedback(reviewFeedback)
  const internalFeedback = sanitizeFeedback(optimizationFeedback)

  if (externalFeedback) {
    parts.push(
      '## 外部审核反馈（最高优先级，必须逐条解决）',
      externalFeedback,
      '',
    )
  }

  if (internalFeedback) {
    parts.push(
      '## 上一轮自评分优化方向（本轮必须解决）',
      internalFeedback,
      '',
    )
  }

  return parts.join('\n')
}

function extractResearchSection(rawOutput: string, heading: string): string {
  const pattern = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`)
  return rawOutput.match(pattern)?.[1]?.trim() ?? ''
}

function buildResearchAnchors(rawOutput: string): string {
  const preciseData = extractResearchSection(rawOutput, '精确数据锚点')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && /\d/.test(line) && /https?:\/\//.test(line))
    .slice(0, 5)

  const keyData = extractResearchSection(rawOutput, '关键数据')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && /\d/.test(line) && !/待补充|来源待补充/.test(line))
    .slice(0, 6)

  const compareLines = extractResearchSection(rawOutput, '对比数据')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && /\d/.test(line) && /https?:\/\//.test(line))
    .slice(0, 5)

  const caseLines = extractResearchSection(rawOutput, '真实案例')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(###\s*【|- 具体事件：|- 结果数据：)/.test(line))
    .slice(0, 9)

  return [
    '## 必须优先使用的精确数据锚点',
    ...preciseData,
    '',
    '## 必须优先使用的对比锚点',
    ...compareLines,
    '',
    '## 可直接落正文的事实锚点',
    ...keyData,
    '',
    '## 可直接落正文的案例锚点',
    ...caseLines,
  ].join('\n').trim()
}

function extractPreciseEvidenceLines(rawOutput: string): string[] {
  const preciseSection = extractResearchSection(rawOutput, '精确数据锚点')
  const compareSection = extractResearchSection(rawOutput, '对比数据')
  const fallbackSection = extractResearchSection(rawOutput, '关键数据')
  const quantitativePattern = /(\d+(?:\.\d+)?[%％]|(?:\d+(?:\.\d+)?)(?:万|亿|家|条|种|小时|分钟|秒|年|月|日|个|倍)|L\d)/

  return [...new Set(
    [preciseSection, compareSection, fallbackSection]
      .filter(Boolean)
      .join('\n')
      .split('\n')
      .map((line) => line.trim())
      .map((line) =>
        line
          .replace(/两倍/g, '2倍')
          .replace(/三倍/g, '3倍')
          .replace(/四倍/g, '4倍')
          .replace(/五倍/g, '5倍')
          .replace(/每两周/g, '每2周')
          .replace(/每三周/g, '每3周'),
      )
      .filter(
        (line) =>
          line.startsWith('- ') &&
          /\d/.test(line) &&
          quantitativePattern.test(line) &&
          /https?:\/\//.test(line) &&
          !/### 抓取页面|待补充|来源待补充/.test(line) &&
          !/^-\s*#\s/.test(line) &&
          !/^\-\s*(刚刚|今天|昨日|前天)，/.test(line),
      ),
  )].slice(0, 5)
}

function countPreciseEvidenceLines(body: string): number {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\d/.test(line) && /https?:\/\//.test(line) && !/超过|约|左右|数月|数小时/.test(line))
    .length
}

function ensurePreciseEvidenceLines(body: string, researchRawOutput: string): string {
  if (countPreciseEvidenceLines(body) >= 2) return body

  const evidenceLines = extractPreciseEvidenceLines(researchRawOutput)
  if (evidenceLines.length === 0) return body

  const evidenceBlock = [
    '以下 3 条硬数据值得先记住：',
    ...evidenceLines,
    '',
  ].join('\n')

  const coverPattern = /!\[[^\]]*\]\(image:cover\)\n\n/
  if (coverPattern.test(body)) {
    return body.replace(coverPattern, (match) => `${match}${evidenceBlock}`)
  }

  const titlePattern = /^# .+\n\n/
  if (titlePattern.test(body)) {
    return body.replace(titlePattern, (match) => `${match}${evidenceBlock}`)
  }

  return `${evidenceBlock}${body}`.trim()
}

function parseWriterStageOutput<T>(stage: string, text: string, schema: ZodSchema<T>): T {
  try {
    return parseAgentOutput(text, schema, `writer:${stage}`)
  } catch (error) {
    throw new Error(
      `[writer:${stage}] ${error instanceof Error ? error.message : String(error)}. Raw output: ${text.slice(0, 600)}`,
    )
  }
}

async function runJsonStage<T>(params: {
  stage: string
  provider: ReturnType<typeof createAgentProvider>
  prompt: string
  schema: ZodSchema<T>
  systemPrompt: string
  temperature: number
  maxTokens: number
}): Promise<T> {
  const { stage, provider, schema, systemPrompt, temperature, maxTokens } = params
  let prompt = params.prompt
  let lastError: string | null = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await provider.chat(
      [{ role: 'user', content: prompt }],
      { temperature, maxTokens, systemPrompt },
    )
    const raw = extractRawText(response)

    try {
      return parseWriterStageOutput(stage, raw, schema)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt === 3) break
      prompt = [
        params.prompt,
        '',
        '## 上一次输出失败原因（本次必须修复）',
        lastError,
        '',
        '重新输出完整、合法、严格符合 schema 的 JSON。不要解释。',
      ].join('\n')
    }
  }

  throw new Error(`[writer:${stage}] 连续 3 次输出非法 JSON: ${lastError ?? '未知错误'}`)
}

function buildOutlinePrompt(
  topic: TopicSuggestion,
  research: ResearchResult,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
): string {
  const hookMode = writingStyle?.preferredHookMode

  return [
    buildFeedbackContext(reviewFeedback, optimizationFeedback),
    '## 话题',
    `标题方向：${topic.title}`,
    `写作角度：${topic.angle}`,
    `核心摘要：${topic.summary}`,
    '',
    '## 风格要求',
    buildStyleInstructions(writingStyle),
    '',
    hookMode && hookMode !== 'auto'
      ? `## 账号偏好\nHook 必须使用模式 ${hookMode}`
      : '## Hook 要求\n在 A 反常识 / B 具体场景 / C 辛辣设问 中选最适合的一个',
    '',
    '## 研究资料',
    research.rawOutput,
    '',
    '## 输出 JSON schema',
    JSON.stringify({
      titles: ['标题候选1', '标题候选2', '标题候选3'],
      hook: '开篇 hook 的策略说明，80-160字',
      sections: [
        { title: '观点句章节标题1', corePoint: '章节核心观点1' },
        { title: '观点句章节标题2', corePoint: '章节核心观点2' },
        { title: '观点句章节标题3', corePoint: '章节核心观点3' },
      ],
      ending: '结尾策略，包含核心判断、行动建议、留白问题',
    }, null, 2),
  ].filter(Boolean).join('\n')
}

function buildDraftPrompt(
  outline: WriterOutline,
  topic: TopicSuggestion,
  research: ResearchResult,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
): string {
  return [
    buildFeedbackContext(reviewFeedback, optimizationFeedback),
    '## 文章方向',
    `主标题候选：${outline.titles.join(' / ')}`,
    `推荐 hook：${outline.hook}`,
    '',
    '## 章节骨架（按顺序生成，sectionTitle 必须与 title 完全一致）',
    ...outline.sections.map((section, index) => `${index + 1}. ${section.title}\n核心观点：${section.corePoint}`),
    '',
    '## 选题背景',
    `标题方向：${topic.title}`,
    `写作角度：${topic.angle}`,
    '',
    '## 风格要求',
    buildStyleInstructions(writingStyle),
    '',
    buildResearchAnchors(research.rawOutput),
    '',
    '## 研究资料',
    research.rawOutput,
    '',
    '## 硬性写作约束',
    '1. 每个章节至少落 1 个具体数字或公司/产品案例，不得只讲观点。',
    '2. 数据句必须写成“公司/产品 + 数字/变化 + 来源机构”这类完整信息，不要写空洞大词。',
    '3. 优先使用上面的事实锚点，不要创造 research 中不存在的数字。',
    '4. 至少 2 句关键数据必须写出精确数字和来源 URL，优先使用“必须优先使用的精确数据锚点”。',
    '5. 如果 research 提供了“对比数据”，至少 2 个章节必须显式使用“谁比谁高/低多少、提升多少、差距多少”这类比较句。',
    '',
    '## 输出 JSON schema',
    JSON.stringify([
      { sectionTitle: outline.sections[0]?.title ?? '章节标题', content: '该章节初稿正文' },
    ], null, 2),
  ].filter(Boolean).join('\n')
}

function buildRewritePrompt(
  outline: WriterOutline,
  draft: WriterDraftSection[],
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
): string {
  return [
    buildFeedbackContext(reviewFeedback, optimizationFeedback),
    '## 章节目标',
    ...outline.sections.map((section, index) => `${index + 1}. ${section.title}\n核心观点：${section.corePoint}`),
    '',
    '## 初稿分段',
    JSON.stringify(draft, null, 2),
    '',
    '## 风格要求',
    buildStyleInstructions(writingStyle),
    '',
    '## 输出 JSON schema',
    JSON.stringify([
      {
        sectionTitle: outline.sections[0]?.title ?? '章节标题',
        emotional: '更有冲击力的版本',
        rational: '更强调逻辑与数据的版本',
        casual: '更像朋友聊天的版本',
        selectedStyle: 'rational',
      },
    ], null, 2),
  ].filter(Boolean).join('\n')
}

function buildHumanizePrompt(
  outline: WriterOutline,
  rewrite: WriterRewriteSection[],
  research: ResearchResult,
  constrainedModel: boolean,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
): string {
  const toneInstruction = writingStyle?.tonePreset
    ? TONE_PRESET_INSTRUCTIONS[writingStyle.tonePreset]
    : null

  return [
    buildBrandVoice(writingStyle?.brandName, writingStyle?.targetAudience),
    toneInstruction ? `\n【语气覆盖】\n${toneInstruction}` : '',
    '',
    buildFeedbackContext(reviewFeedback, optimizationFeedback),
    '## 已定大纲',
    JSON.stringify(outline, null, 2),
    '',
    '## 可选改写版本（必须优先采用 selectedStyle 对应版本）',
    JSON.stringify(rewrite, null, 2),
    '',
    buildResearchAnchors(research.rawOutput),
    '',
    '## 研究资料',
    research.rawOutput,
    '',
    '## 成稿要求',
    '1. 输出 title 和 content。',
    '2. content 第一行必须是 # title。',
    '3. 正文必须使用明确的 Markdown 二级标题结构：每个大章节都以 ## 标题开头，数量与大纲 sections 保持一致。',
    '3. Hook 后插入 1 张封面配图占位符 ![开篇配图，有画面感](image:cover)。',
    '4. 除封面图外，不要手动插入章节配图占位符，系统会自动选择最适合的段落插图位置。',
    constrainedModel
      ? '5. 全文字数目标 1800-2200 字，绝不能少于 1800 字。'
      : '5. 全文字数目标 2200-2600 字，绝不能少于 2200 字。',
    '5.1 如果篇幅不够，就补足案例、数据、对比分析和结尾推演，禁止为了简洁主动收短。',
    '6. 每个 ## 章节至少包含 1 句“公司/产品 + 数字/结果 + 来源”格式的硬信息；整篇至少 5 处硬信息。',
    '6.1 如果某章节不适合塞数字，也必须加入 1 个真实公司案例或专家观点，并点明来源。',
    '6.2 禁止写“99%”“几乎所有人”“大多数公司都”这类 research 中没有明确来源的夸张数字。',
    '6.3 至少 2 句关键数据必须同时包含精确数字和来源 URL；禁止只写“可查官网/可查论文”这种模糊来源。',
    '6.4 如果 research 中存在“对比数据”小节，正文至少 2 个 ## 章节必须落 1 句可验证的比较句。',
    '7. 结尾必须收束观点、给出行动建议，并留下一个问题。',
    '',
    '## 输出 JSON schema',
    JSON.stringify({
      title: outline.titles[0] ?? '最终标题',
      content: '# 最终标题\n\n完整 Markdown 正文',
    }, null, 2),
  ].filter(Boolean).join('\n')
}

function buildScorePrompt(
  final: WriterFinal,
  reviewFeedback?: string,
): string {
  return [
    sanitizeFeedback(reviewFeedback)
      ? `## 外部审核反馈（如与正文冲突，以修复反馈为优先）\n${sanitizeFeedback(reviewFeedback)}`
      : '',
    '',
    '## 评分对象',
    `标题：${final.title}`,
    '',
    final.content,
    '',
    '## 评分规则',
    'engagement：开头抓人、信息推进、是否有读下去的冲动。',
    'realism：是否具体、是否像人写的、是否避免模板腔。',
    'emotion：情绪张力、态度、节奏变化。',
    'value：洞察、信息增量、对读者是否有用。',
    '',
    '## 输出 JSON schema',
    JSON.stringify({
      metrics: {
        engagement: 8.6,
        realism: 8.4,
        emotion: 8.2,
        value: 8.8,
      },
      issues: ['如果未过线，指出最关键问题'],
      optimizations: ['如果未过线，给出下一轮具体改法'],
      passed: true,
    }, null, 2),
  ].filter(Boolean).join('\n')
}

function validateOutline(outline: WriterOutline): string[] {
  const issues: string[] = []
  const descriptiveTitle = /^(市场|技术|行业|产品|用户|政策|竞争)(现状|概况|背景|概述|介绍|分析|探讨|研究|趋势|格局|发展|挑战|影响)$/
  const cognitiveGapPattern = /\d|反|却|竟|仅|只有|不足|超过|高达|低至|失败|倒下|打穿|颠覆|崩塌|黑化|主动|失控|欺骗|为何|为什么|正在|教训|真相|看清|下一个战场|离职后|首发|预警信号|DeepSeek时刻|更便宜|替代品|先上车后补票|护城河|选择了等|守住吗|从.+到.+|比.+更|越.+越|不是.+而是|当.+时|当.+[：:]/

  if (outline.titles.length !== 3) {
    issues.push(`标题候选数量错误：${outline.titles.length}（必须为 3）`)
  }

  let titlesWithCognitiveGap = 0
  outline.titles.forEach((title, index) => {
    if (cognitiveGapPattern.test(title)) {
      titlesWithCognitiveGap += 1
    } else {
      issues.push(`标题候选 ${index + 1} 缺少认知落差：${title}`)
    }
  })

  if (titlesWithCognitiveGap >= 1) {
    for (let i = issues.length - 1; i >= 0; i -= 1) {
      if (issues[i]?.includes('标题候选') && issues[i]?.includes('缺少认知落差')) {
        issues.splice(i, 1)
      }
    }
  }

  if (outline.sections.length < 3 || outline.sections.length > 5) {
    issues.push(`章节数量错误：${outline.sections.length}（必须为 3-5）`)
  }

  for (const section of outline.sections) {
    if (descriptiveTitle.test(section.title.trim())) {
      issues.push(`章节标题过于描述性：${section.title}`)
    }
  }

  return issues
}

function validateSectionAlignment(
  stage: 'draft' | 'rewrite',
  outline: WriterOutline,
  sections: Array<{ sectionTitle: string }>,
): string[] {
  const issues: string[] = []
  if (sections.length !== outline.sections.length) {
    issues.push(`${stage} 段落数与大纲不一致：${sections.length} vs ${outline.sections.length}`)
    return issues
  }

  outline.sections.forEach((section, index) => {
    const actualTitle = sections[index]?.sectionTitle
    if (actualTitle !== section.title) {
      issues.push(`${stage} 第 ${index + 1} 段标题不匹配：${actualTitle ?? '缺失'} vs ${section.title}`)
    }
  })

  return issues
}

function validateWriterOutput(
  body: string,
  wordCount: number,
  options: { minWordCount: number; maxWordCount: number },
): string[] {
  const issues: string[] = []

  if (wordCount < options.minWordCount) issues.push(`字数严重不足: ${wordCount} < ${options.minWordCount}`)
  if (wordCount > options.maxWordCount) issues.push(`字数超标: ${wordCount} > ${options.maxWordCount}`)

  const firstParagraph = body.split('\n\n')[0] ?? ''
  if (/随着[^\n]{0,10}的(?:发展|进步|普及)|在当今|近年来[^\n]{0,5}[，,]/.test(firstParagraph)) {
    issues.push('存在空洞开场白（“随着XX发展”“近年来”等）')
  }

  const lastParagraph = body.split('\n\n').slice(-1)[0] ?? ''
  if (/感谢阅读|希望对你有帮助|如果你觉得有用请转发|祝好|综上所述|总而言之/.test(lastParagraph)) {
    issues.push('存在废话结尾')
  }

  const descriptiveTitles = body.match(/^#{1,3}\s*(?:市场|技术|行业|产品|用户|政策|竞争)(?:现状|背景|概述|分析|趋势|格局|发展)\s*$/gm)
  if (descriptiveTitles?.length) {
    issues.push(`存在描述性章节标题: ${descriptiveTitles[0].trim()}`)
  }

  const numericMentions = body.match(/\d+(?:[.,]\d+)*/g) ?? []
  if (numericMentions.length < 10) {
    issues.push(`数字出现次数不足: 仅 ${numericMentions.length} 处（需至少 10 处）`)
  }

  const sections = body.split(/^##\s+/m).slice(1)
  const sectionWithoutHardFact = sections.find((section) => {
    const lines = section.split('\n')
    const content = lines.slice(1).join('\n')
    return !/\d/.test(content)
  })
  if (sectionWithoutHardFact) {
    const sectionTitle = sectionWithoutHardFact.split('\n')[0]?.trim() ?? '未知章节'
    issues.push(`章节缺少硬数据或案例锚点: ${sectionTitle}`)
  }

  const unsupportedHyperboleLine = body
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        /\b99%|几乎所有人|所有公司都|全部开发者都/g.test(line) &&
        !/https?:\/\//.test(line) &&
        !/来源[:：]|来源：|来源\)/.test(line),
    )
  if (unsupportedHyperboleLine) {
    const matched = unsupportedHyperboleLine.match(/\b99%|几乎所有人|所有公司都|全部开发者都/)?.[0] ?? unsupportedHyperboleLine
    issues.push(`存在无来源夸张表述: ${matched}`)
  }

  const preciseUrlLines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\d/.test(line) && /https?:\/\//.test(line) && !/超过|约|左右|数月|数小时/.test(line))
  if (preciseUrlLines.length < 2) {
    issues.push(`精确数据+来源URL句不足: ${preciseUrlLines.length} < 2`)
  }

  return issues
}

function validateFinal(final: WriterFinal): string[] {
  const issues: string[] = []
  if (!final.content.startsWith('# ')) {
    issues.push('final.content 第一行必须是 Markdown H1 标题')
  }

  const slotMatches = [...final.content.matchAll(/!\[[^\]]*\]\(image:([a-z0-9-]+)\)/g)]
  const slotIds = slotMatches.map((match) => match[1])
  const coverCount = slotIds.filter((slotId) => slotId === 'cover').length
  const paragraphSlotIds = slotIds.filter((slotId) => slotId.startsWith('para-'))
  const h2Count = (final.content.match(/^##\s+/gm) ?? []).length

  if (coverCount !== 1) {
    issues.push(`封面配图占位符数量错误：${coverCount}（必须为 1）`)
  }
  if (paragraphSlotIds.length < Math.max(1, h2Count - 1)) {
    issues.push(`段落配图占位符不足：${paragraphSlotIds.length}（至少 ${Math.max(1, h2Count - 1)} 个）`)
  }

  return issues
}

async function generateOutline(
  topic: TopicSuggestion,
  research: ResearchResult,
  provider: ReturnType<typeof createAgentProvider>,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
  temperature: number = 0.2,
): Promise<WriterOutline> {
  const outline = await runJsonStage({
    stage: 'outline',
    provider,
    prompt: buildOutlinePrompt(topic, research, writingStyle, reviewFeedback, optimizationFeedback),
    schema: OutlineSchema,
    systemPrompt: OUTLINE_SYSTEM_PROMPT,
    temperature,
    maxTokens: 1800,
  })

  const issues = validateOutline(outline)
  if (issues.length > 0) {
    throw new Error(`大纲质量不达标: ${issues.join('; ')}`)
  }

  return outline
}

async function generateDraft(
  outline: WriterOutline,
  topic: TopicSuggestion,
  research: ResearchResult,
  provider: ReturnType<typeof createAgentProvider>,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
  temperature: number = 0.45,
): Promise<WriterDraftSection[]> {
  const draft = await runJsonStage({
    stage: 'draft',
    provider,
    prompt: buildDraftPrompt(outline, topic, research, writingStyle, reviewFeedback, optimizationFeedback),
    schema: DraftSchema,
    systemPrompt: DRAFT_SYSTEM_PROMPT,
    temperature,
    maxTokens: 3200,
  })

  const issues = validateSectionAlignment('draft', outline, draft)
  if (issues.length > 0) {
    throw new Error(`初稿结构不匹配: ${issues.join('; ')}`)
  }

  return draft
}

async function generateRewrite(
  outline: WriterOutline,
  draft: WriterDraftSection[],
  provider: ReturnType<typeof createAgentProvider>,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
  temperature: number = 0.55,
): Promise<WriterRewriteSection[]> {
  const rewrite = await runJsonStage({
    stage: 'rewrite',
    provider,
    prompt: buildRewritePrompt(outline, draft, writingStyle, reviewFeedback, optimizationFeedback),
    schema: RewriteSchema,
    systemPrompt: REWRITE_SYSTEM_PROMPT,
    temperature,
    maxTokens: 4200,
  })

  const issues = validateSectionAlignment('rewrite', outline, rewrite)
  if (issues.length > 0) {
    throw new Error(`改写结构不匹配: ${issues.join('; ')}`)
  }

  return rewrite
}

async function generateFinalArticle(
  outline: WriterOutline,
  rewrite: WriterRewriteSection[],
  research: ResearchResult,
  provider: ReturnType<typeof createAgentProvider>,
  constrainedModel: boolean,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  optimizationFeedback?: string,
  temperature: number = 0.35,
): Promise<WriterFinal> {
  const final = await runJsonStage({
    stage: 'humanize',
    provider,
    prompt: buildHumanizePrompt(
      outline,
      rewrite,
      research,
      constrainedModel,
      writingStyle,
      reviewFeedback,
      optimizationFeedback,
    ),
    schema: FinalSchema,
    systemPrompt: HUMANIZE_SYSTEM_PROMPT,
    temperature,
    maxTokens: calcMaxTokens(),
  })

  const normalized = normalizeFinal(final)
  normalized.content = ensurePreciseEvidenceLines(normalized.content, research.rawOutput)
  const issues = validateFinal(normalized)
  const wordCount = countChineseWords(normalized.content)
  const bodyIssues = validateWriterOutput(normalized.content, wordCount, {
    minWordCount: constrainedModel ? 1450 : 1600,
    maxWordCount: constrainedModel ? 2600 : 2800,
  })
  if (issues.length > 0 || bodyIssues.length > 0) {
    throw new Error(`终稿质量不达标: ${[...issues, ...bodyIssues].join('; ')}`)
  }

  return normalized
}

async function scoreFinalArticle(
  final: WriterFinal,
  provider: ReturnType<typeof createAgentProvider>,
  reviewFeedback?: string,
): Promise<Omit<WriterScoreRound, 'attempt'>> {
  const score = await runJsonStage({
    stage: 'score',
    provider,
    prompt: buildScorePrompt(final, reviewFeedback),
    schema: ScoreSchema,
    systemPrompt: SCORE_SYSTEM_PROMPT,
    temperature: 0.1,
    maxTokens: 1200,
  })

  const passed = score.passed ?? Object.values(score.metrics).every((value) => value >= 8)
  return {
    metrics: score.metrics,
    issues: score.issues,
    optimizations: score.optimizations,
    passed,
  }
}

function normalizeFinal(final: WriterFinal): WriterFinal {
  const normalizedTitle = final.title.trim()
  let content = final.content.trim()

  if (!content.startsWith('# ')) {
    content = `# ${normalizedTitle}\n\n${content}`
  }

  const headingTitle = extractTitle(content)
  if (!headingTitle || headingTitle !== normalizedTitle) {
    content = content.replace(/^#\s+.*$/m, `# ${normalizedTitle}`)
  }

  content = normalizeParagraphImageSlots(content)

  return {
    title: normalizedTitle,
    content: content.trim(),
  }
}

export async function runWriterAgentLegacy(
  topic: TopicSuggestion,
  research: ResearchResult,
  modelConfig: ModelConfig,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  attempt?: number,
): Promise<WriterResult> {
  const provider = createAgentProvider('writer', modelConfig)
  const constrainedModel = isConstrainedWriterModel(modelConfig)
  const externalAttempt = attempt ?? 0
  const outlineTemperature = externalAttempt >= 2 ? 0.1 : 0.2
  const draftTemperature = externalAttempt >= 2 ? 0.25 : 0.45
  const rewriteTemperature = externalAttempt >= 2 ? 0.3 : 0.55
  const finalTemperature = externalAttempt >= 2 ? 0.2 : 0.35

  const MAX_SCORE_ATTEMPTS = 3
  const scores: WriterScoreRound[] = []
  let optimizationFeedback: string | undefined
  let lastResult: Omit<WriterResult, 'scores' | 'title' | 'body' | 'summary' | 'wordCount' | 'promptVersion'> | null = null

  for (let scoreAttempt = 1; scoreAttempt <= MAX_SCORE_ATTEMPTS; scoreAttempt++) {
    const outline = await generateOutline(
      topic,
      research,
      provider,
      writingStyle,
      reviewFeedback,
      optimizationFeedback,
      outlineTemperature,
    )

    const draft = await generateDraft(
      outline,
      topic,
      research,
      provider,
      writingStyle,
      reviewFeedback,
      optimizationFeedback,
      draftTemperature,
    )

    const rewrite = await generateRewrite(
      outline,
      draft,
      provider,
      writingStyle,
      reviewFeedback,
      optimizationFeedback,
      rewriteTemperature,
    )

    const final = await generateFinalArticle(
      outline,
      rewrite,
      research,
      provider,
      constrainedModel,
      writingStyle,
      reviewFeedback,
      optimizationFeedback,
      finalTemperature,
    )

    const scored = await scoreFinalArticle(final, provider, reviewFeedback)
    const scoreRound: WriterScoreRound = {
      attempt: scoreAttempt,
      metrics: scored.metrics,
      issues: scored.issues,
      optimizations: scored.optimizations,
      passed: scored.passed,
    }

    scores.push(scoreRound)
    lastResult = { outline, draft, rewrite, final }

    if (scoreRound.passed) {
      const summary = extractSummary(final.content)
      const wordCount = countChineseWords(final.content)
      return {
        ...lastResult,
        scores,
        title: final.title,
        body: final.content,
        summary,
        wordCount,
        promptVersion: WRITER_PROMPT_VERSION,
      }
    }

    optimizationFeedback = [
      ...scoreRound.issues.map((issue) => `问题：${issue}`),
      ...scoreRound.optimizations.map((optimization) => `优化：${optimization}`),
    ].join('\n')
  }

  if (!lastResult) {
    throw new Error('Writer 未生成任何有效结果')
  }

  const lastScore = scores[scores.length - 1]
  throw new Error(
    `Writer 自优化 ${MAX_SCORE_ATTEMPTS} 轮后仍未达标: ${lastScore.metrics.engagement}/${lastScore.metrics.realism}/${lastScore.metrics.emotion}/${lastScore.metrics.value}; issues=${lastScore.issues.join(' | ')}`,
  )
}

export const runWriterAgent = runWriterAgentLegacy

function extractRawText(response: ChatResponse): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
}

function extractTitle(markdown: string): string | undefined {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
}

function extractSummary(markdown: string): string {
  const withoutTitle = markdown.replace(/^#\s+.+$/m, '').trim()
  const firstParagraph = withoutTitle.split(/\n\n+/).filter((paragraph) => paragraph.trim())[0] ?? ''
  return firstParagraph.replace(/[#*`!\[\]()]/g, '').trim().slice(0, 200)
}

function countChineseWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
  const englishWords = (text.match(/[a-zA-Z]+/g)?.length ?? 0) * 2
  const digitCount = text.match(/\d/g)?.length ?? 0
  return chineseChars + englishWords + Math.ceil(digitCount * 0.5)
}

function calcMaxTokens(targetChineseChars: number = 2400): number {
  return Math.ceil(targetChineseChars * 1.8 * 1.35)
}
