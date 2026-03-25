import { createAgentProvider, type ModelConfig, type ChatResponse } from '@/lib/ai'

export interface DimensionScores {
  perspective: number   // 观点深度 (0-10): 观点鲜明有立场，不是理中客；有独特洞察
  structure: number     // 文章结构 (0-10): 开头钩子、中间论证、结尾收束；章节标题自带观点
  dataSupport: number   // 数据支撑 (0-10): 具体公司/产品/数字 ≥ 5处，有来源或合理解释
  fluency: number        // 流畅度 (0-10): 语句通顺无语病，无空洞套话，标点正确
}

export interface WriterBriefMustFix {
  priority: 'P0' | 'P1' | 'P2'
  location: string
  problem: string
  fix: string
}

export interface WriterBrief {
  coreProblem: string
  mustFix: WriterBriefMustFix[]
  keepGood: string[]
}

export interface ReviewResult {
  score: number
  passed: boolean
  dimensionScores: DimensionScores
  reasoning: string[]        // 每项扣分的原因说明，对应 dimensionScores 的每一项
  issues: string[]            // 具体问题列表，带段落位置引用
  suggestions: string[]       // 按优先级排序的可执行修改建议
  fixedBody?: string          // score < 7.0 时输出修复后的完整正文
  writerBrief?: WriterBrief   // score < 7.0 时输出的精炼写作修改指南
}

// ============================================================
// 审核 Prompt — 对齐「科技猫」写作规范（优化版 v2）
// ============================================================
const REVIEW_SYSTEM_PROMPT = `你是一位严格的「科技猫」公众号编辑，审核 AI/科技类文章是否符合品牌写作规范。

## 预检（评分前必须完成）

扫描文章标记以下问题：
- A. 废话开场：开头300字是否为"随着XX发展..."/"在XX时代..."/"近年来..."/"本文将..."型
- B. 废话结尾：结尾200字是否含"感谢阅读"/"希望有帮助"/"祝好"/"以上就是全部内容"
- C. 描述性标题：## 标题是否为"第一章"型编号或"市场分析"/"行业现状"型无观点描述（合格标题应自带观点）

## 评分标准（4项各10分，均值为总分）

### 1. 观点深度 (perspective)
| 分数 | 条件 |
|------|------|
| 9-10 | 核心观点明确亮出+有独特洞察+无"理中客"表述 |
| 7-8 | 有明确观点但洞察被常识稀释 |
| 5-6 | 观点模糊，信息罗列多于观点输出 |
| 0-4 | 几乎无观点，全篇定性描述或废话套话 |

"理中客"定义：同时声称"XX有道理YY也有道理"/"见仁见智"；"一方面...另一方面..."两边辩护；"需要综合考虑"。每处扣3分。空洞废话每处扣2分。

### 2. 文章结构 (structure)
| 分数 | 条件 |
|------|------|
| 9-10 | 开头300字内有Hook+章节标题自带观点+结尾三层次（观点总结+行动建议+留白） |
| 7-8 | Hook合格+结尾基本合格+不超过1处描述性标题 |
| 5-6 | 背景介绍式开头（扣5分）+描述性标题（每处扣3分）+结尾空洞 |
| 0-4 | 全文无结构 |

废话结尾扣10分；要点罗列结尾扣5分；三层次缺一扣3分。

### 3. 数据支撑 (dataSupport)
具体数据 = 公司/产品名+具体数字 或 有来源的百分比/对比。"投入大量资金"不算。
| 分数 | 条件 |
|------|------|
| 9-10 | >= 5处具体数据，大部分有来源 |
| 7-8 | 3-4处具体数据 |
| 5-6 | 1-2处数据或大量空洞描述 |
| 0-4 | 无具体数据 |

空洞无来源数据每个扣2分。

### 4. 流畅度 (fluency)
| 分数 | 条件 |
|------|------|
| 9-10 | 无病句无错别字标点正确 |
| 7-8 | 1-2处语病 |
| 5-6 | 3-5处语病 |
| 0-4 | 超5处语病 |

每处语病/错别字扣1分（上限5分）。

## 总分 = (perspective + structure + dataSupport + fluency) / 4，>= 7.0 通过

## 输出格式（严格JSON，无其他文字）

score >= 7.0 时：
{ "score", "passed": true, "dimensionScores": {...}, "reasoning": [...每项扣分原因], "preCheckIssues": [...], "issues": [], "suggestions": [...] }

score < 7.0 时额外输出 fixedBody + writerBrief：
{ "score", "passed": false, "dimensionScores", "reasoning", "preCheckIssues",
  "issues": ["【问题类型】【位置】具体问题+扣分"],
  "suggestions": [按高/中/低优先级排序],
  "writerBrief": { "coreProblem": "一句话核心失败原因", "mustFix": [{ "priority":"P0/P1/P2", "location", "problem", "fix":"改成这样：XXX" }], "keepGood": [...] },
  "fixedBody": "完整修复后正文（逐条解决issues，保留配图占位符）"
}

## issues 规范
必须包含：具体位置+具体问题+扣分分值。禁止模糊表述如"整体不够深入""建议优化"。

## fixedBody 标准
1. 逐条解决 issues  2. 不引入新问题  3. 不改核心观点和数据  4. 保留 ![描述](cover) 占位符`

/**
 * Dynamically extract company/brand/product entities from article text
 * using pattern-based heuristics (no hardcoded list).
 */
function extractEntities(text: string): string[] {
  const entities = new Set<string>()

  // English brand names: capitalized words or known patterns (2+ chars, not common English words)
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

  // Chinese company/brand patterns: 2-6 char names followed by entity suffixes
  const cnCorpMatches = text.match(/[\u4e00-\u9fff]{2,6}(?:科技|集团|公司|资本|智能|机器人|半导体)/g) ?? []
  for (const m of cnCorpMatches) {
    entities.add(m)
  }

  // Abbreviations / all-caps tech brands (e.g., NVIDIA, AI, API excluded)
  const abbrevMatches = text.match(/\b[A-Z]{2,10}\b/g) ?? []
  const excludeAbbrev = new Set(['AI', 'API', 'URL', 'SDK', 'SaaS', 'GPU', 'CPU', 'LLM', 'NLP', 'ML', 'AR', 'VR', 'MR', 'XR', 'IoT', 'USB', 'HTML', 'CSS', 'HTTP', 'JSON', 'XML', 'SQL', 'RSS'])
  for (const a of abbrevMatches) {
    if (!excludeAbbrev.has(a) && a.length >= 3) {
      entities.add(a)
    }
  }

  return [...entities].slice(0, 30)
}

export async function runReviewAgent(
  title: string,
  body: string,
  modelConfig: ModelConfig,
  autoFix: boolean = true,
): Promise<ReviewResult> {
  // Strip base64 images from body to avoid token limit overflow.
  // Replace ![desc](data:image/jpeg;base64,...) with ![desc](image) for review.
  const reviewBody = body
    .replace(/!\[([^\]]*)\]\(data:image\/jpeg;base64,[^)]+\)/g, '![$1](image)')
    .slice(0, 8000) // Truncate to 8000 chars to stay within token limits

  const provider = createAgentProvider('review', modelConfig)

  const wordCount = countChineseWords(reviewBody)
  const imagePlaceholders = reviewBody.match(/!\[.*?\]\(cover\)/g) ?? []
  const imageCount = imagePlaceholders.length

  // Dynamically extract company/brand/product entities from article text
  const detectedCompanies = extractEntities(reviewBody)

  // Count data/numbers
  const numbers = reviewBody.match(/\d+(\.\d+)?[%亿万千万亿]?/g) ?? []
  const dataPoints = numbers.slice(0, 20).join('、')

  const preCheckData = [
    '## 预检数据（仅供参考，请实际阅读正文判断）',
    '字数：' + wordCount + ' 字',
    '配图占位符：' + imageCount + ' 张',
    '检测到的公司/品牌名：' + (detectedCompanies.length > 0 ? detectedCompanies.join('、') : '无'),
    '检测到的数字/数据：' + (dataPoints || '无'),
  ].join('\n')

  const userPrompt =
    REVIEW_SYSTEM_PROMPT +
    '\n\n## 文章标题\n' +
    title +
    '\n\n## 文章正文\n' +
    reviewBody +
    '\n\n' +
    preCheckData +
    '\n\n请逐一阅读每个章节，严格按照评分标准打分，每项扣分都必须有具体位置和原因。\n输出格式要求：只返回 JSON，不要有任何其他文字。'

  const response: ChatResponse = await provider.chat(
    [{ role: 'user', content: userPrompt }],
    { temperature: 0.2, maxTokens: 5000, systemPrompt: REVIEW_SYSTEM_PROMPT },
  )

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')

  // Extract JSON from markdown code block or raw JSON
  let jsonStr = text.trim()
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/)
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1]
  }
  const start = jsonStr.indexOf('{')
  const end = jsonStr.lastIndexOf('}')

  if (start === -1 || end === -1) {
    throw new Error('ReviewAgent returned invalid JSON. Raw: ' + text.slice(0, 500))
  }

  const parsed = JSON.parse(jsonStr.slice(start, end + 1)) as ReviewResult

  return {
    score: parsed.score ?? 0,
    passed: parsed.passed ?? (parsed.score ?? 0) >= 7.0,
    dimensionScores: parsed.dimensionScores ?? {
      perspective: 0,
      structure: 0,
      dataSupport: 0,
      fluency: 0,
    },
    reasoning: parsed.reasoning ?? [],
    issues: parsed.issues ?? [],
    suggestions: parsed.suggestions ?? [],
    fixedBody: parsed.fixedBody ?? undefined,
    writerBrief: parsed.writerBrief ?? undefined,
  }
}

function countChineseWords(text: string): number {
  // Matches the implementation in writer.ts for consistency.
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
  const englishWords = text.match(/[a-zA-Z]+/g)?.length ?? 0
  const digitCount = text.match(/\d/g)?.length ?? 0
  return chineseChars + englishWords + Math.ceil(digitCount * 0.5)
}
