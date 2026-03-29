export type WechatThemeId = 'brand-clean' | 'brand-magazine' | 'brand-warm' | 'wechat-pro'

export interface WechatLayoutConfig {
  themeId?: WechatThemeId
  brandName?: string
  primaryColor?: string
  accentColor?: string
  titleAlign?: 'left' | 'center'
  showEndingCard?: boolean
  endingCardText?: string
  imageStyle?: 'rounded' | 'soft-shadow' | 'square'
}

export interface WechatRenderOptions {
  title: string
  summary?: string
  layoutConfig?: WechatLayoutConfig
}

type WechatContentBlock =
  | { type: 'heading1'; text: string }
  | { type: 'heading2'; text: string }
  | { type: 'heading3'; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'divider' }

interface ResolvedLayoutConfig {
  themeId: WechatThemeId
  brandName: string
  primaryColor: string
  accentColor: string
  titleAlign: 'left' | 'center'
  showEndingCard: boolean
  endingCardText: string
  imageStyle: 'rounded' | 'soft-shadow' | 'square'
}

interface ThemePalette {
  primary: string
  primaryForeground: string
  body: string
  heading: string
  muted: string
  divider: string
  quoteBackground: string
  quoteBorder: string
  highlight: string
  pageBackground: string
  secondary: string
  footerBackground: string
}

interface ArticleContext {
  coverImage?: { src: string; alt: string }
  relatedTitles: string[]
  readTime: string
}

const DEFAULTS: ResolvedLayoutConfig = {
  themeId: 'wechat-pro',
  brandName: '',
  primaryColor: '#2f7a4e',
  accentColor: '#e8f2eb',
  titleAlign: 'left',
  showEndingCard: true,
  endingCardText: '',
  imageStyle: 'rounded',
}

export function compileWechatArticle(markdown: string, options: WechatRenderOptions): string {
  const config = resolveLayoutConfig(options.layoutConfig)
  const articleContext = buildArticleContext(markdown)
  const blocks = parseMarkdownToBlocks(markdown, articleContext).filter((block) => block.type !== 'heading1')
  const palette = buildPalette(config)
  const summary = cleanSummary(options.summary)
  const leadParagraph = extractLeadParagraph(blocks)

  const parts = [
    '<article style="max-width:720px;margin:0 auto;padding:0 0 24px;background:#ffffff;">',
    renderTemplateHeader(summary, palette, articleContext, leadParagraph),
    ...blocks.map((block) => renderBlock(block, config, palette)),
  ]

  if (config.showEndingCard) {
    const footer = renderTemplateFooter(summary, config, palette, articleContext)
    if (footer) parts.push(footer)
  }

  parts.push('</article>')
  return parts.join('\n')
}

function resolveLayoutConfig(config?: WechatLayoutConfig): ResolvedLayoutConfig {
  return {
    themeId: config?.themeId ?? DEFAULTS.themeId,
    brandName: config?.brandName?.trim() || '',
    primaryColor: config?.primaryColor?.trim() || DEFAULTS.primaryColor,
    accentColor: config?.accentColor?.trim() || DEFAULTS.accentColor,
    titleAlign: config?.titleAlign ?? DEFAULTS.titleAlign,
    showEndingCard: config?.showEndingCard ?? true,
    endingCardText: config?.endingCardText?.trim() || '',
    imageStyle: config?.imageStyle ?? DEFAULTS.imageStyle,
  }
}

function buildPalette(config: ResolvedLayoutConfig): ThemePalette {
  return {
    primary: config.primaryColor,
    primaryForeground: '#ffffff',
    body: '#3f4a45',
    heading: '#1e2a23',
    muted: '#7d8b84',
    divider: '#dde6df',
    quoteBackground: '#f3f7f4',
    quoteBorder: config.primaryColor,
    highlight: config.accentColor,
    pageBackground: '#ffffff',
    secondary: '#f5f7f6',
    footerBackground: '#f5f8f6',
  }
}

function buildArticleContext(markdown: string): ArticleContext {
  const lines = markdown.replace(/\r\n/g, '\n').trim().split('\n')
  const imageMatches = [...markdown.matchAll(/^!\[([^\]]*)\]\(([^)]+)\)$/gm)]
  const coverCandidate = imageMatches.find((match) => !/^image:(?:cover|section-\d+|para-\d+)$/.test(match[2].trim()))
  const relatedTitles = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 3)
  const narrativeWordCount = lines
    .filter((line) => line.trim() && !line.trim().startsWith('#') && !/^!\[/.test(line.trim()))
    .join('')
    .length

  return {
    coverImage: coverCandidate ? { alt: coverCandidate[1].trim(), src: coverCandidate[2].trim() } : undefined,
    relatedTitles,
    readTime: estimateReadTime(narrativeWordCount),
  }
}

function parseMarkdownToBlocks(markdown: string, context: ArticleContext): WechatContentBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').trim().split('\n')
  const blocks: WechatContentBlock[] = []
  let index = 0
  let coverConsumed = false

  while (index < lines.length) {
    const line = lines[index].trim()

    if (!line) {
      index += 1
      continue
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (imageMatch) {
      if (!coverConsumed && context.coverImage && imageMatch[2].trim() === context.coverImage.src) {
        coverConsumed = true
        index += 1
        continue
      }
      blocks.push({ type: 'image', alt: imageMatch[1].trim(), src: imageMatch[2].trim() })
      index += 1
      continue
    }

    if (line.startsWith('# ')) {
      blocks.push({ type: 'heading1', text: line.slice(2).trim() })
      index += 1
      continue
    }

    if (line.startsWith('## ')) {
      blocks.push({ type: 'heading2', text: line.slice(3).trim() })
      index += 1
      continue
    }

    if (line.startsWith('### ')) {
      blocks.push({ type: 'heading3', text: line.slice(4).trim() })
      index += 1
      continue
    }

    if (line === '---' || line === '***' || line === '___') {
      blocks.push({ type: 'divider' })
      index += 1
      continue
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('> ')) {
        quoteLines.push(lines[index].trim().slice(2))
        index += 1
      }
      blocks.push({ type: 'blockquote', lines: quoteLines })
      continue
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line)
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index].trim()
        if (!current) break
        if (ordered && /^\d+\.\s+/.test(current)) {
          items.push(current.replace(/^\d+\.\s+/, '').trim())
          index += 1
          continue
        }
        if (!ordered && /^[-*]\s+/.test(current)) {
          items.push(current.replace(/^[-*]\s+/, '').trim())
          index += 1
          continue
        }
        break
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index].trim()
      if (
        !current ||
        current.startsWith('# ') ||
        current.startsWith('## ') ||
        current.startsWith('### ') ||
        current.startsWith('> ') ||
        current === '---' ||
        current === '***' ||
        current === '___' ||
        /^!\[([^\]]*)\]\(([^)]+)\)$/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break
      }
      paragraphLines.push(current)
      index += 1
    }

    blocks.push({ type: 'paragraph', lines: paragraphLines })
  }

  return blocks
}

function renderTemplateHeader(
  summary: string | undefined,
  palette: ThemePalette,
  context: ArticleContext,
  leadParagraph: string | undefined,
): string {
  const subtitleHtml = shouldRenderLeadSummary(summary, leadParagraph)
    ? `<section style="margin:0 0 20px;padding:14px 16px;border-radius:12px;background:${palette.highlight};"><p style="margin:0;color:${palette.body};font-size:15px;line-height:1.85;">${escapeHtml(summary!)}</p></section>`
    : ''

  if (!subtitleHtml) {
    return ''
  }

  return `<header style="margin:0 0 28px;">${subtitleHtml}</header>`
}

function renderBlock(block: WechatContentBlock, config: ResolvedLayoutConfig, palette: ThemePalette): string {
  switch (block.type) {
    case 'heading1':
      return ''
    case 'heading2':
      return `<h2 style="margin:36px 0 16px;color:${palette.heading};font-size:24px;line-height:1.6;font-weight:700;"><span style="display:inline-block;width:4px;height:18px;margin-right:8px;border-radius:999px;background:${palette.primary};vertical-align:-2px;"></span>${formatInline(block.text, palette)}</h2>`
    case 'heading3':
      return `<h3 style="margin:26px 0 12px;color:${palette.heading};font-size:18px;line-height:1.7;font-weight:600;">${formatInline(block.text, palette)}</h3>`
    case 'paragraph': {
      const callout = renderCallout(block.lines, palette)
      if (callout) return callout
      return `<p style="margin:0 0 20px;color:${palette.body};font-size:15px;line-height:1.95;letter-spacing:0.01em;text-align:justify;">${block.lines.map((line) => formatInline(line, palette)).join('<br />')}</p>`
    }
    case 'blockquote':
      return `<blockquote style="margin:24px 0;padding:14px 16px;border-left:3px solid ${palette.quoteBorder};border-radius:0 10px 10px 0;background:${palette.quoteBackground};color:${palette.body};font-size:14px;line-height:1.85;">${block.lines.map((line) => formatInline(line, palette)).join('<br />')}</blockquote>`
    case 'list':
      return renderList(block, config, palette)
    case 'image':
      return renderImage(block, config, palette)
    case 'divider':
      return `<div style="display:flex;justify-content:center;gap:6px;margin:30px 0;">${[0, 1, 2].map(() => `<span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${palette.divider};"></span>`).join('')}</div>`
  }
}

function renderCallout(lines: string[], palette: ThemePalette): string | null {
  const joined = lines.join(' ').trim()
  const prefixes = ['核心观点：', '关键结论：', '实践建议：', '重点提醒：']
  const matched = prefixes.find((prefix) => joined.startsWith(prefix))
  if (!matched) return null
  const content = joined.slice(matched.length).trim()
  return `<div style="margin:24px 0;padding:14px 16px;border-radius:12px;background:${palette.highlight};color:${palette.body};font-size:14px;line-height:1.85;"><p style="margin:0 0 6px;color:${palette.primary};font-size:12px;font-weight:700;letter-spacing:0.06em;">${escapeHtml(matched.replace('：', ''))}</p><p style="margin:0;">${formatInline(content, palette)}</p></div>`
}

function renderList(block: Extract<WechatContentBlock, { type: 'list' }>, config: ResolvedLayoutConfig, palette: ThemePalette): string {
  const items = block.items
    .map((item, index) => {
      const marker = block.ordered
        ? `<span style="display:inline-flex;width:20px;height:20px;margin-right:10px;border-radius:999px;background:${palette.primary};color:${palette.primaryForeground};font-size:12px;font-weight:700;align-items:center;justify-content:center;flex-shrink:0;">${index + 1}</span>`
        : `<span style="display:inline-block;width:6px;height:6px;margin:10px 12px 0 0;border-radius:999px;background:${palette.primary};flex-shrink:0;"></span>`
      return `<li style="display:flex;align-items:flex-start;margin:10px 0;color:${palette.body};font-size:15px;line-height:1.9;">${marker}<span style="flex:1;">${formatInline(item, palette)}</span></li>`
    })
    .join('')

  return `<${block.ordered ? 'ol' : 'ul'} style="margin:16px 0;padding:0;list-style:none;">${items}</${block.ordered ? 'ol' : 'ul'}>`
}

function renderImage(block: Extract<WechatContentBlock, { type: 'image' }>, config: ResolvedLayoutConfig, palette: ThemePalette): string {
  if (/^image:(?:cover|section-\d+|para-\d+)$/.test(block.src)) {
    return ''
  }

  const radius = config.imageStyle === 'square' ? '0' : '12px'
  const shadow = config.imageStyle === 'soft-shadow' ? 'box-shadow:0 18px 36px rgba(15,23,42,0.12);' : ''
  const safeAlt = sanitizeVisibleImageAlt(block.alt)
  return `<figure style="margin:26px 0;text-align:center;"><img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(safeAlt)}" style="display:inline-block;max-width:100%;height:auto;border-radius:${radius};${shadow}" /></figure>`
}

function sanitizeVisibleImageAlt(value: string | undefined): string {
  const normalized = value
    ?.replace(/image:(?:cover|section-\d+|para-\d+)/g, '')
    ?.replace(/开篇配图，有画面感/g, '')
    ?.replace(/段落配图，视觉化核心/g, '')
    ?.replace(/章节配图，视觉化核心/g, '')
    ?.replace(/\s+/g, ' ')
    ?.trim()

  if (!normalized) return '文章配图'
  if (/^(配图|文章配图|封面图)$/u.test(normalized)) return '文章配图'
  return normalized
}

function renderTemplateFooter(
  summary: string | undefined,
  config: ResolvedLayoutConfig,
  palette: ThemePalette,
  context: ArticleContext,
): string {
  const relatedHtml = context.relatedTitles.length
    ? `<div style="margin:0 0 28px;"><h4 style="margin:0 0 12px;color:${palette.heading};font-size:14px;font-weight:700;"><span style="display:inline-block;width:4px;height:14px;margin-right:8px;border-radius:999px;background:${palette.primary};vertical-align:-1px;"></span>相关阅读</h4>${context.relatedTitles.map((title, index) => `<div style="padding:12px 0;border-bottom:${index === context.relatedTitles.length - 1 ? '0' : `1px solid ${palette.divider}`};"><p style="margin:0;color:${palette.heading};font-size:14px;line-height:1.75;font-weight:600;">${escapeHtml(title)}</p><p style="margin:4px 0 0;color:${palette.muted};font-size:12px;">${formatDateForWechat()}</p></div>`).join('')}</div>`
    : ''

  const accountName = config.brandName || '公众号'
  const intro = config.endingCardText || summary || '专注分享优质内容。'
  const copyrightHtml = config.brandName
    ? `<p style="margin:14px 0 0;text-align:center;color:${palette.muted};font-size:12px;">本文由 ${escapeHtml(config.brandName)} 原创 · 转载请注明出处</p>`
    : ''

  return `<footer style="margin:40px 0 0;"><div style="display:flex;align-items:center;gap:12px;margin:0 0 28px;"><span style="flex:1;height:1px;background:${palette.divider};"></span><span style="color:${palette.muted};font-size:12px;">— 全文完 —</span><span style="flex:1;height:1px;background:${palette.divider};"></span></div><div style="display:flex;gap:14px;align-items:flex-start;margin:0 0 28px;padding:16px;border-radius:16px;background:${palette.footerBackground};"><div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:999px;background:${palette.primary};color:${palette.primaryForeground};font-size:18px;font-weight:700;flex-shrink:0;">${escapeHtml(accountName.slice(0, 1))}</div><div style="flex:1;min-width:0;"><p style="margin:0 0 4px;color:${palette.heading};font-size:14px;font-weight:700;">${escapeHtml(accountName)}</p><p style="margin:0;color:${palette.muted};font-size:12px;line-height:1.75;">${escapeHtml(intro)}</p></div></div>${relatedHtml}${copyrightHtml}</footer>`
}

function cleanSummary(summary?: string): string | undefined {
  const trimmed = summary
    ?.replace(/image:(?:cover|section-\d+|para-\d+)/g, '')
    ?.replace(/开篇配图，有画面感/g, '')
    ?.replace(/段落配图，视觉化核心/g, '')
    ?.replace(/\s+/g, ' ')
    ?.trim()

  if (!trimmed || trimmed.length < 18) {
    return undefined
  }

  return trimmed.slice(0, 120).trim()
}

function extractLeadParagraph(blocks: WechatContentBlock[]): string | undefined {
  const firstParagraph = blocks.find((block) => block.type === 'paragraph')
  if (!firstParagraph || firstParagraph.type !== 'paragraph') {
    return undefined
  }
  return firstParagraph.lines.join(' ').trim()
}

function shouldRenderLeadSummary(summary: string | undefined, leadParagraph: string | undefined): boolean {
  if (!summary) return false
  if (!leadParagraph) return true

  const normalizedSummary = normalizeForCompare(summary)
  const normalizedLead = normalizeForCompare(leadParagraph)
  if (!normalizedSummary || !normalizedLead) return false
  if (normalizedSummary === normalizedLead) return false
  if (normalizedLead.includes(normalizedSummary) || normalizedSummary.includes(normalizedLead)) return false
  return true
}

function normalizeForCompare(value: string): string {
  return value
    .replace(/[“”"'‘’《》「」【】（）()—\-：:，,。！？!?]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function estimateReadTime(textLength: number): string {
  const minutes = Math.max(3, Math.ceil(textLength / 420))
  return `${minutes} 分钟`
}

function formatInline(text: string, palette: ThemePalette): string {
  if (!text) return ''

  let formatted = escapeHtml(text)
  const linkPlaceholders: string[] = []

  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_match, linkText, url) => {
    const placeholder = `__LINK_${linkPlaceholders.length}__`
    linkPlaceholders.push(`<a href="${escapeAttribute(url)}" style="color:${palette.primary};text-decoration:none;border-bottom:1px solid ${palette.primary};">${escapeHtml(linkText)}</a>`)
    return placeholder
  })

  formatted = formatted.replace(/`([^`]+)`/g, '<code style="padding:2px 6px;border-radius:6px;background:#f3f4f6;font-size:0.92em;color:#111827;">$1</code>')
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${palette.primary};font-weight:700;">$1</strong>`)
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  formatted = formatted.replace(/__LINK_(\d+)__/g, (_match, index) => linkPlaceholders[Number(index)] ?? '')

  return formatted
}

function formatDateForWechat(): string {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy} 年 ${mm} 月 ${dd} 日`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}
