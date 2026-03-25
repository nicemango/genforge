import type {
  ExpertResult,
  ExpertSkill,
  InputValidation,
  OutputValidation,
  StepType,
} from '@/skills/types'

interface TrendInput {
  items?: TrendItemRaw[]
  [key: string]: unknown
}

interface TrendItemRaw {
  title?: string
  link?: string
  pubDate?: string
  snippet?: string
  source?: string
  [key: string]: unknown
}

interface TrendOutput {
  items?: TrendItemRaw[]
  fetchedAt?: string
  stats?: {
    total?: number
    success?: number
    failed?: number
    timedOut?: number
  }
  [key: string]: unknown
}

const AD_PATTERNS = ['广告', '推广', '[广告]', '[推广]', 'sponsored', 'sponsor']

function isUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value)
}

function isWithinDays(pubDate: string, days: number): boolean {
  const pubTime = new Date(pubDate).getTime()
  if (isNaN(pubTime)) return false
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000
  return pubTime >= threshold
}

export const trendExpert: ExpertSkill = {
  step: 'TREND_CRAWL' as StepType,
  name: 'TrendExpert',
  description: '验证热点抓取环节的输入输出质量',

  validateInput(input: unknown): InputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (input === null || input === undefined) {
      warnings.push('TREND_CRAWL 输入为空，环节将在无预设输入的情况下执行（从配置文件读取 RSS 源）')
      return { valid: true, warnings }
    }

    if (typeof input !== 'object') {
      return { valid: false, issues: ['输入必须是对象'] }
    }

    const inp = input as Partial<TrendInput>

    if (!inp.items || !Array.isArray(inp.items)) {
      warnings.push('未提供 items 数组，将从配置文件读取 RSS 源')
      return { valid: true, warnings }
    }

    const items = inp.items

    if (items.length === 0) {
      issues.push('items 数组为空')
      return { valid: false, issues }
    }

    // Source diversity check
    const sources = new Set(items.map((item) => item.source).filter(Boolean))
    if (sources.size < 5) {
      issues.push(`RSS 源种类不足：当前仅 ${sources.size} 个来源，要求至少 5 个`)
    }

    // Content volume check
    if (items.length < 10) {
      issues.push(`抓取内容条数不足：当前 ${items.length} 条，要求至少 10 条`)
    }

    // Freshness check: 80% within 7 days
    const freshCount = items.filter((item) => item.pubDate && isWithinDays(item.pubDate, 7)).length
    const freshRatio = items.length > 0 ? freshCount / items.length : 0
    if (freshRatio < 0.8) {
      issues.push(
        `内容新鲜度不足：仅 ${(freshRatio * 100).toFixed(0)}% 的内容在 7 天内，要求至少 80%`,
      )
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

    const out = output as Partial<TrendOutput>

    if (!out.items || !Array.isArray(out.items)) {
      return { valid: false, issues: ['输出缺少 items 字段或类型错误'] }
    }

    if (out.items.length === 0) {
      issues.push('items 数组为空，未抓取到任何内容')
    }

    // Field completeness check per item
    const requiredFields: (keyof TrendItemRaw)[] = ['title', 'link', 'pubDate', 'snippet', 'source']
    for (let i = 0; i < out.items.length; i++) {
      const item = out.items[i]
      for (const field of requiredFields) {
        if (!item[field] || typeof item[field] !== 'string' || (item[field] as string).trim() === '') {
          issues.push(`items[${i}] 缺少字段 "${field}" 或值为空`)
        }
      }

      // URL format check
      if (item.link && !isUrl(item.link)) {
        issues.push(`items[${i}].link 格式错误：${item.link}（必须以 http:// 或 https:// 开头）`)
      }

      // Ad detection in snippet
      if (item.snippet) {
        for (const pattern of AD_PATTERNS) {
          if (item.snippet.includes(pattern)) {
            warnings.push(`items[${i}].snippet 可能包含广告内容：${item.snippet.slice(0, 50)}...`)
            break
          }
        }
      }
    }

    // Freshness summary
    const freshCount = out.items.filter((item) => item.pubDate && isWithinDays(item.pubDate, 7)).length
    const freshRatio = out.items.length > 0 ? freshCount / out.items.length : 0
    if (freshRatio < 0.5) {
      warnings.push(`输出内容新鲜度偏低：${(freshRatio * 100).toFixed(0)}% 在 7 天内`)
    }

    // Compute a rough score based on quality indicators
    let score: number | undefined
    if (issues.length === 0) {
      const baseScore = 7
      const volumeBonus = Math.min(out.items.length / 50, 1) * 2 // up to +2 for volume
      const freshnessBonus = freshRatio * 1 // up to +1 for freshness
      score = Math.min(10, baseScore + volumeBonus + freshnessBonus)
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

    const out = output as Partial<TrendOutput>

    let status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP' = 'PASS'
    if (allIssues.length > 0) status = 'FAIL'
    else if (allWarnings.length > 0) status = 'WARN'

    const recommendations: string[] = []

    if (out.items) {
      if (out.items.length < 10) {
        recommendations.push('抓取内容偏少，建议增加 RSS 源数量或提高单源抓取上限')
      }

      // Check source diversity
      const sources = new Set(out.items.map((item) => item.source).filter(Boolean))
      if (sources.size < 5) {
        recommendations.push(`来源多样性不足（仅 ${sources.size} 个），建议覆盖更多垂直领域的 RSS 源`)
      }

      // Freshness issue
      const freshCount = out.items.filter((item) => item.pubDate && isWithinDays(item.pubDate, 7)).length
      const freshRatio = out.items.length > 0 ? freshCount / out.items.length : 0
      if (freshRatio < 0.8) {
        recommendations.push('部分 RSS 源内容过期，建议更新或替换长期无更新的源')
      }

      // Check for duplicate titles
      const titles = out.items.map((item) => item.title?.trim().toLowerCase()).filter(Boolean)
      const titleSet = new Set(titles)
      if (titleSet.size < titles.length * 0.7) {
        recommendations.push('存在较多重复标题，建议检查去重逻辑是否生效')
      }
    }

    if (out.stats && typeof out.stats === 'object') {
      const stats = out.stats
      if ((stats.failed ?? 0) > (stats.success ?? 0)) {
        recommendations.push(
          `抓取失败率偏高（成功 ${stats.success} / 失败 ${stats.failed}），请检查 RSS 源可用性和网络状态`,
        )
      }
      if ((stats.timedOut ?? 0) > 2) {
        recommendations.push(`${stats.timedOut} 个 RSS 源超时，建议调高超时阈值或排除慢速源`)
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
        step: 'TREND_CRAWL' as StepType,
        timestamp: new Date(),
      },
      recommendations,
    }
  },
}
