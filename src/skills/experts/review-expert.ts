import type {
  ExpertResult,
  ExpertSkill,
  InputValidation,
  OutputValidation,
  StepType,
} from '@/skills/types'

interface ReviewInput {
  title?: string
  body?: string
  [key: string]: unknown
}

interface ReviewOutput {
  score?: number
  passed?: boolean
  dimensionScores?: {
    perspective?: number
    structure?: number
    dataSupport?: number
    fluency?: number
  }
  issues?: string[]
  suggestions?: string[]
  reasoning?: string[]
  [key: string]: unknown
}

export const reviewExpert: ExpertSkill = {
  step: 'REVIEW' as StepType,
  name: 'ReviewExpert',
  description: '验证文章审核环节的输入输出质量',

  validateInput(input: unknown): InputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (typeof input !== 'object' || input === null) {
      return { valid: false, issues: ['输入必须是对象'] }
    }

    const inp = input as ReviewInput

    if (!inp.title || typeof inp.title !== 'string' || inp.title.trim().length === 0) {
      issues.push('缺少有效的 title 字段（标题不能为空）')
    }

    if (!inp.body || typeof inp.body !== 'string' || inp.body.trim().length === 0) {
      issues.push('缺少有效的 body 字段（正文不能为空）')
    } else {
      // Word count check
      const chineseChars = (inp.body.match(/[\u4e00-\u9fff]/g) ?? []).length
      const englishWords = (inp.body.match(/[a-zA-Z]+/g) ?? []).length
      const totalWords = chineseChars + englishWords

      if (totalWords < 500) {
        warnings.push(`文章过短（${totalWords} 字），可能无法进行有效审核`)
      } else if (totalWords > 10000) {
        warnings.push('文章过长，审核可能超出 token 限制')
      }
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

    const out = output as ReviewOutput

    // Score validation
    if (typeof out.score !== 'number') {
      issues.push('缺少 score 字段或类型错误')
    } else {
      if (out.score < 0 || out.score > 10) {
        issues.push(`score 值 ${out.score} 超出范围 [0, 10]`)
      }
    }

    // Issues array validation
    if (out.issues === undefined) {
      issues.push('缺少 issues 字段')
    } else if (!Array.isArray(out.issues)) {
      issues.push('issues 必须是数组')
    }

    // Suggestions array validation
    if (out.suggestions === undefined) {
      issues.push('缺少 suggestions 字段')
    } else if (!Array.isArray(out.suggestions)) {
      issues.push('suggestions 必须是数组')
    } else {
      // Check suggestions are actionable
      const emptySuggestions = out.suggestions.filter(
        (s) => typeof s !== 'string' || s.trim().length < 10,
      )
      if (emptySuggestions.length > 0) {
        warnings.push(`${emptySuggestions.length} 条建议内容过短，可能不够具体`)
      }
    }

    // Score / issues consistency check
    if (typeof out.score === 'number' && Array.isArray(out.issues)) {
      if (out.score < 7 && out.issues.length === 0) {
        issues.push('score < 7 但 issues 为空，评分与问题列表不一致')
      }
      if (out.score >= 7 && out.issues.length > 0) {
        warnings.push('score >= 7 但存在 issues，可能评分过于宽松')
      }
    }

    // Dimension scores validation
    if (out.dimensionScores) {
      const dims = out.dimensionScores
      const validDimensions = ['perspective', 'structure', 'dataSupport', 'fluency'] as const
      for (const dim of validDimensions) {
        const val = dims[dim]
        if (val !== undefined && (typeof val !== 'number' || val < 0 || val > 10)) {
          issues.push(`dimensionScores.${dim} 值 ${val} 超出范围 [0, 10]`)
        }
      }

      // Score consistency with dimension scores
      if (
        typeof out.score === 'number' &&
        dims.perspective !== undefined &&
        dims.structure !== undefined &&
        dims.dataSupport !== undefined &&
        dims.fluency !== undefined
      ) {
        const computedScore =
          (dims.perspective + dims.structure + dims.dataSupport + dims.fluency) / 4
        const diff = Math.abs(computedScore - out.score)
        if (diff > 1) {
          warnings.push(
            `score(${out.score})与各维度平均分(${computedScore.toFixed(1)})差异较大，可能计算有误`,
          )
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      score: typeof out.score === 'number' ? out.score : undefined,
    }
  },

  async review(input: unknown, output: unknown): Promise<ExpertResult> {
    const inpValidation = this.validateInput(input)
    const outValidation = this.validateOutput(input, output)

    const allIssues = [
      ...(inpValidation.issues ?? []),
      ...(outValidation.issues ?? []),
    ]
    const allWarnings = [
      ...(inpValidation.warnings ?? []),
      ...(outValidation.warnings ?? []),
    ]

    const out = output as ReviewOutput

    let status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP' = 'PASS'
    if (allIssues.length > 0) status = 'FAIL'
    else if (allWarnings.length > 0) status = 'WARN'

    const recommendations: string[] = []

    if (typeof out.score === 'number') {
      if (out.score < 5) {
        recommendations.push('文章质量较差，建议重新生成或进行大幅修改')
      } else if (out.score < 7) {
        recommendations.push('文章接近质量门槛，请根据 issues 逐项修改')
      }

      // Check dimension scores for specific recommendations
      if (out.dimensionScores) {
        const dims = out.dimensionScores
        if (dims.perspective !== undefined && dims.perspective < 5) {
          recommendations.push('观点深度不足，建议强化核心观点输出，避免"理中客"表述')
        }
        if (dims.structure !== undefined && dims.structure < 5) {
          recommendations.push('文章结构需改进，建议完善开头 Hook 和结尾收束')
        }
        if (dims.dataSupport !== undefined && dims.dataSupport < 5) {
          recommendations.push('数据支撑不足，建议增加具体数字和案例')
        }
        if (dims.fluency !== undefined && dims.fluency < 5) {
          recommendations.push('流畅度问题，建议检查病句和错别字')
        }
      }
    }

    if (!out.fixedBody && typeof out.score === 'number' && out.score < 7) {
      recommendations.push('score < 7 但未提供 fixedBody，建议启用自动修复模式')
    }

    if (Array.isArray(out.suggestions) && out.suggestions.length === 0) {
      recommendations.push('未提供具体修改建议，请确保 suggestions 包含可执行的操作指引')
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
        step: 'REVIEW' as StepType,
        timestamp: new Date(),
      },
      recommendations,
    }
  },
}
