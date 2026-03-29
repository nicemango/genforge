export function normalizeParagraphImageSlots(markdown: string): string {
  const sections = splitSections(markdown)
  let paraCounter = 1

  const normalizedSections = sections.map((section, sectionIndex) => {
    if (sectionIndex === 0) {
      return normalizeIntroSection(section)
    }

    const lines = section.split('\n')
    const heading = lines[0] ?? ''
    const bodyLines = lines.slice(1)
    const bodyWithoutPlaceholders = bodyLines.filter((line) => !isImagePlaceholderLine(line))
    const paragraphs = collectParagraphCandidates(bodyWithoutPlaceholders)

    if (paragraphs.length === 0) {
      return [heading, ...bodyWithoutPlaceholders].join('\n')
    }

    const bestParagraph = scoreParagraphs(paragraphs)[0]
    const insertAfterLine = bestParagraph.endLine
    const nextLines = [...bodyWithoutPlaceholders]
    nextLines.splice(insertAfterLine + 1, 0, '', `![段落配图，视觉化核心](image:para-${paraCounter++})`)

    return [heading, ...nextLines].join('\n')
  })

  let normalized = normalizedSections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()

  if (!/\(image:para-\d+\)/.test(normalized)) {
    normalized = insertFallbackParagraphSlot(normalized)
  }

  return normalized
}

function normalizeIntroSection(section: string): string {
  const lines = section.split('\n')
  const normalizedLines: string[] = []
  let coverInserted = false

  for (const line of lines) {
    if (isImagePlaceholderLine(line)) {
      if (!coverInserted && /\(image:cover\)/.test(line)) {
        normalizedLines.push('![开篇配图，有画面感](image:cover)')
        coverInserted = true
      }
      continue
    }

    normalizedLines.push(line)
    if (!coverInserted && /^#\s+/.test(line)) {
      normalizedLines.push('', '![开篇配图，有画面感](image:cover)')
      coverInserted = true
    }
  }

  if (!coverInserted) {
    normalizedLines.unshift('![开篇配图，有画面感](image:cover)', '')
  }

  return normalizedLines.join('\n')
}

function splitSections(markdown: string): string[] {
  return markdown.split(/\n(?=##\s+)/g)
}

function isImagePlaceholderLine(line: string): boolean {
  return /!\[[^\]]*\]\(image:(?:cover|section-\d+|para-\d+)\)/.test(line.trim())
}

interface ParagraphCandidate {
  startLine: number
  endLine: number
  text: string
}

function collectParagraphCandidates(lines: string[]): ParagraphCandidate[] {
  const paragraphs: ParagraphCandidate[] = []
  let start = -1
  let buffer: string[] = []

  const flush = (endIndex: number) => {
    if (start === -1 || buffer.length === 0) return
    const text = buffer.join(' ').trim()
    if (text && !isBlockquoteParagraph(text)) {
      paragraphs.push({ startLine: start, endLine: endIndex, text })
    }
    start = -1
    buffer = []
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flush(index - 1)
      return
    }

    if (/^#{1,6}\s+/.test(trimmed) || /^!\[/.test(trimmed)) {
      flush(index - 1)
      return
    }

    if (start === -1) start = index
    buffer.push(trimmed)
  })

  flush(lines.length - 1)
  return paragraphs
}

function scoreParagraphs(paragraphs: ParagraphCandidate[]): ParagraphCandidate[] {
  return paragraphs
    .map((paragraph, index) => ({
      paragraph,
      score: scoreParagraph(paragraph.text, index, paragraphs.length),
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.paragraph)
}

function scoreParagraph(text: string, index: number, total: number): number {
  const baseScore =
    (/(对比|步骤|结论|原因|结构|默认|设置|权限|规则|平台|信号|层|行业)/.test(text) ? 4 : 0) +
    (/(GitHub|Copilot|OpenAI|Meta|模型|平台|训练|开发者|代码|仓库)/i.test(text) ? 3 : 0) +
    (/(?:\d+[%亿元万千]|\d+\.\d+)/.test(text) ? 2 : 0) +
    Math.min(3, Math.floor(text.length / 80))

  const isLastParagraph = index === total - 1
  const lastParagraphPenalty = isLastParagraph && isClosingStyleParagraph(text) ? 4 : 0
  const positionBonus = !isLastParagraph ? 1 : 0

  return baseScore + positionBonus - lastParagraphPenalty
}

function isBlockquoteParagraph(text: string): boolean {
  return /^>\s?/.test(text)
}

function isClosingStyleParagraph(text: string): boolean {
  return /^(这才是|真正值得警惕|最值得警惕|归根结底|说到底|最终|最后|本质上|换句话说)/.test(text.trim())
}

function insertFallbackParagraphSlot(markdown: string): string {
  const lines = markdown.split('\n')
  const paragraphs = collectParagraphCandidates(lines)

  const candidate = paragraphs.find((paragraph) => paragraph.text.length >= 60)
  if (!candidate) {
    return markdown
  }

  const fallbackLines = [...lines]
  fallbackLines.splice(candidate.endLine + 1, 0, '', '![段落配图，视觉化核心](image:para-1)')
  return fallbackLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
