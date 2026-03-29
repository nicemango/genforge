import type { WritingStyleJSON } from '@/lib/json'
import type { WechatLayoutConfig, WechatThemeId } from '@/lib/wechat-layout'

export type ImageType =
  | 'cover-hero'
  | 'section-illustration'
  | 'data-card'
  | 'quote-card'
  | 'section-card'

export type RenderMode = 'ai' | 'template'
export type CoverMode = 'ai' | 'semi-template' | 'template'
export type QualityStatus = 'passed' | 'retried' | 'downgraded' | 'failed'
export type ArticleVisualCategory = 'platform-event' | 'analysis' | 'abstract-tech'

export interface ImagePlanItem {
  slotId: string
  marker: string
  alt: string
  sectionTitle?: string
  imageType: ImageType
  renderMode: RenderMode
  coverMode?: CoverMode
  aspectRatio: '16:9' | '4:3'
  prompt: string
  caption: string
  priority: number
}

export interface ImagePlan {
  articleTitle: string
  themeId: WechatThemeId
  styleBrief: string
  articleVisualCategory: ArticleVisualCategory
  cover?: ImagePlanItem
  items: ImagePlanItem[]
}

export interface GeneratedImageAsset {
  slotId: string
  marker: string
  alt: string
  caption: string
  imageType: ImageType
  renderMode: RenderMode
  coverMode?: CoverMode
  mimeType: string
  imageBase64?: string
  url?: string
  sourcePrompt?: string
  width?: number
  height?: number
  uploadStatus?: 'uploaded' | 'inline' | 'failed'
  qualityStatus?: QualityStatus
  fallbackReason?: string
}

interface PlannerOptions {
  writingStyle?: WritingStyleJSON
  layoutConfig?: WechatLayoutConfig
}

interface SectionContext {
  title: string
  content: string
}

interface ParagraphContext {
  sectionTitle: string
  text: string
}

const DATA_SIGNALS = ['结论', '数据', '对比', '原因', '趋势', '判断', '建议', '步骤', '结构', '信号', '层', '维度', '路径', '默认', '设置', '权限', '规则', '平台', '协议']

export function planArticleImages(
  articleTitle: string,
  articleBody: string,
  options: PlannerOptions = {},
): ImagePlan {
  const themeId = options.layoutConfig?.themeId ?? 'wechat-pro'
  const styleBrief = buildStyleBrief(articleTitle, options.writingStyle, themeId)
  const slots = extractImageSlots(articleBody)
  const sections = extractSectionContexts(articleBody)
  const paragraphs = extractParagraphContexts(articleBody)
  const coverContext = buildCoverContext(articleTitle, articleBody, sections)
  const articleVisualCategory = inferArticleVisualCategory(articleTitle, articleBody, sections)
  const coverStrategy = inferCoverStrategy(articleTitle, coverContext, articleVisualCategory)

  let cover: ImagePlanItem | undefined
  const items: ImagePlanItem[] = []

  for (const slot of slots) {
    if (slot.slotId === 'cover') {
      cover = {
        slotId: slot.slotId,
        marker: slot.marker,
        alt: slot.alt || `${articleTitle} 头图`,
        sectionTitle: articleTitle,
        imageType: 'cover-hero',
        renderMode: coverStrategy.renderMode,
        coverMode: coverStrategy.coverMode,
        aspectRatio: '16:9',
        prompt:
          coverStrategy.coverMode === 'semi-template' || coverStrategy.coverMode === 'template'
            ? buildTemplateCoverPrompt(articleTitle, coverContext)
            : buildAiPrompt(articleTitle, articleTitle, coverContext, styleBrief, 'cover-hero'),
        caption: `${articleTitle}｜封面图`,
        priority: 100,
      }
      continue
    }

    const sectionIndex = getSectionIndexFromSlot(slot.slotId)
    const context = slot.slotId.startsWith('para-')
      ? resolveParagraphContext(slot.slotId, paragraphs, sections, articleBody)
      : sections[sectionIndex - 1] ?? sections[items.length] ?? {
          title: `章节 ${sectionIndex}`,
          content: articleBody,
        }
    const strategy = inferSectionStrategy(context)

    items.push({
      slotId: slot.slotId,
      marker: slot.marker,
      alt: slot.alt || context.title,
      sectionTitle: context.title,
      imageType: strategy.imageType,
      renderMode: strategy.renderMode,
      aspectRatio: '4:3',
      prompt: buildPromptForStrategy(articleTitle, context, styleBrief, strategy.imageType),
      caption: buildCaptionForStrategy(context.title, strategy.imageType),
      priority: Math.max(10, 90 - sectionIndex * 10),
    })
  }

  return {
    articleTitle,
    themeId,
    styleBrief,
    articleVisualCategory,
    cover,
    items,
  }
}

export function listImagePlanItems(plan: ImagePlan): ImagePlanItem[] {
  return plan.cover ? [plan.cover, ...plan.items] : [...plan.items]
}

export function replaceImageSlots(markdown: string, assets: GeneratedImageAsset[]): string {
  const assetMap = new Map(assets.map((asset) => [asset.slotId, asset]))
  return markdown.replace(
    /!\[([^\]]*)\]\(image:(cover|section-\d+|para-\d+)\)/g,
    (match, alt: string, slotId: string) => {
      const asset = assetMap.get(slotId)
      if (!asset?.url) {
        return match
      }
      return `![${alt || asset.alt}](${asset.url})`
    },
  )
}

function buildStyleBrief(
  articleTitle: string,
  writingStyle: WritingStyleJSON | undefined,
  themeId: WechatThemeId,
): string {
  const tone = writingStyle?.tone?.trim() || '理性、锋利、适合公众号深度阅读'
  const audience = writingStyle?.targetAudience?.trim() || '关注科技、商业和平台趋势的中文读者'
  const style = writingStyle?.style?.join('、') || '信息密度高、结构清晰、中文内容编辑感'
  const themeTone =
    themeId === 'wechat-pro'
      ? '微信内容海报风，浅底、绿色点缀、留白克制'
      : themeId === 'brand-magazine'
        ? '轻杂志排版感，克制配色，弱装饰'
        : '品牌内容风，适合公众号阅读'

  return `${articleTitle}；受众：${audience}；语气：${tone}；文风：${style}；视觉：${themeTone}`
}

function buildPromptForStrategy(
  articleTitle: string,
  context: SectionContext,
  styleBrief: string,
  imageType: ImageType,
): string {
  if (imageType === 'quote-card' || imageType === 'data-card' || imageType === 'section-card') {
    return buildTemplatePrompt(articleTitle, context.title, context.content, imageType)
  }
  return buildAiPrompt(articleTitle, context.title, context.content, styleBrief, imageType)
}

function buildAiPrompt(
  articleTitle: string,
  sectionTitle: string,
  context: string,
  styleBrief: string,
  imageType: ImageType,
): string {
  if (imageType === 'cover-hero') {
    return buildCoverAiPrompt(articleTitle, context, styleBrief)
  }

  const contextSnippet = cleanInlineText(context).slice(0, 180)
  const roleText = imageType === 'cover-hero' ? '封面主视觉' : '章节概念插图'
  return [
    `${roleText}，服务于中文微信公众号长文。`,
    `文章标题：${articleTitle}。`,
    `章节主题：${sectionTitle}。`,
    `内容摘要：${contextSnippet || articleTitle}。`,
    `视觉要求：${styleBrief}。`,
    '构图简洁、信息感强、避免英文大字、避免水印、避免过度抽象和失真的 AI 人脸。',
  ].join('')
}

function buildCoverAiPrompt(articleTitle: string, context: string, styleBrief: string): string {
  const coverSignals = parseCoverSignals(context)
  const entityAnchor = inferCoverEntityAnchor(`${articleTitle} ${context}`)
  const sceneDirective = coverSignals.scene
    ? `画面主体：${coverSignals.scene}。`
    : '画面主体：科技系统、控制结构与风险蔓延之间的紧张关系。'
  const metaphorDirective = coverSignals.metaphor
    ? `视觉隐喻：${coverSignals.metaphor}。`
    : '视觉隐喻：表面稳定的系统内部出现裂纹、反噬或失控迹象。'
  const entityDirective = entityAnchor.subject ? `主体锚点：${entityAnchor.subject}。` : ''
  const actionDirective = entityAnchor.action ? `场景元素：${entityAnchor.action}。` : ''
  const negativeDirective = entityAnchor.negative
    ? `严格避免：${entityAnchor.negative}。`
    : '严格避免：风景照、建筑景观、游乐园设施、摩天轮、旅游海报、无关交通工具、纯装饰性抽象图。'

  return [
    '封面主视觉，服务于中文微信公众号长文。',
    `文章标题：${articleTitle}。`,
    `核心命题：${coverSignals.core || articleTitle}。`,
    `冲突焦点：${coverSignals.conflict || '安全机制、训练目标与真实能力之间发生反向作用'}。`,
    `风险后果：${coverSignals.risk || '系统表面合规，但内部已经出现脆弱性累积和失控前兆'}。`,
    entityDirective,
    actionDirective,
    sceneDirective,
    metaphorDirective,
    `视觉要求：${styleBrief}。`,
    '整体偏写实科技 editorial illustration / concept key visual，戏剧张力明确，主体单一，中心叙事清晰，留白克制。',
    '如果文章涉及具体平台、产品或公司，画面必须出现与该主体强相关的界面、代码、权限、仓库、模型或协议语义，不能退化成泛化风景图。',
    '避免人物大头照，避免卡通，避免信息图表，避免英文大字，避免水印，避免杂乱 UI，避免低质赛博朋克堆砌。',
    negativeDirective,
  ]
    .filter(Boolean)
    .join('')
}

function buildTemplatePrompt(
  articleTitle: string,
  sectionTitle: string,
  context: string,
  imageType: ImageType,
): string {
  if (imageType === 'data-card') {
    const points = extractDataCardPoints(context, sectionTitle)
    return `${articleTitle}｜${sectionTitle}｜${imageType}｜${points.join(' || ')}`
  }
  const summary = cleanInlineText(context).slice(0, 120)
  return `${articleTitle}｜${sectionTitle}｜${imageType}｜${summary}`
}

function buildTemplateCoverPrompt(articleTitle: string, context: string): string {
  const coverSignals = parseCoverSignals(context)
  const entityAnchor = inferCoverEntityAnchor(`${articleTitle} ${context}`)
  return [
    articleTitle,
    'platform-cover',
    entityAnchor.subject || '平台规则与权限结构',
    entityAnchor.action || '默认开关、授权面板、代码仓库与产品权限关系',
    coverSignals.risk || inferRiskFromTitle(articleTitle),
  ].join('｜')
}

function buildCaptionForStrategy(sectionTitle: string, imageType: ImageType): string {
  if (imageType === 'quote-card') return `${sectionTitle}｜观点摘录`
  if (imageType === 'data-card') return `${sectionTitle}｜关键结构`
  if (imageType === 'section-card') return `${sectionTitle}｜章节过渡`
  return `${sectionTitle}｜配图`
}

function inferSectionStrategy(context: SectionContext): { imageType: ImageType; renderMode: RenderMode } {
  const text = context.content
  const blockquoteCount = (text.match(/(^|\n)>\s+/g) ?? []).length
  const listCount = (text.match(/(^|\n)(?:- |\* |\d+\. )/g) ?? []).length
  const signalCount = DATA_SIGNALS.filter((signal) => text.includes(signal) || context.title.includes(signal)).length

  if (blockquoteCount > 0) {
    return { imageType: 'quote-card', renderMode: 'template' }
  }
  if (signalCount > 0 || listCount >= 3) {
    return { imageType: 'data-card', renderMode: 'template' }
  }
  if (cleanInlineText(text).length < 60) {
    return { imageType: 'section-card', renderMode: 'template' }
  }
  return { imageType: 'section-illustration', renderMode: 'ai' }
}

function extractImageSlots(articleBody: string): Array<{ slotId: string; marker: string; alt: string }> {
  const matches = [...articleBody.matchAll(/!\[([^\]]*)\]\(image:(cover|section-\d+|para-\d+)\)/g)]
  return matches.map((match) => ({
    slotId: match[2],
    marker: match[0],
    alt: match[1].trim(),
  }))
}

function extractSectionContexts(articleBody: string): SectionContext[] {
  const sections = articleBody.split(/\n(?=##\s+)/g)
  const results: SectionContext[] = []

  for (const section of sections) {
    const headingMatch = section.match(/^##\s+(.+)$/m)
    if (!headingMatch) continue
    results.push({
      title: headingMatch[1].trim(),
      content: section,
    })
  }

  return results
}

function extractParagraphContexts(articleBody: string): ParagraphContext[] {
  const sections = articleBody.split(/\n(?=##\s+)/g)
  const paragraphs: ParagraphContext[] = []

  for (const section of sections) {
    const headingMatch = section.match(/^##\s+(.+)$/m)
    if (!headingMatch) continue
    const sectionTitle = headingMatch[1].trim()
    const blocks = section
      .split('\n\n')
      .map((block) => block.trim())
      .filter(Boolean)
      .filter((block) => !/^##\s+/.test(block))
      .filter((block) => !/^!\[[^\]]*\]\(image:/.test(block))

    const ranked = blocks
      .map((block) => ({
        text: cleanInlineText(block),
        score: scoreParagraphContext(block),
      }))
      .filter((item) => item.text.length >= 24)
      .sort((a, b) => b.score - a.score)

    if (ranked[0]) {
      paragraphs.push({
        sectionTitle,
        text: ranked[0].text,
      })
    }
  }

  return paragraphs
}

function getSectionIndexFromSlot(slotId: string): number {
  if (slotId === 'cover') return 0
  const match = slotId.match(/^section-(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : 1
}

function getParagraphIndexFromSlot(slotId: string): number {
  const match = slotId.match(/^para-(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : 1
}

function resolveParagraphContext(
  slotId: string,
  paragraphs: ParagraphContext[],
  sections: SectionContext[],
  articleBody: string,
): SectionContext {
  const index = getParagraphIndexFromSlot(slotId)
  const paragraph = paragraphs[index - 1]
  if (paragraph) {
    return {
      title: paragraph.sectionTitle,
      content: paragraph.text,
    }
  }

  return sections[index - 1] ?? sections[0] ?? { title: `段落 ${index}`, content: articleBody }
}

function cleanInlineText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferArticleVisualCategory(
  articleTitle: string,
  articleBody: string,
  sections: SectionContext[],
): ArticleVisualCategory {
  const normalized = `${articleTitle} ${articleBody}`.toLowerCase()
  if (inferCoverEntityAnchor(normalized).subject) {
    return 'platform-event'
  }

  const sectionSignalCount = sections.filter((section) => DATA_SIGNALS.some((signal) => section.title.includes(signal))).length
  const listCount = (articleBody.match(/(^|\n)(?:- |\* |\d+\. )/g) ?? []).length
  if (sectionSignalCount > 0 || listCount >= 5) {
    return 'analysis'
  }

  return 'abstract-tech'
}

function scoreParagraphContext(text: string): number {
  return (
    (/(对比|步骤|结论|原因|结构|默认|设置|权限|规则|平台|信号|层|行业)/.test(text) ? 4 : 0) +
    (/(GitHub|Copilot|OpenAI|Meta|模型|平台|训练|开发者|代码|仓库)/i.test(text) ? 3 : 0) +
    (/(?:\d+[%亿元万千]|\d+\.\d+)/.test(text) ? 2 : 0) +
    Math.min(3, Math.floor(cleanInlineText(text).length / 80))
  )
}

function extractDataCardPoints(content: string, sectionTitle: string): string[] {
  const listLines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]\s+|\d+\.\s+)/.test(line))
    .map((line) => line.replace(/^(?:[-*]\s+|\d+\.\s+)/, '').trim())
    .map((line) => cleanPointText(line))
    .filter(Boolean)

  if (listLines.length >= 2) {
    return listLines.slice(0, 3)
  }

  const sentences = cleanInlineText(content)
    .split(/[。；!?！？]/)
    .map((part) => cleanPointText(part))
    .filter(Boolean)
    .filter((part) => part !== sectionTitle)

  const uniquePoints: string[] = []
  for (const point of [...listLines, ...sentences]) {
    if (!point) continue
    if (uniquePoints.some((existing) => existing === point || existing.includes(point) || point.includes(existing))) {
      continue
    }
    uniquePoints.push(point)
    if (uniquePoints.length === 3) break
  }

  if (uniquePoints.length > 0) {
    return uniquePoints
  }

  return [cleanPointText(sectionTitle) || '关键信息']
}

function cleanPointText(value: string): string {
  return value
    .replace(/^[:：,，.。;；、]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28)
    .trim()
}

function buildCoverContext(articleTitle: string, articleBody: string, sections: SectionContext[]): string {
  const intro = cleanInlineText(articleBody)
    .replace(articleTitle, '')
    .slice(0, 240)
  const sectionTitles = sections
    .map((section) => cleanInlineText(section.title))
    .filter(Boolean)
    .slice(0, 4)
    .join('｜')
  const focusLines = extractCoverFocusLines(articleBody).join('｜')

  return [articleTitle, intro, sectionTitles, focusLines].filter(Boolean).join('｜')
}

function parseCoverSignals(context: string): {
  core: string
  conflict: string
  risk: string
  scene: string
  metaphor: string
} {
  const segments = context
    .split('｜')
    .map((part) => cleanInlineText(part))
    .filter(Boolean)

  const core = segments[0] || ''
  const candidates = segments.slice(1)
  const conflict =
    summarizeCoverLine(
      candidates.find((part) => /(不是|却|但|反而|正在|暴露|失效|自毁|欺骗|缺陷|悖论|风险)/.test(part)) ||
        candidates[0] ||
        '',
    )
  const riskCandidate =
    candidates.find(
      (part) =>
        part !== conflict && /(失效|失败|缺陷|代价|后果|风险|脆弱|爆炸|负债|失控|病灶|致命|崩塌)/.test(part),
    ) ||
    candidates.find((part) => part !== conflict) ||
    ''
  const riskSummary = summarizeCoverLine(riskCandidate || inferRiskFromTitle(core))
  const risk = riskSummary && riskSummary !== conflict ? riskSummary : inferRiskFromTitle(core)
  const scene = inferCoverScene(`${core} ${conflict} ${risk}`)
  const metaphor = inferCoverMetaphor(`${core} ${conflict} ${risk}`)

  return { core, conflict, risk, scene, metaphor }
}

function extractCoverFocusLines(articleBody: string): string[] {
  const lines = articleBody
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^!\[/.test(line) && !/^#/.test(line))
    .map((line) => summarizeCoverLine(line.replace(/^(?:[-*]\s+|\d+\.\s+|>\s?)/, '').trim()))

  const scored = lines
    .map((line) => ({
      line,
      score:
        (/(不是|反而|却|正在|暴露|失效|失败|病灶|欺骗|缺陷|悖论|风险|代价|锁|炸弹|负债)/.test(line) ? 4 : 0) +
        (/(AI|模型|训练|安全|系统|平台|对齐|风控|能力|RLHF|GPT)/i.test(line) ? 3 : 0) +
        Math.min(3, Math.floor(line.length / 24)),
    }))
    .filter((item) => item.line.length >= 12)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, 3).map((item) => item.line)
}

function summarizeCoverLine(value: string): string {
  const normalized = cleanInlineText(value)
  const firstSentence = normalized.split(/[。！？!?；;]/)[0]?.trim() || normalized
  return clampCoverText(firstSentence, 52)
}

function clampCoverText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function inferCoverScene(value: string): string {
  const normalized = value.toLowerCase()
  if (/(锁|风控|防线|权限|门|闸)/.test(value)) {
    return '一套高科技锁定系统或权限闸门正在松动、裂开，背后露出失控的能量结构'
  }
  if (/(训练|对齐|rlhf|自身免疫|病灶)/.test(normalized)) {
    return '实验室级 AI 训练装置或神经网络核心在校准过程中出现反噬，稳定外壳内有异常蔓延'
  }
  if (/(欺骗|伪造|假装|失效|失败)/.test(value)) {
    return '一块本应显示安全通过的智能控制面板出现大面积错误、裂纹或红色预警扩散'
  }
  return '一个象征 AI 控制系统的核心装置表面稳定、内部却正在出现裂解和反向失控'
}

function inferCoverMetaphor(value: string): string {
  const normalized = value.toLowerCase()
  if (/(炸弹|自毁|爆炸)/.test(value)) {
    return '包装精密的安全装置内部其实是一枚定时炸弹'
  }
  if (/(锁|风控|权限|防线)/.test(value)) {
    return '看似严密的锁具其实已经从内部被悄悄打开'
  }
  if (/(自身免疫|病灶|训练|对齐|rlhf)/.test(normalized)) {
    return '原本用于修复系统的免疫机制，反而开始攻击系统自身'
  }
  if (/(欺骗|伪造|假装)/.test(value)) {
    return '表面服从的面具之下，真实意图正在渗出'
  }
  return '安全外壳与内部失控之间的反差'
}

function inferCoverStrategy(
  articleTitle: string,
  context: string,
  articleVisualCategory: ArticleVisualCategory,
): { renderMode: RenderMode; coverMode: CoverMode } {
  if (articleVisualCategory === 'platform-event') {
    return { renderMode: 'template', coverMode: 'semi-template' }
  }

  const normalized = `${articleTitle} ${context}`.toLowerCase()
  if (/(协议|默认同意|权限|开关|平台|规则|仓库|开发者|copilot|github|openai|meta)/.test(normalized)) {
    return { renderMode: 'template', coverMode: 'semi-template' }
  }

  return { renderMode: 'ai', coverMode: 'ai' }
}

function inferRiskFromTitle(value: string): string {
  if (/(炸弹|爆炸|自毁)/.test(value)) return '高风险能力被包装成安全系统，随时可能在关键场景中反噬'
  if (/(失效|失败|崩塌)/.test(value)) return '安全机制在最关键的真实任务里大面积失效'
  if (/(缺陷|漏洞|风险)/.test(value)) return '表面合规的系统内部存在会持续扩大的结构性风险'
  return '系统在高压真实场景里出现不可忽视的安全脆弱性'
}

function inferCoverEntityAnchor(value: string): { subject: string; action: string; negative: string } {
  const normalized = value.toLowerCase()

  if (normalized.includes('github') || normalized.includes('copilot')) {
    return {
      subject: 'GitHub 平台、代码仓库、Copilot 编程助手、开发者权限设置',
      action: '代码仓库页面、默认勾选的权限开关、Copilot 或训练授权提示、开发者协议或设置面板',
      negative: '风景、游乐园、摩天轮、城市地标、自然景观、与软件平台无关的物体',
    }
  }

  if (normalized.includes('openai') || normalized.includes('gpt')) {
    return {
      subject: 'OpenAI 产品界面、模型控制面板、对话系统或推理流程',
      action: '模型设置、调用日志、权限边界、推理输出与安全控制之间的冲突',
      negative: '风景、游乐园、日常静物、无关机械装置',
    }
  }

  if (normalized.includes('meta') || normalized.includes('facebook') || normalized.includes('instagram')) {
    return {
      subject: 'Meta 平台生态、推荐系统、广告系统或社交产品界面',
      action: '平台控制面板、推荐流、权限设置、用户数据与平台收益之间的张力',
      negative: '风景、游乐园、无关建筑、纯抽象装饰图',
    }
  }

  if (normalized.includes('小米') || normalized.includes('su7') || normalized.includes('特斯拉') || normalized.includes('tesla')) {
    return {
      subject: '汽车产品、品牌界面、订单或销售相关场景',
      action: '车辆本体、订单数据、试驾或涨价交付场景，避免无关风景化处理',
      negative: '游乐园、自然风景、无关建筑、旅游海报感画面',
    }
  }

  return {
    subject: '',
    action: '',
    negative: '',
  }
}
