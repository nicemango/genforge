import type {
  ExpertSkill,
  InputValidation,
  OutputValidation,
  ExpertResult,
  VerificationReport,
  VerificationStatus,
} from '@/skills/types'
import type { ResearchResult } from '@/agents/research'
import type { TopicSuggestion } from '@/agents/topic'

interface ResearchExpertInput {
  topic: TopicSuggestion
}

interface ResearchExpertOutput {
  summary: string
  keyPoints: string[]
  sources: Array<{ title: string; url: string; verified?: boolean }>
  rawOutput: string
  /** 真实案例数据，可能为 cases 或 realCases 等字段名 */
  cases?: Array<{ company?: string; product?: string; [key: string]: unknown }>
  /** 专家原话引用 */
  expertQuotes?: Array<{ person?: string; quote?: string; source?: string }>
  /** 争议与反驳观点 */
  controversies?: Array<{ viewpoint?: string; reason?: string; data?: string }>
}

export class ResearchExpert implements ExpertSkill {
  readonly step = 'RESEARCH' as const
  readonly name = 'ResearchExpert'
  readonly description = 'Research 环节质量验证专家 - 验证研究环节输入输出的完整性和数据质量'

  validateInput(input: unknown): InputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (!input || typeof input !== 'object') {
      return { valid: false, issues: ['输入必须是对象'] }
    }

    const inp = input as Partial<ResearchExpertInput>

    // 验证 topic 存在
    if (!inp.topic) {
      issues.push('缺少 topic 字段')
      return { valid: false, issues }
    }

    // 验证 topic.angle 非空字符串
    if (!inp.topic.angle || typeof inp.topic.angle !== 'string' || inp.topic.angle.trim() === '') {
      issues.push('topic.angle 必须是非空字符串')
    }

    // 验证 topic.sources 是非空数组
    if (!Array.isArray(inp.topic.sources)) {
      issues.push('topic.sources 必须是数组')
    } else {
      if (inp.topic.sources.length === 0) {
        issues.push('topic.sources 数组不能为空')
      }
      inp.topic.sources.forEach((source, index) => {
        if (!source.title || typeof source.title !== 'string') {
          issues.push(`topic.sources[${index}].title 必须是非空字符串`)
        }
        if (!source.url || typeof source.url !== 'string') {
          issues.push(`topic.sources[${index}].url 必须是非空字符串`)
        }
      })
    }

    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  validateOutput(input: unknown, output: unknown): OutputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (!output || typeof output !== 'object') {
      return { valid: false, issues: ['输出必须是对象'] }
    }

    const out = output as Partial<ResearchExpertOutput>

    // 验证 summary 存在且非空
    if (!out.summary || typeof out.summary !== 'string' || out.summary.trim() === '') {
      issues.push('output.summary 存在且必须是非空字符串')
    }

    // 验证 keyPoints 是数组，元素 >= 3
    if (!Array.isArray(out.keyPoints)) {
      issues.push('output.keyPoints 必须是数组')
    } else if (out.keyPoints.length < 3) {
      issues.push(`output.keyPoints 长度不足：当前 ${out.keyPoints.length} 条，要求至少 3 条`)
    }

    // 验证 sources 数据点 >= 8
    // 从 rawOutput 中统计关键数据条数（以 -- 分隔的数据行）
    const dataPointMatches = out.rawOutput?.match(/--\s*[\u4e00-\u9fff\u3400-\u4dbf\w]+/g) ?? []
    const extractedDataPoints = dataPointMatches.length

    // 也尝试从 sources 数组长度判断（如果 rawOutput 不可用）
    const sourceDataPoints = Array.isArray(out.sources) ? out.sources.length : 0
    const totalDataPoints = Math.max(extractedDataPoints, sourceDataPoints)

    if (totalDataPoints < 8) {
      issues.push(`数据点不足：当前 ${totalDataPoints} 条，要求至少 8 条`)
    }

    // 验证 cases 案例 >= 3
    const casesArray = out.cases
    const caseCount = Array.isArray(casesArray) ? casesArray.length : 0

    // 也尝试从 rawOutput 中提取案例数量
    const rawCaseMatches = out.rawOutput?.match(/###\s*【[^】]+】/g) ?? []
    const rawCaseCount = rawCaseMatches.length

    const totalCases = Math.max(caseCount, rawCaseCount)
    if (totalCases < 3) {
      issues.push(`真实案例不足：当前 ${totalCases} 个，要求至少 3 个`)
    }

    // 验证 expertQuotes 专家原话 >= 3
    const quotesArray = out.expertQuotes
    const quoteCount = Array.isArray(quotesArray) ? quotesArray.length : 0

    // 也尝试从 rawOutput 中提取专家引用数量
    const rawQuoteMatches = out.rawOutput?.match(/(?:专家|创始人)[与和]?\S+[：:][""]/g) ?? []
    const rawQuoteCount = rawQuoteMatches.length

    const totalQuotes = Math.max(quoteCount, rawQuoteCount)
    if (totalQuotes < 3) {
      issues.push(`专家引用不足：当前 ${totalQuotes} 条，要求至少 3 条`)
    }

    // 验证 controversies 争议点 >= 2
    const controversiesArray = out.controversies
    const controversyCount = Array.isArray(controversiesArray) ? controversiesArray.length : 0

    // 也尝试从 rawOutput 中提取争议数量
    const rawControversyMatches = out.rawOutput?.match(/##\s*(?:争议|反驳)/g) ?? []
    const rawControversyCount = rawControversyMatches.length

    const totalControversies = Math.max(controversyCount, rawControversyCount)
    if (totalControversies < 2) {
      issues.push(`争议点不足：当前 ${totalControversies} 条，要求至少 2 条`)
    }

    // 数据溯源质量检查
    if (out.rawOutput) {
      const vagueSources = [
        '据报道',
        '据悉',
        '网络消息',
        '知情人士',
        '市场观察',
        '公开资料',
      ]
      for (const phrase of vagueSources) {
        if (out.rawOutput.includes(phrase)) {
          warnings.push(`发现模糊溯源词汇："${phrase}"，应使用具体来源`)
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  async review(input: unknown, output: unknown): Promise<ExpertResult> {
    const inputValidation = this.validateInput(input)
    const outputValidation = this.validateOutput(input, output)

    const allIssues = [
      ...(inputValidation.issues ?? []),
      ...(outputValidation.issues ?? []),
    ]

    const allWarnings = [
      ...(inputValidation.warnings ?? []),
      ...(outputValidation.warnings ?? []),
    ]

    // 计算综合评分
    const score = this.calculateScore(input, output, outputValidation)

    // 确定验证状态
    let status: VerificationStatus = 'PASS'
    if (!inputValidation.valid) {
      status = 'FAIL'
    } else if (!outputValidation.valid) {
      status = 'FAIL'
    } else if (allWarnings.length > 0) {
      status = 'WARN'
    }

    const suggestions = this.generateSuggestions(input, output, outputValidation, allIssues, allWarnings)

    const report: VerificationReport = {
      status,
      inputValidation,
      outputValidation,
      issues: allIssues,
      warnings: allWarnings,
      score,
      suggestions,
      step: this.step,
      timestamp: new Date(),
    }

    return {
      verificationReport: report,
      recommendations: suggestions,
    }
  }

  private calculateScore(
    input: unknown,
    output: unknown,
    outputValidation: OutputValidation
  ): number {
    let score = 10.0

    const out = output as Partial<ResearchExpertOutput>

    // 输入问题扣分
    const inputVal = this.validateInput(input)
    if (!inputVal.valid) {
      score -= (inputVal.issues?.length ?? 0) * 2
    }

    // 数据完整性扣分
    if (Array.isArray(out.keyPoints) && out.keyPoints.length < 5) {
      score -= (5 - out.keyPoints.length) * 0.5
    }

    // 数据点不足扣分
    const dataPointMatches = out.rawOutput?.match(/--\s*[\u4e00-\u9fff\u3400-\u4dbf\w]+/g) ?? []
    const dataPointCount = dataPointMatches.length
    if (dataPointCount < 8) {
      score -= (8 - dataPointCount) * 0.3
    }

    // 专家引用不足扣分
    const quoteMatches = out.rawOutput?.match(/(?:专家|创始人)[与和]?\S+[：:][""]/g) ?? []
    const quoteCount = quoteMatches.length
    if (quoteCount < 3) {
      score -= (3 - quoteCount) * 0.5
    }

    // 争议点不足扣分
    const controversyMatches = out.rawOutput?.match(/##\s*(?:争议|反驳)/g) ?? []
    const controversyCount = controversyMatches.length
    if (controversyCount < 2) {
      score -= (2 - controversyCount) * 0.5
    }

    // 数据溯源模糊度扣分
    const vagueTerms = ['据报道', '据悉', '网络消息', '知情人士']
    let vagueCount = 0
    for (const term of vagueTerms) {
      vagueCount += (out.rawOutput?.match(new RegExp(term, 'g')) ?? []).length
    }
    score -= vagueCount * 0.2

    // 警告项扣分
    score -= (outputValidation.warnings?.length ?? 0) * 0.3

    return Math.max(0, Math.round(score * 10) / 10)
  }

  private generateSuggestions(
    input: unknown,
    output: unknown,
    outputValidation: OutputValidation,
    issues: string[],
    warnings: string[]
  ): string[] {
    const suggestions: string[] = []

    const out = output as Partial<ResearchExpertOutput>

    // 基于问题生成建议
    if (issues.some((i) => i.includes('keyPoints'))) {
      suggestions.push('建议：增加更多关键论点，确保每个论点都有数据支撑')
    }

    if (issues.some((i) => i.includes('数据点不足'))) {
      suggestions.push('建议：补充更多具体数字数据（市场规模、增长率、融资额等），每个数据必须标注来源')
    }

    if (issues.some((i) => i.includes('真实案例不足'))) {
      suggestions.push('建议：增加真实公司/产品案例，包含具体事件、结果数据和来源链接')
    }

    if (issues.some((i) => i.includes('专家引用不足'))) {
      suggestions.push('建议：补充专家/创始人原话引用，需包含人名、职位、具体发言内容及来源URL')
    }

    if (issues.some((i) => i.includes('争议点不足'))) {
      suggestions.push('建议：增加争议与反驳观点，需包含对立观点、理由和支撑数据')
    }

    // 基于警告生成建议
    if (warnings.some((w) => w.includes('模糊溯源'))) {
      suggestions.push('建议：所有数据必须使用具体来源，禁止"据报道""据悉"等模糊表述')
    }

    // 数据深度检查
    if (out.rawOutput) {
      // 检查是否包含足够的数据格式
      const hasNumbers = /\d+([.%\u4e07\u4ebf\u5143\u7f72])?/.test(out.rawOutput)
      if (!hasNumbers) {
        suggestions.push('建议：研究结果中缺少具体数字数据，需要补充量化信息')
      }

      // 检查是否包含案例公司
      const hasCompanies = /[\u4e00-\u9fff]{2,6}(?:科技|集团|公司|资本|智能)/.test(out.rawOutput)
      if (!hasCompanies) {
        suggestions.push('建议：研究结果中缺少具体公司案例，需要补充真实公司/产品案例')
      }
    }

    return suggestions
  }
}
