import { pushToDraft, uploadImage } from '@/lib/wechat'

export interface PublishResult {
  mediaId: string
  publishedAt: string
}

export async function runPublishAgent(
  accountId: string,
  title: string,
  body: string,
  summary?: string,
): Promise<PublishResult> {
  const htmlContent = await replaceImagesWithWechatUrls(accountId, body)

  const mediaId = await pushToDraft(accountId, {
    title,
    content: htmlContent,
    digest: summary,
  })

  return {
    mediaId,
    publishedAt: new Date().toISOString(),
  }
}

async function replaceImagesWithWechatUrls(accountId: string, markdown: string): Promise<string> {
  const html = markdownToWechatHtml(markdown)

  // Find all base64 images in the HTML
  const base64Regex = /<img[^>]+src="data:image\/jpeg;base64,([^"]+)"[^>]*>/g
  const matches = [...html.matchAll(base64Regex)]

  if (matches.length === 0) {
    return html
  }

  let result = html
  for (const match of matches) {
    const base64 = match[1]
    const wechatUrl = await uploadWithRetry(accountId, base64)
    if (wechatUrl) {
      result = result.replace(`data:image/jpeg;base64,${base64}`, () => wechatUrl)
    }
    // If wechatUrl is null, base64 stays in place (graceful degradation)
  }

  return result
}

async function uploadWithRetry(accountId: string, base64: string, maxRetries = 3): Promise<string | null> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadImage(accountId, base64)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s
        await sleep(attempt * 1000)
      }
    }
  }
  console.warn(`Failed to upload image to WeChat after ${maxRetries} attempts: ${lastError?.message}`)
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function markdownToWechatHtml(markdown: string): string {
  // Normalize line endings
  let html = markdown.replace(/\r\n/g, '\n').trim()

  // Preserve image tags — must be done BEFORE any inline tag processing
  // Match both standard markdown images and data-uri images
  // Also handle unresolved cover placeholders: ![alt](cover) -> empty span (no image available)
  const imagePlaceholders: string[] = []
  html = html.replace(/!\[([^\]]*)\]\((data:image[^)]+)\)/g, (_match, alt, src) => {
    const placeholder = `__IMG_${imagePlaceholders.length}__`
    imagePlaceholders.push(`<img src="${src}" alt="${alt}" style="max-width:100%;display:block;margin:16px 0;" />`)
    return placeholder
  })

  // Remove unresolved cover placeholders — they mean no image was generated
  html = html.replace(/!\[([^\]]*)\]\(cover\)/g, '')

  // Process line by line: identify block types first, then wrap
  const lines = html.split('\n')
  const outputBlocks: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      i++
      continue
    }

    // H1 heading
    if (trimmed.startsWith('# ')) {
      outputBlocks.push(`<h1>${inlineFormat(trimmed.slice(2).trim())}</h1>`)
      i++
      continue
    }

    // H2 heading (most article sections use H2)
    if (trimmed.startsWith('## ')) {
      outputBlocks.push(`<h2>${inlineFormat(trimmed.slice(3).trim())}</h2>`)
      i++
      continue
    }

    // H3 heading
    if (trimmed.startsWith('### ')) {
      outputBlocks.push(`<h3>${inlineFormat(trimmed.slice(4).trim())}</h3>`)
      i++
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2))
        i++
      }
      const quoteText = quoteLines.join(' ')
      outputBlocks.push(`<blockquote><p>${inlineFormat(quoteText)}</p></blockquote>`)
      continue
    }

    // Unordered list — collect consecutive lines, support nesting via indentation
    if (/^[-*]\s/.test(trimmed)) {
      outputBlocks.push(parseNestedList(lines, i, 'ul'))
      // Advance past all list lines (including nested)
      while (i < lines.length && /^(\s*)[-*]\s/.test(lines[i]) && lines[i].trim()) {
        i++
      }
      continue
    }

    // Ordered list — collect consecutive numbered lines, support nesting
    if (/^\d+\.\s/.test(trimmed)) {
      outputBlocks.push(parseNestedList(lines, i, 'ol'))
      while (i < lines.length && /^(\s*)\d+\.\s/.test(lines[i]) && lines[i].trim()) {
        i++
      }
      continue
    }

    // Horizontal rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      outputBlocks.push('<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />')
      i++
      continue
    }

    // Image placeholder (from earlier replacement)
    if (trimmed.startsWith('__IMG_')) {
      const imgIdx = parseInt(trimmed.slice(6), 10)
      if (imgIdx < 0 || imgIdx >= imagePlaceholders.length) {
        throw new Error(`Image placeholder index ${imgIdx} out of bounds (total images: ${imagePlaceholders.length})`)
      }
      outputBlocks.push(imagePlaceholders[imgIdx])
      i++
      continue
    }

    // Paragraph: collect consecutive non-blank, non-tag lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('- ') &&
      !lines[i].trim().startsWith('* ') &&
      !lines[i].trim().startsWith('> ') &&
      !/^\d+\.\s/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('__IMG_') &&
      lines[i].trim() !== '---' &&
      lines[i].trim() !== '***' &&
      lines[i].trim() !== '___'
    ) {
      const t = lines[i].trim()
      if (!t.startsWith('__IMG_')) {
        paraLines.push(t)
      }
      i++
    }
    if (paraLines.length > 0) {
      // Join with <br> for line breaks within paragraph, then inline format
      const joined = paraLines.join('<br>')
      outputBlocks.push(`<p>${inlineFormat(joined)}</p>`)
    }
  }

  return outputBlocks.join('\n')
}

// Parse nested lists by tracking indentation levels
function parseNestedList(lines: string[], startIdx: number, rootTag: 'ul' | 'ol'): string {
  const isListLine = (line: string): boolean => {
    const t = line.trimStart()
    return rootTag === 'ul' ? /^[-*]\s/.test(t) : /^\d+\.\s/.test(t)
  }

  const getIndent = (line: string): number => line.length - line.trimStart().length
  const getContent = (line: string): string => {
    const t = line.trimStart()
    return rootTag === 'ul' ? t.slice(2) : t.replace(/^\d+\.\s/, '')
  }

  const parts: string[] = []
  const indentStack: number[] = []
  let i = startIdx

  parts.push(`<${rootTag}>`)
  indentStack.push(getIndent(lines[startIdx]))

  while (i < lines.length && lines[i].trim() && isListLine(lines[i])) {
    const indent = getIndent(lines[i])
    const currentLevel = indentStack[indentStack.length - 1]

    if (indent > currentLevel) {
      // Open nested list
      parts.push(`<${rootTag}>`)
      indentStack.push(indent)
    } else {
      while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]) {
        // Close nested list(s)
        parts.push(`</li></${rootTag}>`)
        indentStack.pop()
      }
    }

    parts.push(`<li>${inlineFormat(getContent(lines[i]))}`)
    // Check if next line is deeper (will open sub-list), if not close li
    const nextIdx = i + 1
    if (nextIdx >= lines.length || !lines[nextIdx].trim() || !isListLine(lines[nextIdx]) || getIndent(lines[nextIdx]) <= indent) {
      parts.push('</li>')
    }

    i++
  }

  // Close remaining open tags
  while (indentStack.length > 0) {
    if (indentStack.length > 1) {
      parts.push(`</${rootTag}>`)
    }
    indentStack.pop()
  }
  parts.push(`</${rootTag}>`)

  return parts.join('')
}

// Apply inline formatting: bold, italic, links, code
function inlineFormat(text: string): string {
  if (!text) return text

  // Restore image placeholders within paragraphs
  text = text.replace(/__IMG_(\d+)__/g, (_, idx) => `__IMG_${idx}__`)

  // Extract links first to protect URLs from bold/italic regex matching * in URLs
  const linkPlaceholders: string[] = []
  // Markdown links: [text](url)
  text = text.replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, (_, linkText, url) => {
    const placeholder = `__LINK_${linkPlaceholders.length}__`
    linkPlaceholders.push(`<a href="${url}">${linkText}</a>`)
    return placeholder
  })
  // Relative URL links
  text = text.replace(/\[(.+?)\]\((?!https?:\/\/)([^)]+)\)/g, (_, linkText) => {
    const placeholder = `__LINK_${linkPlaceholders.length}__`
    linkPlaceholders.push(`<span>${linkText}</span>`)
    return placeholder
  })

  // Code inline: `code`
  text = text.replace(/`([^`]+)`/g, '<code style="background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:0.9em;">$1</code>')

  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Italic: *text*
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Restore link placeholders
  text = text.replace(/__LINK_(\d+)__/g, (_, idx) => {
    const index = parseInt(idx, 10)
    if (index < 0 || index >= linkPlaceholders.length) {
      throw new Error(`Link placeholder index ${index} out of bounds (total: ${linkPlaceholders.length})`)
    }
    return linkPlaceholders[index]
  })

  return text
}
