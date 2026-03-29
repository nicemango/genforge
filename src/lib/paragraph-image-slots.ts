interface ParsedSection {
  heading?: string
  bodyLines: string[]
}

interface ParagraphCandidate {
  startLine: number
  endLine: number
  text: string
  score: number
}

export function normalizeParagraphImageSlots(markdown: string): string {
  const sections = parseSections(markdown)
  let paraCounter = 1
  let insertedCount = 0

  const normalizedSections = sections.map((section, index) => {
    if (index === 0 && !section.heading) {
      return normalizeIntroSection(section.bodyLines.join('\n'))
    }

    if (!section.heading) {
      return section.bodyLines.join('\n')
    }

    const bodyWithoutPlaceholders = section.bodyLines.filter((line) => !isImagePlaceholderLine(line))
    const rankedParagraphs = collectParagraphCandidates(bodyWithoutPlaceholders)
      .map((candidate, candidateIndex, all) => ({
        ...candidate,
        score: scoreParagraph(candidate.text, candidateIndex, all.length),
      }))
      .sort((a, b) => b.score - a.score)

    const selected = rankedParagraphs.find((candidate) => candidate.score >= 4)
      ?? rankedParagraphs.find(
        (candidate) =>
          candidate.text.trim().length >= 50 &&
          !isRhetoricalParagraph(candidate.text) &&
          !isClosingStyleParagraph(candidate.text),
      )

    if (!selected || insertedCount >= 3) {
      return [section.heading, ...bodyWithoutPlaceholders].join('\n')
    }

    const nextLines = [...bodyWithoutPlaceholders]
    nextLines.splice(selected.endLine + 1, 0, '', `![段落配图，视觉化核心](image:para-${paraCounter++})`)
    insertedCount += 1

    return [section.heading, ...nextLines].join('\n')
  })

  let normalized = normalizedSections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!/\(image:para-\d+\)/.test(normalized)) {
    normalized = insertFallbackParagraphSlot(normalized)
  }
  return normalized
}

function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.trim().split('\n')
  const sections: ParsedSection[] = []
  let current: ParsedSection = { bodyLines: [] }

  for (const line of lines) {
    if (/^##\s+/.test(line.trim())) {
      sections.push(current)
      current = { heading: line.trim(), bodyLines: [] }
      continue
    }
    current.bodyLines.push(line)
  }

  sections.push(current)
  return sections.filter((section) => section.heading || section.bodyLines.some((line) => line.trim()))
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
    if (!coverInserted && /^#\s+/.test(line.trim())) {
      normalizedLines.push('', '![开篇配图，有画面感](image:cover)')
      coverInserted = true
    }
  }

  if (!coverInserted) {
    normalizedLines.unshift('![开篇配图，有画面感](image:cover)', '')
  }

  return normalizedLines.join('\n')
}

function isImagePlaceholderLine(line: string): boolean {
  return /!\[[^\]]*\]\(image:(?:cover|section-\d+|para-\d+)\)/.test(line.trim())
}

function collectParagraphCandidates(lines: string[]): Array<Omit<ParagraphCandidate, 'score'>> {
  const paragraphs: Array<Omit<ParagraphCandidate, 'score'>> = []
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

function scoreParagraph(text: string, index: number, total: number): number {
  const normalized = text.trim()
  const baseScore =
    (/(对比|步骤|结论|原因|结构|默认|设置|权限|规则|平台|信号|层|行业|路径|选项|流程|分层)/.test(normalized) ? 3 : 0) +
    (/(GitHub|Copilot|OpenAI|Meta|模型|平台|训练|开发者|代码|仓库|协议|条款|许可证|benchmark|论文)/i.test(normalized) ? 2 : 0) +
    (/(?:\d+[%亿元万千]|\d+\.\d+)/.test(normalized) ? 2 : 0) +
    Math.min(2, Math.floor(normalized.length / 120))

  const isLastParagraph = index === total - 1
  const lastParagraphPenalty = isLastParagraph && isClosingStyleParagraph(normalized) ? 4 : 0
  const shortParagraphPenalty = normalized.length < 50 ? 3 : 0
  const rhetoricalPenalty = isRhetoricalParagraph(normalized) ? 4 : 0
  const positionBonus = !isLastParagraph ? 1 : 0

  return baseScore + positionBonus - lastParagraphPenalty - shortParagraphPenalty - rhetoricalPenalty
}

function isBlockquoteParagraph(text: string): boolean {
  return /^>\s?/.test(text)
}

function isClosingStyleParagraph(text: string): boolean {
  return /^(这才是|真正值得警惕|最值得警惕|归根结底|说到底|最终|最后|本质上|换句话说)/.test(text.trim())
}

function isRhetoricalParagraph(text: string): boolean {
  return /(你知道吗|你品品|换句话说|说白了|你想啊|更重要的是|这不是危言耸听|这背后是|为什么|还能信任什么)[？?]?$/.test(text.trim())
}

function insertFallbackParagraphSlot(markdown: string): string {
  const sections = parseSections(markdown)
  for (let index = 1; index < sections.length; index += 1) {
    const section = sections[index]
    if (!section.heading) continue
    const candidates = collectParagraphCandidates(section.bodyLines)
    const fallback = candidates.find(
      (candidate) =>
        candidate.text.trim().length >= 50 &&
        !isRhetoricalParagraph(candidate.text) &&
        !isClosingStyleParagraph(candidate.text),
    )
    if (!fallback) continue

    const nextLines = [...section.bodyLines]
    nextLines.splice(fallback.endLine + 1, 0, '', '![段落配图，视觉化核心](image:para-1)')
    const nextSections = [...sections]
    nextSections[index] = { ...section, bodyLines: nextLines }
    return nextSections
      .map((item) => (item.heading ? [item.heading, ...item.bodyLines].join('\n') : item.bodyLines.join('\n')))
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  return markdown
}
