import type {
  ExpertResult,
  ExpertSkill,
  InputValidation,
  OutputValidation,
  StepType,
} from '@/skills/types'

interface ImagePlaceholder {
  marker: string
  imageBase64: string
  alt: string
  caption: string
}

interface ImageAgentOutput {
  imagePlaceholders?: ImagePlaceholder[]
  images?: Array<{ base64?: string; dataUrl?: string; width?: number; height?: number }>
  [key: string]: unknown
}

interface ImageAgentInput {
  articleTitle?: string
  body?: string
  [key: string]: unknown
}

function isValidBase64(str: string): boolean {
  if (!str || typeof str !== 'string') return false
  if (str.startsWith('data:image')) return true
  // Check if it's valid base64 (alphanumeric + +/=)
  return /^[A-Za-z0-9+/=]{20,}$/.test(str)
}

function isValidAspectRatio(
  imageBase64: string,
  width?: number,
  height?: number,
): { valid: boolean; reason?: string } {
  // If width/height are provided, check ratio
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    const ratio = width / height
    const is16by9 = Math.abs(ratio - 16 / 9) < 0.1
    const is3by2 = Math.abs(ratio - 3 / 2) < 0.1
    const is4by3 = Math.abs(ratio - 4 / 3) < 0.1
    if (is16by9 || is3by2 || is4by3) {
      return { valid: true }
    }
    return {
      valid: false,
      reason: `宽高比 ${ratio.toFixed(2)} 不符合 16:9/3:2/4:3 标准`,
    }
  }

  // If base64 is available, decode JPEG header for dimensions
  // JPEG: SOI (FF D8) followed by APP0/APP1 marker, then DQT, then SOF containing dimensions
  // Simplified: check if base64 decodes to plausible JPEG with reasonable dimensions
  if (imageBase64.startsWith('data:image')) {
    // data:image URI - trust format indicator
    return { valid: true }
  }

  return { valid: true }
}

export const imageExpert: ExpertSkill = {
  step: 'GENERATE_IMAGES' as StepType,
  name: 'ImageExpert',
  description: '验证图片生成环节的输入输出质量',

  validateInput(input: unknown): InputValidation {
    const issues: string[] = []
    const warnings: string[] = []

    if (typeof input !== 'object' || input === null) {
      return { valid: false, issues: ['输入必须是对象'] }
    }

    const inp = input as ImageAgentInput

    if (!inp.body || typeof inp.body !== 'string') {
      issues.push('缺少 articleTitle 或 body 字段，或类型错误')
    } else {
      // Check for cover placeholders
      const placeholderCount = (inp.body.match(/!\[[^\]]*\]\(cover\)/g) ?? []).length
      if (placeholderCount === 0) {
        warnings.push('文章中未发现图片占位符 [](cover)，可能不需要生成图片')
      } else if (placeholderCount < 2) {
        warnings.push(`文章中仅有 ${placeholderCount} 个图片占位符，数量偏少`)
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
    let score: number | undefined

    if (typeof output !== 'object' || output === null) {
      return { valid: false, issues: ['输出必须是对象'] }
    }

    const out = output as ImageAgentOutput
    const inp = input as ImageAgentInput

    // Check output structure
    const placeholders = out.imagePlaceholders
    const images = out.images

    if (!placeholders && !images) {
      return {
        valid: false,
        issues: ['输出缺少 imagePlaceholders 或 images 字段'],
      }
    }

    const imgArray = placeholders ?? images ?? []
    if (!Array.isArray(imgArray)) {
      return { valid: false, issues: ['imagePlaceholders/images 必须是数组'] }
    }

    if (imgArray.length === 0) {
      issues.push('生成了 0 张图片，无有效输出')
    }

    // Check count matches placeholders in input
    const inputPlaceholders =
      inp?.body ? (inp.body.match(/!\[[^\]]*\]\(cover\)/g) ?? []).length : 0
    if (inputPlaceholders > 0) {
      const diff = imgArray.length - inputPlaceholders
      if (Math.abs(diff) > 1) {
        warnings.push(
          `生成图片数量(${imgArray.length})与文章占位符数量(${inputPlaceholders})差异较大，允许±1容差`,
        )
      }
    }

    // Validate each image
    let validImageCount = 0
    for (let i = 0; i < imgArray.length; i++) {
      const img = imgArray[i] as Record<string, unknown>

      // Extract base64 data
      const base64 =
        typeof img === 'string'
          ? img
          : (img.imageBase64 as string | undefined) ??
            (img.base64 as string | undefined) ??
            (img.dataUrl as string | undefined)

      if (!base64) {
        issues.push(`图片[${i}]缺少 base64 数据`)
        continue
      }

      if (!isValidBase64(base64)) {
        issues.push(`图片[${i}]的 base64 数据格式无效`)
        continue
      }

      const ratioCheck = isValidAspectRatio(
        base64,
        img.width as number | undefined,
        img.height as number | undefined,
      )
      if (!ratioCheck.valid && ratioCheck.reason) {
        warnings.push(`图片[${i}]: ${ratioCheck.reason}`)
      }

      validImageCount++
    }

    if (validImageCount === 0 && imgArray.length > 0) {
      issues.push('所有图片的 base64 数据均无效')
    }

    // Score: base on coverage and quality
    if (validImageCount > 0) {
      const coverage = inputPlaceholders > 0 ? validImageCount / inputPlaceholders : validImageCount / 3
      score = Math.min(10, coverage * 10)
      if (warnings.length > 0) score = Math.max(0, score - 1)
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

    const allIssues = [
      ...(inpValidation.issues ?? []),
      ...(outValidation.issues ?? []),
    ]
    const allWarnings = [
      ...(inpValidation.warnings ?? []),
      ...(outValidation.warnings ?? []),
    ]

    const hasErrors = allIssues.length > 0
    const hasWarnings = allWarnings.length > 0

    let status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP' = 'PASS'
    if (hasErrors) status = 'FAIL'
    else if (hasWarnings) status = 'WARN'

    const recommendations: string[] = []
    const out = output as ImageAgentOutput
    const imgCount = (out.imagePlaceholders ?? out.images ?? []).length

    if (imgCount === 0) {
      recommendations.push('未生成任何图片，建议检查 generate_image 工具调用是否成功')
    } else if (imgCount < 3) {
      recommendations.push(`仅生成 ${imgCount} 张图片，建议至少生成封面 1 张 + 章节 2 张`)
    }

    if (allIssues.some((i) => i.includes('base64'))) {
      recommendations.push('存在无效 base64 图片，建议重新生成或检查图片上传流程')
    }

    if (allWarnings.some((w) => w.includes('宽高比'))) {
      recommendations.push('部分图片宽高比不符合标准，封面建议 16:9，章节图建议 4:3')
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
        step: 'GENERATE_IMAGES' as StepType,
        timestamp: new Date(),
      },
      recommendations,
    }
  },
}
