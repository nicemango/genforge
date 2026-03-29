import { createAgentProvider, type ModelConfig, type ChatResponse } from '@/lib/ai'
import {
  type DimensionScores,
  type WriterBrief,
  type WriterBriefMustFix,
  type DimensionResult,
  PERSPECTIVE_SPECIALIST_PROMPT,
  STRUCTURE_SPECIALIST_PROMPT,
  DATA_SUPPORT_SPECIALIST_PROMPT,
  FLUENCY_SPECIALIST_PROMPT,
  SYNTHESIS_PROMPT,
} from './review-specialists'

export type { DimensionScores, WriterBrief, WriterBriefMustFix }

export interface ReviewResult {
  score: number
  passed: boolean
  dimensionScores: DimensionScores
  reasoning: string[]
  issues: string[]
  suggestions: string[]
  fixedBody?: string
  writerBrief?: WriterBrief
}

// ============================================================
// Preprocess Helpers
// ============================================================

function stripBase64Images(body: string): string {
  return body.replace(/!\[([^\]]*)\]\(data:image\/jpeg;base64,[^)]+\)/g, '![$1](image)')
}

function countChineseWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
  const englishWords = (text.match(/[a-zA-Z]+/g)?.length ?? 0) * 2
  const digitCount = text.match(/\d/g)?.length ?? 0
  return chineseChars + englishWords + Math.ceil(digitCount * 0.5)
}

function extractEntities(text: string): string[] {
  const entities = new Set<string>()

  const englishBrands = text.match(/\b[A-Z][a-zA-Z]{1,20}(?:\s[A-Z][a-zA-Z]+)?\b/g) ?? []
  const commonWords = new Set([
    'The', 'This', 'That', 'What', 'When', 'Where', 'How', 'Why', 'Who',
    'And', 'But', 'For', 'Not', 'You', 'All', 'Can', 'Had', 'Her', 'Was',
    'One', 'Our', 'Out', 'Day', 'Get', 'Has', 'Him', 'His', 'May', 'New',
    'Now', 'Old', 'See', 'Way', 'Boy', 'Did', 'Its', 'Let', 'Put', 'Say',
    'She', 'Too', 'Use', 'Hook', 'Prompt', 'Step', 'Data', 'Note',
  ])
  for (const brand of englishBrands) {
    if (!commonWords.has(brand) && brand.length >= 2) {
      entities.add(brand)
    }
  }

  const cnCorpMatches = text.match(/[\u4e00-\u9fff]{2,6}(?:科技|集团|公司|资本|智能|机器人|半导体)/g) ?? []
  for (const m of cnCorpMatches) {
    entities.add(m)
  }

  const abbrevMatches = text.match(/\b[A-Z]{2,10}\b/g) ?? []
  const excludeAbbrev = new Set(['AI', 'API', 'URL', 'SDK', 'SaaS', 'GPU', 'CPU', 'LLM', 'NLP', 'ML', 'AR', 'VR', 'MR', 'XR', 'IoT', 'USB', 'HTML', 'CSS', 'HTTP', 'JSON', 'XML', 'SQL', 'RSS'])
  for (const a of abbrevMatches) {
    if (!excludeAbbrev.has(a) && a.length >= 3) {
      entities.add(a)
    }
  }

  return [...entities].slice(0, 30)
}

interface PreCheckResult {
  hasFluffOpening: boolean
  hasFluffClosing: boolean
  hasDescriptiveTitle: boolean
  preCheckIssues: string[]
}

function runPreCheck(title: string, body: string): PreCheckResult {
  const issues: string[] = []
  const opening300 = body.slice(0, 300)
  const closing200 = body.slice(-200)

  const fluffOpeningPatterns = [/随着.*发展/, /在.*时代/, /近年来/, /本文将/]
  const hasFluffOpening = fluffOpeningPatterns.some((p) => p.test(opening300))
  if (hasFluffOpening) {
    issues.push('【预检】【开头】废话开场：使用了"随着XX发展..."/"在XX时代..."等套话')
  }

  const fluffClosingPatterns = [/感谢阅读/, /希望有帮助/, /祝好/, /以上就是全部内容/]
  const hasFluffClosing = fluffClosingPatterns.some((p) => p.test(closing200))
  if (hasFluffClosing) {
    issues.push('【预检】【结尾】废话结尾：使用了"感谢阅读"/"祝好"等客套话')
  }

  const descriptiveTitlePatterns = [/^第.+章/, /^第一部分/, /^第二部分/, /^市场分析/, /^行业现状/]
  const hasDescriptiveTitle = descriptiveTitlePatterns.some((p) => p.test(title))
  if (hasDescriptiveTitle) {
    issues.push('【预检】【标题】描述性标题：标题无观点，应自带鲜明立场')
  }

  return { hasFluffOpening, hasFluffClosing, hasDescriptiveTitle, preCheckIssues: issues }
}

function buildPreCheckData(body: string): string {
  const wordCount = countChineseWords(body)
  const imagePlaceholders = body.match(/!\[[^\]]*\]\(image:(?:cover|section-\d+|para-\d+)\)/g) ?? []
  const imageCount = imagePlaceholders.length
  const detectedCompanies = extractEntities(body)
  const numbers = body.match(/\d+(\.\d+)?[%亿万千万亿]?/g) ?? []
  const dataPoints = numbers.slice(0, 20).join('、')

  return [
    '## 预检数据（仅供参考，请实际阅读正文判断）',
    `字数：${wordCount} 字`,
    `配图占位符：${imageCount} 张`,
    '检测到的公司/品牌名：' + (detectedCompanies.length > 0 ? detectedCompanies.join('、') : '无'),
    '检测到的数字/数据：' + (dataPoints || '无'),
  ].join('\n')
}

// ============================================================
// JSON Parsing Helpers
// ============================================================

function extractJsonFromResponse(text: string): string {
  let jsonStr = text.trim()
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/)
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim()
  }
  const start = jsonStr.indexOf('{')
  const bracketStart = jsonStr.indexOf('[')
  // Prefer { } over [ ] when both exist
  if (start === -1 && bracketStart === -1) {
    // No JSON structure found - return whole text and let JSON.parse give the real error
    return jsonStr
  }
  if (start === -1) start = Number.MAX_SAFE_INTEGER
  if (bracketStart === -1) bracketStart = Number.MAX_SAFE_INTEGER
  const actualStart = Math.min(start, bracketStart)
  const closer = actualStart === start ? '}' : ']'
  let end = jsonStr.lastIndexOf(closer)
  if (end === -1 || end < actualStart) {
    // JSON might be truncated
    end = jsonStr.length
  }
  return jsonStr.slice(actualStart, end + 1)
}

function extractStringArrayFromJsonLike(text: string, field: string): string[] {
  const match = text.match(new RegExp(`"${field}"\\s*:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match?.[1]) return []
  return [...match[1].matchAll(/"((?:\\.|[^"])*)"/g)]
    .map((entry) => entry[1]?.replace(/\\"/g, '"').trim())
    .filter(Boolean) as string[]
}

function parseDimensionResultFallback(
  text: string,
  expectedDimension: DimensionResult['dimension'],
): DimensionResult | null {
  const jsonStr = extractJsonFromResponse(text)
  const scoreMatch = jsonStr.match(/"score"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)
  const reasoningMatch = jsonStr.match(/"reasoning"\s*:\s*"([\s\S]*?)"\s*,\s*"issues"/)

  if (!scoreMatch) return null

  return {
    dimension: expectedDimension,
    score: Number(scoreMatch[1] ?? 0),
    reasoning: (reasoningMatch?.[1] ?? '').replace(/\\"/g, '"').trim(),
    issues: extractStringArrayFromJsonLike(jsonStr, 'issues'),
    suggestions: extractStringArrayFromJsonLike(jsonStr, 'suggestions'),
  }
}

function parseDimensionResult(text: string, expectedDimension: DimensionResult['dimension']): DimensionResult {
  const jsonStr = extractJsonFromResponse(text)

  let parsed: DimensionResult
  try {
    parsed = JSON.parse(jsonStr) as DimensionResult
  } catch (err) {
    const fallback = parseDimensionResultFallback(text, expectedDimension)
    if (!fallback) {
      throw new Error(
        `[${expectedDimension}] Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}. ` +
          `Raw snippet: ${jsonStr.slice(0, 300)}`,
      )
    }
    parsed = fallback
  }

  // Ensure dimension matches expected
  if (parsed.dimension !== expectedDimension) {
    parsed.dimension = expectedDimension
  }

  // Clamp score to 0-10
  const rawScore = Number(parsed.score ?? 0)
  parsed.score = Number.isFinite(rawScore) ? Math.max(0, Math.min(10, rawScore)) : 0

  // Ensure arrays
  parsed.reasoning = Array.isArray(parsed.reasoning) ? parsed.reasoning.join('; ') : String(parsed.reasoning ?? '')
  parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : []
  parsed.suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []

  return parsed
}

// ============================================================
// Specialist Evaluation
// ============================================================

interface SpecialistConfig {
  dimension: DimensionResult['dimension']
  name: string
  prompt: string
}

const SPECIALISTS: SpecialistConfig[] = [
  { dimension: 'perspective', name: '观点深度', prompt: PERSPECTIVE_SPECIALIST_PROMPT },
  { dimension: 'structure', name: '文章结构', prompt: STRUCTURE_SPECIALIST_PROMPT },
  { dimension: 'dataSupport', name: '数据支撑', prompt: DATA_SUPPORT_SPECIALIST_PROMPT },
  { dimension: 'fluency', name: '流畅度', prompt: FLUENCY_SPECIALIST_PROMPT },
]

function buildSpecialistTask(
  title: string,
  body: string,
  preCheckData: string,
  dimension: DimensionResult['dimension'],
): string {
  return [
    '## 文章标题\n' + title,
    '\n## 文章正文\n' + body,
    '\n' + preCheckData,
    '\n请严格按照评分标准打分，每项扣分都必须有具体位置和原因。\n输出格式要求：只返回 JSON，不要有任何其他文字。',
  ].join('\n')
}

async function evaluateDimension(
  dimension: DimensionResult['dimension'],
  name: string,
  prompt: string,
  title: string,
  body: string,
  preCheckData: string,
  modelConfig: ModelConfig,
): Promise<DimensionResult> {
  const provider = createAgentProvider('review', modelConfig)
  const task = buildSpecialistTask(title, body, preCheckData, dimension)

  const response: ChatResponse = await provider.chat([{ role: 'user', content: task }], {
    temperature: 0.2,
    maxTokens: 4000,
    systemPrompt: prompt,
  })

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  const result = parseDimensionResult(text, dimension)

  console.log(`[ReviewAgent] ${name} score: ${result.score}/10`)
  return result
}

// ============================================================
// Synthesis (autoFix)
// ============================================================

async function runSynthesis(
  title: string,
  body: string,
  dimensionResults: DimensionResult[],
  preCheckIssues: string[],
  modelConfig: ModelConfig,
): Promise<{ fixedBody: string; writerBrief: WriterBrief }> {
  const provider = createAgentProvider('review', modelConfig)

  const synthesisInput = [
    '## 文章标题\n' + title,
    '\n## 文章正文\n' + body,
    '\n## 预检问题\n' + preCheckIssues.map((i) => '- ' + i).join('\n'),
    '\n## 专家评审结果',
    ...dimensionResults.map(
      (r) =>
        `- **${r.dimension}** (${r.score}/10): ${r.reasoning}\n  问题: ${r.issues.join('; ')}\n  建议: ${r.suggestions.join('; ')}`,
    ),
  ].join('\n')

  const response: ChatResponse = await provider.chat(
    [{ role: 'user', content: synthesisInput + '\n\n请根据以上评审结果，生成修复后的文章和写作指南。输出格式要求：只返回 JSON，不要有任何其他文字。' }],
    { temperature: 0.2, maxTokens: 8000, systemPrompt: SYNTHESIS_PROMPT },
  )

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  const jsonStr = extractJsonFromResponse(text)

  let parsed: { fixedBody: string; writerBrief: WriterBrief }
  try {
    parsed = JSON.parse(jsonStr) as { fixedBody: string; writerBrief: WriterBrief }
  } catch (err) {
    const fixedBodyMatch = jsonStr.match(/"fixedBody"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"writerBrief"|}$)/)
    const coreProblemMatch = jsonStr.match(/"coreProblem"\s*:\s*"([\s\S]*?)"/)
    parsed = {
      fixedBody: fixedBodyMatch?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, '\n') ?? body,
      writerBrief: {
        coreProblem: coreProblemMatch?.[1]?.replace(/\\"/g, '"') ?? '评审未通过',
        mustFix: [],
        keepGood: [],
      },
    }
  }

  return {
    fixedBody: parsed.fixedBody ?? body,
    writerBrief: parsed.writerBrief ?? { coreProblem: '评审未通过', mustFix: [], keepGood: [] },
  }
}

// ============================================================
// Main Agent (Lead Orchestrator)
// ============================================================

/**
 * Run review agent with 4 parallel specialist reviewers.
 *
 * Architecture:
 *   Lead (runReviewAgent) → 4 parallel AI calls
 *     ├── perspective-reviewer  → evaluates viewpoint depth
 *     ├── structure-reviewer   → evaluates article structure
 *     ├── data-support-reviewer → evaluates data support
 *     └── fluency-reviewer     → evaluates fluency
 *
 * Lead aggregates results and generates final ReviewResult.
 */
export async function runReviewAgent(
  title: string,
  body: string,
  modelConfig: ModelConfig,
  autoFix: boolean = true,
): Promise<ReviewResult> {
  // 1. Preprocess context
  const reviewBody = stripBase64Images(body).slice(0, 8000)
  const preCheck = runPreCheck(title, reviewBody)
  const preCheckData = buildPreCheckData(reviewBody)

  // 2. Run 4 specialist evaluations in parallel
  const dimensionResults = await Promise.all(
    SPECIALISTS.map((s) =>
      evaluateDimension(s.dimension, s.name, s.prompt, title, reviewBody, preCheckData, modelConfig),
    ),
  )

  // 3. Aggregate results
  const dimensionScores: DimensionScores = {
    perspective: dimensionResults.find((r) => r.dimension === 'perspective')?.score ?? 0,
    structure: dimensionResults.find((r) => r.dimension === 'structure')?.score ?? 0,
    dataSupport: dimensionResults.find((r) => r.dimension === 'dataSupport')?.score ?? 0,
    fluency: dimensionResults.find((r) => r.dimension === 'fluency')?.score ?? 0,
  }

  const scores = Object.values(dimensionScores)
  const totalScore = scores.reduce((a, b) => a + b, 0) / scores.length

  const allIssues = [...preCheck.preCheckIssues, ...dimensionResults.flatMap((r) => r.issues)]
  const allSuggestions = dimensionResults.flatMap((r) => r.suggestions)
  const allReasoning = dimensionResults.map((r) => r.reasoning)

  // 4. Handle autoFix if score < 7.0
  if (totalScore < 7.0 && autoFix) {
    const { fixedBody, writerBrief } = await runSynthesis(
      title,
      reviewBody,
      dimensionResults,
      preCheck.preCheckIssues,
      modelConfig,
    )

    return {
      score: totalScore,
      passed: false,
      dimensionScores,
      reasoning: allReasoning,
      issues: allIssues,
      suggestions: allSuggestions,
      fixedBody,
      writerBrief,
    }
  }

  return {
    score: totalScore,
    passed: totalScore >= 7.0,
    dimensionScores,
    reasoning: allReasoning,
    issues: allIssues,
    suggestions: allSuggestions,
  }
}
