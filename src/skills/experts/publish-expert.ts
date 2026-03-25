import type {
  ExpertResult,
  ExpertSkill,
  InputValidation,
  OutputValidation,
  StepType,
} from '@/skills/types'

type ContentStatus = 'DRAFT' | 'REVIEWING' | 'READY' | 'PUBLISHED' | 'REJECTED'

interface WechatConfig {
  appId?: string
  appSecret?: string
  enabled?: boolean
  [key: string]: unknown
}

interface Account {
  id: string
  wechatConfig?: string | WechatConfig
  [key: string]: unknown
}

interface Content {
  id: string
  title?: string
  body?: string
  status?: ContentStatus
  [key: string]: unknown
}

interface PublishInput {
  content?: Content
  account?: Account
  [key: string]: unknown
}

interface PublishOutput {
  mediaId?: string | number
  publishedAt?: string | number
  convertedHtml?: string
  error?: string
  [key: string]: unknown
}

function parseWechatConfig(config: unknown): WechatConfig {
  if (typeof config === 'string') {
    try {
      return JSON.parse(config) as WechatConfig
    } catch {
      return {}
    }
  }
  if (typeof config === 'object' && config !== null) {
    return config as WechatConfig
  }
  return {}
}

function isValidMediaId(mediaId: string | number | undefined): boolean {
  if (mediaId === undefined || mediaId === null) return false
  const str = String(mediaId)
  // WeChat media_id is typically 32-64 chars, alphanumeric + underscore
  return /^[a-zA-Z0-9_]{10,}$/.test(str)
}

function isValidDate(dateStr: string | number | undefined): boolean {
  if (dateStr === undefined || dateStr === null) return false
  const date = new Date(String(dateStr))
  return !isNaN(date.getTime())
}

export const publishExpert: ExpertSkill = {
  step: 'PUBLISH' as StepType,
  name: 'PublishExpert',
  description: '验证发布环节的输入输出质量',

  validateInput(input: unknown): InputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (typeof input !== 'object' || input === null) {
      return { valid: false, issues: ['输入必须是对象'] }
    }

    const inp = input as PublishInput

    if (!inp.content) {
      issues.push('缺少 content 字段')
      return { valid: false, issues }
    }

    const content = inp.content
    const validStatuses: ContentStatus[] = ['DRAFT', 'REVIEWING', 'READY', 'PUBLISHED', 'REJECTED']

    if (!content.status) {
      issues.push('content 缺少 status 字段')
    } else if (!validStatuses.includes(content.status as ContentStatus)) {
      issues.push(`content.status 值 "${content.status}" 无效，有效值: ${validStatuses.join(', ')}`)
    } else if (content.status !== 'READY') {
      warnings.push(`content.status 为 "${content.status}"，建议在 READY 状态下发布`)
    }

    if (!content.title || typeof content.title !== 'string' || content.title.trim().length === 0) {
      issues.push('content.title 缺失或为空，文章标题不能为空')
    }

    if (!content.body || typeof content.body !== 'string' || content.body.trim().length === 0) {
      issues.push('content.body 缺失或为空，文章正文不能为空')
    }

    if (!inp.account) {
      issues.push('缺少 account 字段')
      return { valid: false, issues }
    }

    const wechatConfig = parseWechatConfig(inp.account.wechatConfig)

    if (!wechatConfig.appId || typeof wechatConfig.appId !== 'string' || wechatConfig.appId.trim() === '') {
      issues.push('account.wechatConfig.appId 缺失或为空')
    }

    if (
      !wechatConfig.appSecret ||
      typeof wechatConfig.appSecret !== 'string' ||
      wechatConfig.appSecret.trim() === ''
    ) {
      issues.push('account.wechatConfig.appSecret 缺失或为空')
    }

    if (wechatConfig.enabled === false) {
      warnings.push('wechatConfig.enabled 为 false，发布功能可能未启用')
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

    const out = output as PublishOutput

    // Check for error field
    if (out.error && typeof out.error === 'string' && out.error.trim().length > 0) {
      issues.push(`发布失败: ${out.error}`)
    }

    // mediaId validation
    if (!isValidMediaId(out.mediaId)) {
      issues.push(
        `mediaId 格式无效: ${JSON.stringify(out.mediaId)}，期望有效的 WeChat media_id 字符串`,
      )
    }

    // publishedAt validation
    if (!isValidDate(out.publishedAt)) {
      issues.push(`publishedAt 格式无效: ${JSON.stringify(out.publishedAt)}，期望 ISO 日期字符串`)
    } else {
      const publishedDate = new Date(String(out.publishedAt))
      const now = new Date()
      if (publishedDate > now) {
        warnings.push('publishedAt 时间在当前时间之后，可能是时区问题')
      }
    }

    // HTML conversion check
    const hasConvertedHtml = out.convertedHtml && typeof out.convertedHtml === 'string'
    const inp = input as PublishInput
    const hasBodyContent =
      inp?.content?.body && typeof inp.content.body === 'string' && inp.content.body.trim().length > 0

    if (!hasConvertedHtml && hasBodyContent) {
      warnings.push('输出缺少 convertedHtml，Markdown 可能未正确转换为 HTML')
    }

    if (hasConvertedHtml) {
      const html = out.convertedHtml as string
      if (!html.includes('<p>') && !html.includes('<h') && !html.includes('<ul>') && !html.includes('<ol>')) {
        warnings.push('convertedHtml 中未发现段落或标题标签，HTML 结构可能异常')
      }
      // Check for unresolved placeholders
      if (html.includes('](cover)')) {
        warnings.push('convertedHtml 中仍存在未替换的图片占位符 [](cover)')
      }
      // Check for base64 images
      const base64Images = (html.match(/data:image\/[^;]+;base64,/g) ?? []).length
      if (base64Images > 0) {
        warnings.push(
          `convertedHtml 中包含 ${base64Images} 个 base64 图片，建议先上传至微信永久素材`,
        )
      }
    }

    return {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
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

    const out = output as PublishOutput

    let status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP' = 'PASS'
    if (allIssues.length > 0) status = 'FAIL'
    else if (allWarnings.length > 0) status = 'WARN'

    const recommendations: string[] = []

    if (allIssues.some((i) => i.includes('mediaId'))) {
      recommendations.push(
        'mediaId 无效，请检查 WeChat access_token 是否过期，或调用 pushToDraft 是否成功',
      )
    }

    if (allWarnings.some((w) => w.includes('base64'))) {
      recommendations.push(
        '检测到 base64 图片，建议在发布前通过 uploadImage 上传至微信永久素材以获得 URL',
      )
    }

    if (allWarnings.some((w) => w.includes('convertedHtml'))) {
      recommendations.push('HTML 转换可能不完整，建议检查 markdownToWechatHtml 函数输出')
    }

    if (allWarnings.some((w) => w.includes('](cover)'))) {
      recommendations.push('存在未生成的图片占位符，建议在图片生成后再发布')
    }

    if (!out.mediaId && !out.error) {
      recommendations.push('发布结果缺少 mediaId 且无错误信息，请检查发布流程日志')
    }

    return {
      verificationReport: {
        status,
        inputValidation: inpValidation,
        outputValidation: outValidation,
        issues: allIssues,
        warnings: allWarnings,
        suggestions: recommendations,
        step: 'PUBLISH' as StepType,
        timestamp: new Date(),
      },
      recommendations,
    }
  },
}
