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
  bodyColor: string
  mutedColor: string
  lineColor: string
  quoteBackground: string
  quoteBorder: string
  dividerColor: string
  titleTextColor: string
  endingBackground: string
  endingBorder: string
  strongColor: string
  headingMuted: string
  pageBackground: string
  tagBackground: string
  tagTextColor: string
  authorBarBackground: string
  footerCardBackground: string
}

interface RenderState {
  sectionIndex: number
}

interface ArticleContext {
  coverImage?: { src: string; alt: string }
  relatedTitles: string[]
}

const THEME_DEFAULTS: Record<WechatThemeId, Omit<ResolvedLayoutConfig, 'brandName' | 'endingCardText'>> = {
  'brand-clean': {
    themeId: 'brand-clean',
    primaryColor: '#1f6feb',
    accentColor: '#dbeafe',
    titleAlign: 'left',
    showEndingCard: true,
    imageStyle: 'rounded',
  },
  'brand-magazine': {
    themeId: 'brand-magazine',
    primaryColor: '#8f86d8',
    accentColor: '#f1eeff',
    titleAlign: 'center',
    showEndingCard: true,
    imageStyle: 'soft-shadow',
  },
  'brand-warm': {
    themeId: 'brand-warm',
    primaryColor: '#2f7a4e',
    accentColor: '#e4f2e7',
    titleAlign: 'left',
    showEndingCard: true,
    imageStyle: 'rounded',
  },
  'wechat-pro': {
    themeId: 'wechat-pro',
    primaryColor: '#1f9d63',
    accentColor: '#ecfaf2',
    titleAlign: 'left',
    showEndingCard: true,
    imageStyle: 'rounded',
  },
}

export function compileWechatArticle(markdown: string, options: WechatRenderOptions): string {
  const config = resolveLayoutConfig(options.layoutConfig)
  const articleContext = buildArticleContext(markdown, config)
  const blocks = parseMarkdownToBlocks(markdown, articleContext, config)
  if (!blocks.some((block) => block.type === 'heading1')) {
    blocks.unshift({ type: 'heading1', text: options.title.trim() })
  }
  const palette = buildPalette(config)
  const renderState: RenderState = { sectionIndex: 0 }
  const renderedBlocks = blocks
    .map((block) => {
      if (block.type === 'heading2') {
        renderState.sectionIndex += 1
      }
      return renderBlock(block, config, palette, renderState)
    })
    .filter(Boolean)

  if (config.showEndingCard) {
    renderedBlocks.push(renderEndingCard(config, palette, options.summary, articleContext))
  }

  return renderedBlocks.join('\n')
}

function resolveLayoutConfig(config?: WechatLayoutConfig): ResolvedLayoutConfig {
  const themeId = config?.themeId ?? 'brand-clean'
  const themeDefaults = THEME_DEFAULTS[themeId]
  return {
    themeId,
    brandName: config?.brandName?.trim() || '内容中心',
    primaryColor: config?.primaryColor?.trim() || themeDefaults.primaryColor,
    accentColor: config?.accentColor?.trim() || themeDefaults.accentColor,
    titleAlign: config?.titleAlign ?? themeDefaults.titleAlign,
    showEndingCard: config?.showEndingCard ?? themeDefaults.showEndingCard,
    endingCardText: config?.endingCardText?.trim() || '如果这篇内容对你有启发，欢迎点个在看，或把你的判断留在评论区。',
    imageStyle: config?.imageStyle ?? themeDefaults.imageStyle,
  }
}

function buildPalette(config: ResolvedLayoutConfig): ThemePalette {
  if (config.themeId === 'brand-magazine') {
    return {
      bodyColor: '#60636f',
      mutedColor: '#a4a8b6',
      lineColor: 'rgba(143,134,216,0.16)',
      quoteBackground: '#f6f3ff',
      quoteBorder: config.primaryColor,
      dividerColor: config.primaryColor,
      titleTextColor: '#4b4f5c',
      endingBackground: '#f6f3ff',
      endingBorder: config.primaryColor,
      strongColor: '#756bd3',
      headingMuted: 'rgba(75,79,92,0.78)',
      pageBackground: '#fffdfa',
      tagBackground: '#f6f3ff',
      tagTextColor: '#8f86d8',
      authorBarBackground: '#ffffff',
      footerCardBackground: '#f6f3ff',
    }
  }

  if (config.themeId === 'wechat-pro') {
    return {
      bodyColor: '#3d4650',
      mutedColor: '#7d8792',
      lineColor: 'rgba(31,157,99,0.16)',
      quoteBackground: '#eff9f3',
      quoteBorder: config.primaryColor,
      dividerColor: '#d9e2dd',
      titleTextColor: '#1c252d',
      endingBackground: '#f5fbf7',
      endingBorder: config.primaryColor,
      strongColor: '#177e50',
      headingMuted: 'rgba(28,37,45,0.78)',
      pageBackground: '#ffffff',
      tagBackground: '#eff9f3',
      tagTextColor: '#177e50',
      authorBarBackground: '#ffffff',
      footerCardBackground: '#f4f8f6',
    }
  }

  return {
    bodyColor: '#2f3437',
    mutedColor: '#6b7280',
    lineColor: 'rgba(31,41,55,0.14)',
    quoteBackground: config.accentColor,
    quoteBorder: config.primaryColor,
    dividerColor: config.primaryColor,
    titleTextColor: '#1f2937',
    endingBackground: config.accentColor,
    endingBorder: config.primaryColor,
    strongColor: config.primaryColor,
    headingMuted: 'rgba(31,41,55,0.72)',
    pageBackground: '#fffdf9',
    tagBackground: config.accentColor,
    tagTextColor: config.primaryColor,
    authorBarBackground: '#ffffff',
    footerCardBackground: config.accentColor,
  }
}

function buildArticleContext(markdown: string, config: ResolvedLayoutConfig): ArticleContext {
  const imageMatches = [...markdown.matchAll(/^!\[([^\]]*)\]\(([^)]+)\)$/gm)]
  const coverCandidate = config.themeId === 'wechat-pro'
    ? imageMatches.find((match) => !/^image:(?:cover|section-\d+|para-\d+)$/.test(match[2].trim()))
    : undefined
  const relatedTitles = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 3)

  return {
    coverImage: coverCandidate ? { alt: coverCandidate[1].trim(), src: coverCandidate[2].trim() } : undefined,
    relatedTitles,
  }
}

function parseMarkdownToBlocks(markdown: string, context: ArticleContext, config: ResolvedLayoutConfig): WechatContentBlock[] {
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
      if (
        config.themeId === 'wechat-pro' &&
        !coverConsumed &&
        context.coverImage &&
        imageMatch[2].trim() === context.coverImage.src
      ) {
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

function renderBlock(block: WechatContentBlock, config: ResolvedLayoutConfig, palette: ThemePalette, state: RenderState): string {
  switch (block.type) {
    case 'heading1':
      return renderHeading1(block.text, config, palette)
    case 'heading2':
      return renderHeading2(block.text, config, palette, state)
    case 'heading3':
      return renderHeading3(block.text, config, palette)
    case 'paragraph':
      if (config.themeId === 'wechat-pro') {
        const callout = renderWechatProCallout(block.lines, config, palette)
        if (callout) return callout
      }
      if (config.themeId === 'brand-magazine') {
        return renderLabeledTextBlock('T', `<p style="margin:0;color:${palette.bodyColor};font-size:16px;line-height:2;letter-spacing:0.02em;text-align:justify;">${block.lines.map((line) => formatInline(line, palette)).join('<br />')}</p>`)
      }
      return `<p style="margin:14px 0;color:${palette.bodyColor};font-size:16px;line-height:1.9;letter-spacing:0.02em;text-align:justify;">${block.lines.map((line) => formatInline(line, palette)).join('<br />')}</p>`
    case 'blockquote':
      return renderQuote(block.lines, config, palette)
    case 'list':
      return renderList(block, config, palette)
    case 'image':
      return renderImage(block, config, palette)
    case 'divider':
      return renderDivider(config, palette)
  }
}

function renderHeading1(text: string, config: ResolvedLayoutConfig, palette: ThemePalette): string {
  if (config.themeId === 'wechat-pro') {
    return `<section style="margin:0 0 28px;">${renderWechatProCover(text)}<div style="margin:0 0 12px;"><span style="display:inline-block;padding:3px 9px;border-radius:4px;background:${palette.tagBackground};border:1px solid ${config.primaryColor};color:${palette.tagTextColor};font-size:11px;font-weight:700;line-height:1.4;">原创</span></div><h1 style="margin:0 0 10px;color:${palette.titleTextColor};font-size:30px;line-height:1.42;font-weight:700;letter-spacing:0.01em;">${formatInline(text, palette)}</h1><p style="margin:0 0 14px;color:${palette.mutedColor};font-size:15px;line-height:1.8;">${escapeHtml('从网页设计语言转写为公众号模板，强调阅读节奏、信息层级和微信原生观感。')}</p><section style="margin:0;padding:12px 0;border-top:1px solid rgba(0,0,0,0.06);border-bottom:1px solid rgba(0,0,0,0.06);background:${palette.authorBarBackground};"><table style="width:100%;border-collapse:collapse;"><tr><td style="vertical-align:middle;"><span style="display:inline-flex;width:36px;height:36px;border-radius:999px;background:${config.primaryColor};color:#fff;font-size:15px;font-weight:700;align-items:center;justify-content:center;">${escapeHtml((config.brandName || '内').slice(0, 1))}</span></td><td style="padding-left:10px;vertical-align:middle;"><p style="margin:0;color:${palette.titleTextColor};font-size:14px;font-weight:600;">${escapeHtml(config.brandName)}</p><p style="margin:2px 0 0;color:${palette.mutedColor};font-size:12px;">${formatDateForWechat()}</p></td><td style="text-align:right;vertical-align:middle;color:${palette.mutedColor};font-size:12px;">阅读约 8 分钟</td></tr></table></section></section>`
  }

  if (config.themeId === 'brand-magazine') {
    return `<section style="margin:4px 0 34px;padding:0 0 18px;border-bottom:1px solid ${palette.lineColor};text-align:left;"><h1 style="margin:0;color:${palette.titleTextColor};font-size:33px;line-height:1.42;font-weight:700;letter-spacing:0.01em;">${formatInline(text, palette)}</h1></section>`
  }

  if (config.themeId === 'brand-warm') {
    return `<section style="margin:0 0 28px;padding:18px 18px 0;background:linear-gradient(180deg, ${palette.quoteBackground}, rgba(255,255,255,0));border-radius:18px 18px 0 0;"><p style="margin:0 0 12px;color:${config.primaryColor};font-size:12px;letter-spacing:0.12em;">慢读一篇</p><h1 style="margin:0;font-size:29px;line-height:1.45;font-weight:700;letter-spacing:0.01em;text-align:${config.titleAlign};color:${palette.titleTextColor};">${formatInline(text, palette)}</h1></section>`
  }

  return `<section style="margin:0 0 28px;padding-bottom:16px;border-bottom:1px solid ${palette.lineColor};"><h1 style="margin:0;font-size:28px;line-height:1.45;font-weight:700;letter-spacing:0.01em;text-align:${config.titleAlign};color:${palette.titleTextColor};">${formatInline(text, palette)}</h1></section>`
}

function renderHeading2(text: string, config: ResolvedLayoutConfig, palette: ThemePalette, state: RenderState): string {
  if (config.themeId === 'wechat-pro') {
    return `<section style="margin:34px 0 16px;"><h2 style="margin:0;color:${palette.titleTextColor};font-size:22px;line-height:1.5;font-weight:700;"><span style="display:inline-block;width:4px;height:18px;margin-right:8px;border-radius:999px;background:${config.primaryColor};vertical-align:-2px;"></span>${formatInline(text, palette)}</h2></section>`
  }

  if (config.themeId === 'brand-magazine') {
    const part = `PART.${String(state.sectionIndex).padStart(2, '0')}`
    return `<section style="margin:48px 0 24px;text-align:center;"><p style="margin:0 0 12px;color:${config.primaryColor};font-size:13px;font-weight:700;letter-spacing:0.06em;">${part}</p><div style="display:inline-block;max-width:96%;transform:skew(-16deg);background:linear-gradient(90deg, #847bdd 0%, #9a91eb 100%);padding:11px 22px;box-shadow:0 10px 24px rgba(143,134,216,0.18);"><span style="display:inline-block;transform:skew(16deg);color:#ffffff;font-size:15px;line-height:1.7;font-weight:700;letter-spacing:0.01em;">${formatInline(text, palette)}</span></div></section>`
  }

  if (config.themeId === 'brand-warm') {
    return `<section style="margin:34px 0 16px;"><h2 style="display:inline-block;margin:0;padding:7px 14px;border-radius:12px;background:${palette.quoteBackground};font-size:20px;line-height:1.5;font-weight:700;color:${palette.titleTextColor};">${formatInline(text, palette)}</h2></section>`
  }

  return `<section style="margin:34px 0 16px;"><h2 style="margin:0;padding-left:12px;border-left:4px solid ${config.primaryColor};font-size:21px;line-height:1.5;font-weight:700;color:${palette.titleTextColor};">${formatInline(text, palette)}</h2></section>`
}

function renderHeading3(text: string, config: ResolvedLayoutConfig, palette: ThemePalette): string {
  if (config.themeId === 'wechat-pro') {
    return `<h3 style="margin:24px 0 10px;color:${palette.titleTextColor};font-size:17px;line-height:1.8;font-weight:600;">${formatInline(text, palette)}</h3>`
  }

  if (config.themeId === 'brand-magazine') {
    return renderLabeledTextBlock('H1', `<h3 style="margin:0;color:${palette.headingMuted};font-size:17px;line-height:1.9;font-weight:700;">${formatInline(text, palette)}</h3>`, '26px 0 12px')
  }

  return `<h3 style="margin:24px 0 10px;padding-left:10px;border-left:3px solid ${config.primaryColor};font-size:17px;line-height:1.5;font-weight:700;color:${palette.titleTextColor};">${formatInline(text, palette)}</h3>`
}

function renderQuote(lines: string[], config: ResolvedLayoutConfig, palette: ThemePalette): string {
  const content = lines.map((line) => formatInline(line, palette)).join('<br />')

  if (config.themeId === 'wechat-pro') {
    return `<section style="margin:22px 0;padding:14px 16px;border-left:3px solid ${palette.quoteBorder};border-radius:0 10px 10px 0;background:${palette.quoteBackground};"><p style="margin:0;color:${palette.bodyColor};font-size:14px;line-height:1.9;">${content}</p></section>`
  }

  if (config.themeId === 'brand-magazine') {
    return renderLabeledTextBlock('T', `<p style="margin:0;color:${palette.titleTextColor};font-size:15px;line-height:2;font-style:italic;">${content}</p>`, '24px 0')
  }

  if (config.themeId === 'brand-warm') {
    return `<section style="margin:20px 0;padding:16px 18px;border-radius:16px;background:${palette.quoteBackground};"><p style="margin:0;color:${palette.titleTextColor};font-size:15px;line-height:1.9;">${content}</p></section>`
  }

  return `<section style="margin:20px 0;padding:14px 16px;border-left:3px solid ${palette.quoteBorder};background:rgba(255,255,255,0.7);"><p style="margin:0;color:${palette.titleTextColor};font-size:15px;line-height:1.85;">${content}</p></section>`
}

function renderDivider(config: ResolvedLayoutConfig, palette: ThemePalette): string {
  if (config.themeId === 'wechat-pro') {
    return `<section style="margin:30px 0;text-align:center;"><span style="display:inline-block;width:100%;max-width:120px;height:1px;background:${palette.dividerColor};vertical-align:middle;"></span><span style="display:inline-block;margin:0 8px;color:${palette.mutedColor};font-size:11px;">● ● ●</span><span style="display:inline-block;width:100%;max-width:120px;height:1px;background:${palette.dividerColor};vertical-align:middle;"></span></section>`
  }

  if (config.themeId === 'brand-magazine') {
    return `<section style="margin:30px 0;text-align:center;color:${config.primaryColor};font-size:14px;letter-spacing:0.5em;">· · ·</section>`
  }

  if (config.themeId === 'brand-warm') {
    return `<section style="margin:30px 0;text-align:center;"><span style="display:inline-block;width:84px;height:1px;background:${palette.lineColor};vertical-align:middle;"></span><span style="display:inline-block;margin:0 10px;color:${config.primaryColor};font-size:13px;">◆</span><span style="display:inline-block;width:84px;height:1px;background:${palette.lineColor};vertical-align:middle;"></span></section>`
  }

  return `<section style="margin:28px 0;text-align:center;"><span style="display:inline-block;width:72px;height:2px;border-radius:999px;background:${palette.dividerColor};"></span></section>`
}

function renderList(block: Extract<WechatContentBlock, { type: 'list' }>, config: ResolvedLayoutConfig, palette: ThemePalette): string {
  if (config.themeId === 'wechat-pro') {
    const items = block.items
      .map((item, index) => {
        const marker = block.ordered
          ? `<span style="display:inline-flex;width:20px;height:20px;margin-right:10px;border-radius:999px;background:${config.primaryColor};color:#fff;font-size:12px;font-weight:700;align-items:center;justify-content:center;flex-shrink:0;">${index + 1}</span>`
          : `<span style="display:inline-block;width:6px;height:6px;margin:10px 12px 0 0;border-radius:999px;background:${config.primaryColor};flex-shrink:0;"></span>`
        return `<li style="display:flex;align-items:flex-start;margin:10px 0;color:${palette.bodyColor};font-size:15px;line-height:1.9;">${marker}<span style="flex:1;">${formatInline(item, palette)}</span></li>`
      })
      .join('')
    return `<ul style="margin:14px 0;padding:0;list-style:none;">${items}</ul>`
  }

  const tag = block.ordered ? 'ol' : 'ul'
  const listStyle = block.ordered ? 'decimal' : 'disc'
  const items = block.items
    .map((item) => `<li style="margin:8px 0;color:${palette.bodyColor};font-size:15px;line-height:1.85;">${formatInline(item, palette)}</li>`)
    .join('')
  const html = `<${tag} style="margin:14px 0 14px 1.4em;padding:0;list-style:${listStyle};">${items}</${tag}>`
  if (config.themeId === 'brand-magazine') {
    return renderLabeledTextBlock('T', html)
  }
  return html
}

function renderImage(block: Extract<WechatContentBlock, { type: 'image' }>, config: ResolvedLayoutConfig, palette: ThemePalette): string {
  if (/^image:(?:cover|section-\d+|para-\d+)$/.test(block.src)) {
    return ''
  }

  const radius = config.imageStyle === 'square' ? '0' : '18px'
  const shadow = config.imageStyle === 'soft-shadow' ? 'box-shadow:0 18px 36px rgba(15,23,42,0.14);' : ''
  const caption = block.alt
    ? `<p style="margin:10px 0 0;color:${palette.mutedColor};font-size:12px;line-height:1.6;text-align:center;">${escapeHtml(block.alt)}</p>`
    : ''

  if (config.themeId === 'wechat-pro') {
    return `<figure style="margin:26px 0;text-align:center;"><img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" style="display:inline-block;max-width:100%;height:auto;border-radius:12px;${shadow}" />${caption}</figure>`
  }

  return `<figure style="margin:24px 0;text-align:center;"><img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" style="display:inline-block;max-width:100%;height:auto;border-radius:${radius};${shadow}" />${caption}</figure>`
}

function renderEndingCard(config: ResolvedLayoutConfig, palette: ThemePalette, summary: string | undefined, context: ArticleContext): string {
  const summaryLine = summary?.trim()
    ? `<p style="margin:0 0 10px;color:${palette.bodyColor};font-size:14px;line-height:1.75;">${escapeHtml(summary.trim())}</p>`
    : ''

  if (config.themeId === 'wechat-pro') {
    const relatedHtml = context.relatedTitles.length > 0
      ? `<div style="margin-top:18px;"><p style="margin:0 0 10px;color:${palette.titleTextColor};font-size:14px;font-weight:700;"><span style="display:inline-block;width:4px;height:14px;margin-right:8px;border-radius:999px;background:${config.primaryColor};vertical-align:-1px;"></span>相关阅读</p>${context.relatedTitles.map((title, index) => `<div style="padding:12px 0;border-bottom:${index === context.relatedTitles.length - 1 ? 'none' : `1px solid ${palette.lineColor}`};"><p style="margin:0;color:${palette.titleTextColor};font-size:14px;line-height:1.7;">${escapeHtml(title)}</p><p style="margin:4px 0 0;color:${palette.mutedColor};font-size:12px;">${formatDateForWechat()}</p></div>`).join('')}</div>`
      : ''
    return `<section style="margin:40px 0 10px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;"><span style="flex:1;height:1px;background:${palette.lineColor};"></span><span style="color:${palette.mutedColor};font-size:12px;">— 全文完 —</span><span style="flex:1;height:1px;background:${palette.lineColor};"></span></div><div style="padding:16px;border-radius:14px;background:${palette.footerCardBackground};"><table style="width:100%;border-collapse:collapse;"><tr><td style="width:48px;vertical-align:top;"><span style="display:inline-flex;width:40px;height:40px;border-radius:999px;background:${config.primaryColor};color:#fff;font-size:16px;font-weight:700;align-items:center;justify-content:center;">${escapeHtml((config.brandName || '内').slice(0, 1))}</span></td><td style="vertical-align:top;"><p style="margin:0;color:${palette.titleTextColor};font-size:14px;font-weight:700;">${escapeHtml(config.brandName)}</p><p style="margin:4px 0 0;color:${palette.mutedColor};font-size:12px;line-height:1.7;">${summary ? escapeHtml(summary) : '专注输出高质量内容与观点，每周持续更新。'}</p></td><td style="text-align:right;vertical-align:top;"><span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${config.primaryColor};color:#fff;font-size:12px;">关注</span></td></tr></table>${relatedHtml}</div><p style="margin:14px 0 0;text-align:center;color:${palette.mutedColor};font-size:12px;">本文由 ${escapeHtml(config.brandName)} 原创 · 转载请注明出处</p></section>`
  }

  if (config.themeId === 'brand-magazine') {
    return `<section style="margin:42px 0 10px;padding:24px 0 0;border-top:1px solid ${palette.lineColor};text-align:center;"><p style="margin:0 0 14px;color:${config.primaryColor};font-size:13px;font-weight:700;letter-spacing:0.06em;">PART.END</p><div style="display:inline-block;max-width:96%;transform:skew(-14deg);background:linear-gradient(90deg, #847bdd 0%, #9a91eb 100%);padding:11px 20px;"><span style="display:inline-block;transform:skew(14deg);color:#fff;font-size:14px;line-height:1.7;">${escapeHtml(config.endingCardText)}</span></div>${summaryLine ? `<div style="margin-top:16px;">${summaryLine}</div>` : ''}<p style="margin:14px 0 0;color:${palette.mutedColor};font-size:12px;">${escapeHtml(config.brandName)}</p></section>`
  }

  if (config.themeId === 'brand-warm') {
    return `<section style="margin:34px 0 8px;padding:18px 18px 16px;border-radius:18px;background:${palette.endingBackground};"><p style="margin:0 0 8px;color:${config.primaryColor};font-size:12px;letter-spacing:0.08em;">收个尾</p>${summaryLine}<p style="margin:0;color:${palette.titleTextColor};font-size:14px;line-height:1.8;">${escapeHtml(config.endingCardText)}</p><p style="margin:12px 0 0;color:${palette.mutedColor};font-size:12px;">${escapeHtml(config.brandName)}</p></section>`
  }

  return `<section style="margin:32px 0 8px;padding:18px 18px 16px;border-top:2px solid ${palette.endingBorder};background:linear-gradient(180deg, ${palette.endingBackground}, rgba(255,255,255,0));"><p style="margin:0 0 8px;color:${config.primaryColor};font-size:12px;letter-spacing:0.08em;">最后一段</p>${summaryLine}<p style="margin:0;color:${palette.titleTextColor};font-size:14px;line-height:1.75;">${escapeHtml(config.endingCardText)}</p><p style="margin:12px 0 0;color:${palette.mutedColor};font-size:12px;">${escapeHtml(config.brandName)}</p></section>`
}

function formatInline(text: string, palette: ThemePalette): string {
  if (!text) return ''

  let formatted = escapeHtml(text)
  const linkPlaceholders: string[] = []

  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_match, linkText, url) => {
    const placeholder = `__LINK_${linkPlaceholders.length}__`
    linkPlaceholders.push(`<a href="${escapeAttribute(url)}" style="color:${palette.strongColor};text-decoration:none;border-bottom:1px solid ${palette.strongColor};">${escapeHtml(linkText)}</a>`)
    return placeholder
  })

  formatted = formatted.replace(/`([^`]+)`/g, '<code style="padding:2px 6px;border-radius:6px;background:#f3f4f6;font-size:0.92em;color:#111827;">$1</code>')
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${palette.strongColor};font-weight:700;">$1</strong>`)
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  formatted = formatted.replace(/__LINK_(\d+)__/g, (_match, index) => linkPlaceholders[Number(index)] ?? '')

  return formatted
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

function renderLabeledTextBlock(label: string, innerHtml: string, margin = '14px 0'): string {
  return `<section style="margin:${margin};"><span style="display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;margin-right:12px;padding:0 5px;vertical-align:top;color:#aeb2bf;background:#f2f3f7;border-radius:4px;font-size:10px;font-weight:700;line-height:20px;letter-spacing:0.06em;">${escapeHtml(label)} ::</span><div style="display:inline-block;width:calc(100% - 54px);vertical-align:top;">${innerHtml}</div></section>`
}

function formatDateForWechat(): string {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy} 年 ${mm} 月 ${dd} 日`
}

function renderWechatProCover(title: string): string {
  return `<div style="margin:0 0 20px;border-radius:14px;overflow:hidden;background:linear-gradient(135deg, #dff7ea 0%, #f4fbf7 42%, #ebf7ff 100%);"><div style="padding:30px 24px 26px;"><p style="margin:0 0 10px;color:#1f9d63;font-size:12px;letter-spacing:0.08em;">FEATURE ARTICLE</p><p style="margin:0;color:#1c252d;font-size:20px;line-height:1.55;font-weight:700;">${escapeHtml(title)}</p></div></div>`
}

function renderWechatProCallout(lines: string[], config: ResolvedLayoutConfig, palette: ThemePalette): string | null {
  const joined = lines.join(' ').trim()
  const prefixes = ['核心观点：', '关键结论：', '实践建议：', '重点提醒：']
  const matched = prefixes.find((prefix) => joined.startsWith(prefix))
  if (!matched) return null

  const content = joined.slice(matched.length).trim()
  return `<section style="margin:22px 0;padding:14px 16px;border-radius:12px;background:${palette.quoteBackground};"><p style="margin:0 0 6px;color:${config.primaryColor};font-size:12px;font-weight:700;letter-spacing:0.06em;">${escapeHtml(matched.replace('：', ''))}</p><p style="margin:0;color:${palette.bodyColor};font-size:14px;line-height:1.85;">${formatInline(content, palette)}</p></section>`
}
