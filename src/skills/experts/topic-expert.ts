import type {
  ExpertResult,
  ExpertSkill,
  InputValidation,
  OutputValidation,
  StepType,
} from '@/skills/types'

interface TopicInput {
  trendItems?: TopicItemRaw[]
  [key: string]: unknown
}

interface TopicItemRaw {
  title?: string
  link?: string
  pubDate?: string
  snippet?: string
  source?: string
  [key: string]: unknown
}

interface TopicOutput {
  topics?: TopicSuggestionRaw[]
  [key: string]: unknown
}

interface TopicSuggestionRaw {
  title?: string
  angle?: string
  summary?: string
  heatScore?: number
  tags?: unknown[]
  sources?: TopicSourceRaw[]
  [key: string]: unknown
}

interface TopicSourceRaw {
  title?: string
  url?: string
  source?: string
  [key: string]: unknown
}

const BAD_ANGLE_PATTERNS = [
  /从[\u4e00-\u9fa5]{1,20}(?:财报|报告|数据)?看[\u4e00-\u9fa5]{2,}(?:趋势|发展|前景|格局)/, // "从XX看YY趋势"
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

const BAD_TITLE_PATTERNS = [
  /一文读懂/,
  /深度解读/,
  /行业分析报告/,
  /^XX/,
  /XX行业/,
]

const META_NARRATIVE_PATTERNS = [/本文/, /本篇/, /这篇文章/, /本文将/, /本篇将/, /本报告/]

function isUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value)
}

function isWithinDays(pubDate: string, days: number): boolean {
  const pubTime = new Date(pubDate).getTime()
  if (isNaN(pubTime)) return false
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000
  return pubTime >= threshold
}

export const topicExpert: ExpertSkill = {
  step: 'TOPIC_SELECT' as StepType,
  name: 'TopicExpert',
  description: '验证选题筛选环节的输入输出质量',

  validateInput(input: unknown): InputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (typeof input !== 'object' || input === null) {
      return { valid: false, issues: ['输入必须是对象'] }
    }

    const inp = input as Partial<TopicInput>

    if (!inp.trendItems || !Array.isArray(inp.trendItems)) {
      return { valid: false, issues: ['缺少 trendItems 字段或类型错误'] }
    }

    if (inp.trendItems.length < 5) {
      issues.push(`trendItems 条数不足：当前 ${inp.trendItems.length} 条，要求至少 5 条`)
    }

    // Freshness check
    const freshCount = inp.trendItems.filter(
      (item) => item.pubDate && isWithinDays(item.pubDate, 7),
    ).length
    const freshRatio = inp.trendItems.length > 0 ? freshCount / inp.trendItems.length : 0
    if (freshRatio < 0.5) {
      warnings.push(`trendItems 新鲜度偏低：仅 ${(freshRatio * 100).toFixed(0)}% 在 7 天内`)
    }

    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  },

  validateOutput(input: unknown, output: unknown): OutputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (typeof output !== 'object' || output === null) {
      return { valid: false, issues: ['输出必须是对象'] }
    }

    const out = output as Partial<TopicOutput>

    if (!out.topics || !Array.isArray(out.topics)) {
      return { valid: false, issues: ['输出缺少 topics 字段或类型错误'] }
    }

    if (out.topics.length === 0) {
      issues.push('topics 数组为空，未筛选出任何选题')
    }

    for (let i = 0; i < out.topics.length; i++) {
      const topic = out.topics[i]

      // angle validation
      if (!topic.angle || typeof topic.angle !== 'string' || topic.angle.trim() === '') {
        issues.push(`topics[${i}] 缺少字段 "angle" 或值为空`)
      } else {
        const angleLen = topic.angle.trim().length
        if (angleLen < 15) {
          issues.push(`topics[${i}].angle 过短（${angleLen} 字，最少 15 字）`)
        } else if (angleLen > 80) {
          warnings.push(`topics[${i}].angle 过长（${angleLen} 字，建议不超过 80 字）`)
        }
        for (const pattern of BAD_ANGLE_PATTERNS) {
          if (pattern.test(topic.angle)) {
            warnings.push(
              `topics[${i}].angle 匹配淘汰模式（描述性 angle）：${topic.angle.slice(0, 40)}...`,
            )
            break
          }
        }
      }

      // title validation
      if (!topic.title || typeof topic.title !== 'string' || topic.title.trim() === '') {
        issues.push(`topics[${i}] 缺少字段 "title" 或值为空`)
      } else {
        for (const pattern of BAD_TITLE_PATTERNS) {
          if (pattern.test(topic.title)) {
            warnings.push(
              `topics[${i}].title 匹配淘汰模式：${topic.title.slice(0, 40)}...`,
            )
            break
          }
        }
      }

      // summary validation
      const summaryStr = typeof topic.summary === 'string' ? topic.summary.trim() : ''
      if (!summaryStr) {
        issues.push(`topics[${i}] 缺少字段 "summary" 或值为空`)
      } else if (summaryStr.length < 10) {
        issues.push(`topics[${i}].summary 过短（${summaryStr.length} 字，最少 10 字）`)
      } else {
        for (const pattern of META_NARRATIVE_PATTERNS) {
          if (pattern.test(summaryStr)) {
            warnings.push(
              `topics[${i}].summary 包含元叙述（"本文/本篇"等禁止词）：${summaryStr.slice(0, 40)}...`,
            )
            break
          }
        }
      }

      // heatScore range validation
      if (topic.heatScore !== undefined) {
        if (typeof topic.heatScore !== 'number') {
          issues.push(`topics[${i}].heatScore 类型错误（需要 number）`)
        } else if (topic.heatScore < 1 || topic.heatScore > 10) {
          issues.push(`topics[${i}].heatScore 值 ${topic.heatScore} 超出范围 [1, 10]`)
        } else if (topic.heatScore < 5) {
          warnings.push(`topics[${i}].heatScore 为 ${topic.heatScore}（低于 5 分选题质量不足，建议淘汰）`)
        }
      } else {
        warnings.push(`topics[${i}] 缺少字段 "heatScore"`)
      }

      // sources validation
      if (Array.isArray(topic.sources)) {
        for (let j = 0; j < topic.sources.length; j++) {
          const src = topic.sources[j]
          if (!src.url || !isUrl(src.url)) {
            warnings.push(`topics[${i}].sources[${j}].url 格式错误或为空：${src.url ?? ''}`)
          }
        }
        if (topic.sources.length === 0) {
          warnings.push(`topics[${i}].sources 为空，缺少引用来源`)
        }
      } else {
        warnings.push(`topics[${i}] 缺少字段 "sources" 或类型错误`)
      }
    }

    // Compute quality score
    let score: number | undefined
    if (issues.length === 0) {
      const baseScore = 6
      const angleQualityBonus = out.topics.filter((t) => {
        if (!t.angle) return false
        return !BAD_ANGLE_PATTERNS.some((p) => p.test(t.angle!))
      }).length / Math.max(out.topics.length, 1) * 2 // up to +2
      const heatScoreBonus = out.topics.reduce((acc, t) => {
        if (typeof t.heatScore === 'number') return acc + t.heatScore
        return acc
      }, 0) / Math.max(out.topics.length, 1) / 10 * 1 // up to +1
      score = Math.min(10, baseScore + angleQualityBonus + heatScoreBonus)
    }

    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      score,
    }
  },

  async review(input: unknown, output: unknown): Promise<ExpertResult> {
    const inpValidation = this.validateInput(input)
    const outValidation = this.validateOutput(input, output)

    const allIssues = [...(inpValidation.issues ?? []), ...(outValidation.issues ?? [])]
    const allWarnings = [...(inpValidation.warnings ?? []), ...(outValidation.warnings ?? [])]

    const out = output as Partial<TopicOutput>

    let status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP' = 'PASS'
    if (allIssues.length > 0) status = 'FAIL'
    else if (allWarnings.length > 0) status = 'WARN'

    const recommendations: string[] = []

    if (out.topics) {
      if (out.topics.length === 0) {
        recommendations.push('未筛选出任何选题，建议检查 trendItems 质量或调整 LLM 提示词')
      }

      // angle quality analysis
      const badAngleCount = out.topics.filter((t) =>
        t.angle && BAD_ANGLE_PATTERNS.some((p) => p.test(t.angle!)),
      ).length
      if (badAngleCount > 0) {
        recommendations.push(
          `${badAngleCount} 个选题的 angle 属于淘汰类型（描述性/无观点），建议强化 angle 锐度要求`,
        )
      }

      // angle length analysis
      const shortAngleCount = out.topics.filter(
        (t) => typeof t.angle === 'string' && t.angle.trim().length < 15,
      ).length
      if (shortAngleCount > 0) {
        recommendations.push(
          `${shortAngleCount} 个选题的 angle 过短（<15 字），不符合 15-80 字要求，建议补充具体数据或洞察`,
        )
      }

      // summary meta-narrative analysis
      const metaSummaryCount = out.topics.filter((t) =>
        typeof t.summary === 'string' &&
        META_NARRATIVE_PATTERNS.some((p) => p.test(t.summary!)),
      ).length
      if (metaSummaryCount > 0) {
        recommendations.push(
          `${metaSummaryCount} 个选题的 summary 包含"本文/本篇"等元叙述，禁止此类写法，应直接描述读者价值`,
        )
      }

      // heatScore analysis
      const avgHeat =
        out.topics.reduce((acc, t) => acc + (typeof t.heatScore === 'number' ? t.heatScore : 0), 0) /
        Math.max(out.topics.length, 1)
      if (avgHeat < 5) {
        recommendations.push(`选题平均热度 ${avgHeat.toFixed(1)} 分偏低，建议筛选更热门的趋势主题`)
      }

      // source coverage
      const topicsWithSources = out.topics.filter(
        (t) => Array.isArray(t.sources) && t.sources.length > 0,
      ).length
      if (topicsWithSources < out.topics.length) {
        recommendations.push(
          `${out.topics.length - topicsWithSources} 个选题缺少引用来源，建议每个选题至少包含 1 个可验证来源`,
        )
      }

      // Check sources URL validity
      for (let i = 0; i < out.topics.length; i++) {
        const topic = out.topics[i]
        if (Array.isArray(topic.sources)) {
          const validUrls = topic.sources.filter((s) => s.url && isUrl(s.url))
          if (validUrls.length === 0) {
            recommendations.push(
              `topics[${i}] 所有来源 URL 均无效，建议使用可验证的真实链接`,
            )
          }
        }
      }
    }

    return {
      verificationReport: {
        status,
        inputValidation: inpValidation,
        outputValidation: outValidation,
        issues: allIssues,
        warnings: allWarnings,
        score: outValidation.score,
        suggestions: recommendations,
        step: 'TOPIC_SELECT' as StepType,
        timestamp: new Date(),
      },
      recommendations,
    }
  },
}
