import type {
  ExpertSkill,
  InputValidation,
  OutputValidation,
  ExpertResult,
  VerificationReport,
  VerificationStatus,
} from '@/skills/types'
import type { WriterResult } from '@/agents/writer'
import type { DimensionScores } from '@/agents/review'
import type { TopicSuggestion } from '@/agents/topic'
import type { ResearchResult } from '@/agents/research'

interface WriteExpertInput {
  researchResult: ResearchResult
  topic: TopicSuggestion
}

interface WriteExpertOutput {
  title?: string
  body: string
  summary?: string
  wordCount?: number
  /** 维度评分（可选，由 ReviewAgent 提供时使用） */
  dimensionScores?: DimensionScores
  /** 审核评分（可选） */
  score?: number
}

export class WriteExpert implements ExpertSkill {
  readonly step = 'WRITE' as const
  readonly name = 'WriteExpert'
  readonly description = 'Write 环节质量验证专家 - 验证写作环节输入输出的完整性和文章质量'

  validateInput(input: unknown): InputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (!input || typeof input !== 'object') {
      return { valid: false, issues: ['输入必须是对象'] }
    }

    const inp = input as Partial<WriteExpertInput>

    // 验证 researchResult 存在
    if (!inp.researchResult) {
      issues.push('缺少 researchResult 字段')
    } else {
      // researchResult 应包含必要的字段
      if (!inp.researchResult.summary) {
        warnings.push('researchResult.summary 为空，研究资料摘要缺失')
      }
      if (!Array.isArray(inp.researchResult.keyPoints) || inp.researchResult.keyPoints.length === 0) {
        warnings.push('researchResult.keyPoints 为空或缺失，研究要点缺失')
      }
    }

    // 验证 topic 存在且 topic.angle 非空
    if (!inp.topic) {
      issues.push('缺少 topic 字段')
    } else {
      if (!inp.topic.angle || typeof inp.topic.angle !== 'string' || inp.topic.angle.trim() === '') {
        issues.push('topic.angle 必须是非空字符串')
      }
      if (!inp.topic.title) {
        warnings.push('topic.title 缺失，可能影响文章标题生成')
      }
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

    const out = output as Partial<WriteExpertOutput>

    // 验证 body 存在且是字符串
    if (!out.body || typeof out.body !== 'string') {
      issues.push('output.body 必须存在且是字符串')
      return {
        valid: false,
        issues,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    }

    if (out.body.trim() === '') {
      issues.push('output.body 不能为空字符串')
    }

    // 验证字数 2000-2800（允许 ±10% 容差，即 1800-3080）
    const wordCount = this.countChineseWords(out.body)
    if (wordCount < 1800) {
      issues.push(`文章字数不足：当前 ${wordCount} 字，要求至少 1800 字（容差下限）`)
    } else if (wordCount > 3080) {
      warnings.push(`文章字数偏多：当前 ${wordCount} 字，建议控制在 2800 字以内`)
    }

    // 验证无空洞开场
    const firstParagraph = this.extractFirstParagraph(out.body)
    if (this.hasEmptyOpening(firstParagraph)) {
      issues.push('文章以空洞套话开场（如"随着XX发展""近年来XX"），不符合品牌写作规范')
    }

    // 验证无废话结尾
    const lastParagraph = this.extractLastParagraph(out.body)
    if (this.hasRedundantEnding(lastParagraph)) {
      issues.push('文章以废话套话结尾（如"感谢阅读""综上所述"），不符合品牌写作规范')
    }

    // 验证 4 个维度评分各 >= 7
    if (out.dimensionScores) {
      const scores = out.dimensionScores
      if (scores.perspective < 7) {
        issues.push(`观点深度评分不足：${scores.perspective}/10，要求 >= 7`)
      }
      if (scores.structure < 7) {
        issues.push(`文章结构评分不足：${scores.structure}/10，要求 >= 7`)
      }
      if (scores.dataSupport < 7) {
        issues.push(`数据支撑评分不足：${scores.dataSupport}/10，要求 >= 7`)
      }
      if (scores.fluency < 7) {
        issues.push(`流畅度评分不足：${scores.fluency}/10，要求 >= 7`)
      }
    }

    // 内容充实度检查
    const sectionCount = (out.body.match(/^##\s+/gm) ?? []).length
    if (sectionCount < 2) {
      warnings.push(`文章章节数偏少：当前 ${sectionCount} 个，建议至少 3 个章节`)
    }

    // 数据支撑检查
    const dataPoints = this.countDataPoints(out.body)
    if (dataPoints < 3) {
      warnings.push(`文章数据点偏少：当前 ${dataPoints} 处，建议至少 5 处具体数据`)
    }

    // 章节标题质量检查
    const descriptiveTitles = this.findDescriptiveTitles(out.body)
    if (descriptiveTitles.length > 0) {
      warnings.push(`发现描述性章节标题：${descriptiveTitles.join('、')}，建议改为观点句`)
    }

    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      score: out.score,
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

  private countChineseWords(text: string): number {
    const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
    const englishWords = text.match(/[a-zA-Z]+/g)?.length ?? 0
    const digitCount = text.match(/\d/g)?.length ?? 0
    return chineseChars + englishWords + Math.ceil(digitCount * 0.5)
  }

  private extractFirstParagraph(body: string): string {
    const lines = body.split('\n')
    let para = ''
    for (const line of lines) {
      const trimmed = line.trim()
      // 跳过标题、空行、markdown 标记
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('![') || trimmed.startsWith('```')) {
        continue
      }
      para += ' ' + trimmed
      // 收集到第一个空行前为止
      if (trimmed.includes('。') || trimmed.includes('！') || trimmed.includes('？')) {
        break
      }
    }
    return para.trim()
  }

  private extractLastParagraph(body: string): string {
    const lines = body.split('\n').reverse()
    let para = ''
    let collecting = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('![') || trimmed.startsWith('```')) {
        if (collecting) break
        continue
      }
      collecting = true
      para = trimmed + ' ' + para
      if ((trimmed.includes('。') || trimmed.includes('！') || trimmed.includes('？')) && para.length > 50) {
        break
      }
    }
    return para.trim()
  }

  private hasEmptyOpening(paragraph: string): boolean {
    const emptyOpeningPatterns = [
      /^随着/,
      /^近年来/,
      /^在当今/,
      /^在当前/,
      /^在\s*[\u4e00-\u9fff]+时代/,
      /^随着\s*[\u4e00-\u9fff]+的(发展|进步|进步|演进)/,
      /^本文将/,
      /^首先/,
      /^当代/,
    ]
    const lowerPara = paragraph.toLowerCase()
    for (const pattern of emptyOpeningPatterns) {
      if (pattern.test(paragraph) || pattern.test(lowerPara)) {
        return true
      }
    }
    // 额外检查：开头 100 字内无实质内容
    const first100 = paragraph.slice(0, 100)
    const hasData = /\d+([.%\u4e07\u4ebf\u5143\u7f72])?/.test(first100)
    const hasSpecificEntity = /[\u4e00-\u9fff]{2,6}(?:科技|集团|公司|产品|平台)/.test(first100)
    if (!hasData && !hasSpecificEntity && paragraph.length > 50) {
      // 空泛开场但没有数据和实体
      return true
    }
    return false
  }

  private hasRedundantEnding(paragraph: string): boolean {
    const redundantEndingPatterns = [
      /感谢阅读/,
      /希望对你有帮助/,
      /如果你觉得有用/,
      /请转发/,
      /祝好/,
      /以上就是全部内容/,
      /综上所述/,
      /总而言之/,
      /总之/,
      /以上就是/,
    ]
    for (const pattern of redundantEndingPatterns) {
      if (pattern.test(paragraph)) {
        return true
      }
    }
    return false
  }

  private countDataPoints(body: string): number {
    // 统计具体数字 + 单位的组合
    const numberMatches = body.match(/\d+([.%\u4e07\u4ebf\u5143\u7f72\u500d\u4eba])?/g) ?? []
    // 统计带公司的具体数据
    const companyDataMatches = body.match(
      /[\u4e00-\u9fff]{2,6}(?:科技|集团|公司|资本|智能|机器人|半导体)[^\n]{0,30}\d+([.%\u4e07\u4ebf\u5143\u7f72])?/g
    ) ?? []
    // 合并去重估算
    const uniqueDataPoints = new Set([...numberMatches, ...companyDataMatches])
    return uniqueDataPoints.size
  }

  private findDescriptiveTitles(body: string): string[] {
    const descriptivePatterns = [
      /^##\s*[\u4e00-\u9fff]*(?:市场|行业|技术|背景|现状|概述|介绍|总结|前景)[^\u4e00-\u9fff]*/,
      /^##\s*[\u4e00-\u9fff]*(?:第一章|第二节|第[一二三四五六七八九十\d]+章)/,
      /^##\s*[\u4e00-\u9fff]{1,5}(?:分析|研究|探讨|讨论)/,
    ]
    const matches = body.match(/^##\s+.+$/gm) ?? []
    const badTitles: string[] = []
    for (const match of matches) {
      for (const pattern of descriptivePatterns) {
        if (pattern.test(match)) {
          badTitles.push(match.replace(/^##\s+/, ''))
          break
        }
      }
    }
    return badTitles
  }

  private calculateScore(
    input: unknown,
    output: unknown,
    outputValidation: OutputValidation
  ): number {
    let score = 10.0

    const out = output as Partial<WriteExpertOutput>
    const inp = input as Partial<WriteExpertInput>

    // 输入问题扣分
    if (!inp.researchResult) {
      score -= 2
    }

    // 字数扣分
    const wordCount = this.countChineseWords(out.body ?? '')
    if (wordCount < 1800) {
      score -= (1800 - wordCount) * 0.003
    }

    // 空洞开场扣分
    const firstPara = this.extractFirstParagraph(out.body ?? '')
    if (this.hasEmptyOpening(firstPara)) {
      score -= 1.5
    }

    // 废话结尾扣分
    const lastPara = this.extractLastParagraph(out.body ?? '')
    if (this.hasRedundantEnding(lastPara)) {
      score -= 1.5
    }

    // 维度评分扣分
    if (out.dimensionScores) {
      const ds = out.dimensionScores
      const avgDimScore = (ds.perspective + ds.structure + ds.dataSupport + ds.fluency) / 4
      score = avgDimScore
    }

    // 使用外部评分（如果有）
    if (typeof out.score === 'number') {
      score = out.score
    }

    // 警告项扣分
    score -= (outputValidation.warnings?.length ?? 0) * 0.2

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
    const out = output as Partial<WriteExpertOutput>

    // 基于问题生成建议
    if (issues.some((i) => i.includes('空洞开场'))) {
      suggestions.push(
        '建议：使用反常识数据/具体场景/辛辣设问作为开头，参考模式A/B/C之一重写开头200字'
      )
    }

    if (issues.some((i) => i.includes('废话结尾'))) {
      suggestions.push(
        '建议：结尾改为三层次结构（观点总结 + 具体行动建议 + 留白式结尾），禁止"感谢阅读"等废话'
      )
    }

    if (issues.some((i) => i.includes('字数不足'))) {
      suggestions.push('建议：补充内容深度而非填充废话，分析部分至少1000字')
    }

    if (issues.some((i) => i.includes('观点深度评分不足'))) {
      suggestions.push(
        '建议：每个章节必须有明确观点句，避免理中客表述，增加反常识/反直觉的判断'
      )
    }

    if (issues.some((i) => i.includes('文章结构评分不足'))) {
      suggestions.push(
        '建议：确保 Hook 开头 + 章节标题自带观点 + 三层次结尾的结构完整'
      )
    }

    if (issues.some((i) => i.includes('数据支撑评分不足'))) {
      suggestions.push(
        '建议：全文至少 5 处具体数据（公司+产品+数字），每个数字必须有来源标注'
      )
    }

    if (issues.some((i) => i.includes('流畅度评分不足'))) {
      suggestions.push('建议：检查病句、错别字、标点错误，确保语句通顺无语病')
    }

    // 基于警告生成建议
    if (warnings.some((w) => w.includes('章节数偏少'))) {
      suggestions.push('建议：增加章节数量，确保至少有 3 个正文章节，每个章节至少 300 字')
    }

    if (warnings.some((w) => w.includes('数据点偏少'))) {
      suggestions.push('建议：增加具体数字数据点，每个数据需标注来源机构/媒体')
    }

    if (warnings.some((w) => w.includes('描述性章节标题'))) {
      const badTitles = this.findDescriptiveTitles(out.body ?? '')
      if (badTitles.length > 0) {
        suggestions.push(`建议：将描述性标题改为观点句，例如将"市场现状"改为"XX数据背后藏着XX的本质"`)
      }
    }

    if (warnings.some((w) => w.includes('字数偏多'))) {
      suggestions.push('建议：精简内容，将字数控制在 2800 字以内，避免冗余描述')
    }

    // 数据支撑自检
    if (out.body) {
      const dataCount = this.countDataPoints(out.body)
      if (dataCount < 5) {
        suggestions.push(
          `建议：当前仅 ${dataCount} 处数据支撑，建议补充至 5 处以上，包括具体公司名、产品名、具体数字`
        )
      }
    }

    return suggestions
  }
}
