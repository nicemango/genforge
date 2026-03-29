import { z } from 'zod'
import type { AIProvider } from '@/lib/providers/types'
import { parseAgentOutput } from '@/lib/parse-agent-output'
import { normalizeParagraphImageSlots } from '@/lib/paragraph-image-slots'
import {
  HUMANIZE_SYSTEM_PROMPT,
  TONE_PRESET_INSTRUCTIONS,
  buildBrandVoice,
  buildFeedbackContext,
} from '../team/prompts'
import type { WriterContext } from '../team/types'
import type { WriterOutline, TitleCandidate } from './outline-editor'
import type { WriterRewriteSection } from './rewrite-editor'
import { getTemperature } from '../team/context'

const FinalSchema = z.object({
  title: z.string().min(8),
  content: z.string().min(800),
})

export interface WriterFinal {
  title: string
  content: string
}

interface HumanizeEditorParams {
  context: WriterContext
  outline: WriterOutline
  rewrite: WriterRewriteSection[]
}

function isConstrainedWriterModel(context: WriterContext): boolean {
  const model = (context.modelConfig.defaultModel ?? context.modelConfig.model ?? '').toLowerCase()
  const baseURL = (context.modelConfig.baseURL ?? '').toLowerCase()
  return model.includes('minimax') || baseURL.includes('minimaxi.com')
}

function calcMaxTokens(targetChineseChars: number = 2400): number {
  return Math.ceil(targetChineseChars * 1.8 * 1.35)
}

function buildHumanizePrompt(
  context: WriterContext,
  outline: WriterOutline,
  rewrite: WriterRewriteSection[],
): string {
  const constrainedModel = isConstrainedWriterModel(context)
  const toneInstruction = context.writingStyle?.tonePreset
    ? TONE_PRESET_INSTRUCTIONS[context.writingStyle.tonePreset]
    : null

  // Select the highest-scored title candidate
  const bestTitle = outline.titles.reduce((best: TitleCandidate, curr: TitleCandidate) =>
    curr.score > best.score ? curr : best,
    outline.titles[0],
  )

  return [
    buildBrandVoice(
      context.writingStyle?.brandName,
      context.writingStyle?.targetAudience,
    ),
    toneInstruction ? `\n【语气覆盖】\n${toneInstruction}` : '',
    '',
    buildFeedbackContext(context.reviewFeedback, context.optimizationFeedback),
    '## 已定大纲',
    JSON.stringify(outline, null, 2),
    '',
    '## 可选改写版本（必须优先采用 selectedStyle 对应版本）',
    JSON.stringify(rewrite, null, 2),
    '',
    '## 研究资料',
    context.research.rawOutput,
    '',
    '## 成稿要求',
    '1. 输出 title 和 content。',
    '2. content 第一行必须是 # title。',
    `3. 标题必须使用大纲中评分最高的候选：${bestTitle.title}（评分 ${bestTitle.score}/10，原因：${bestTitle.reason}）`,
    '4. 正文必须使用明确的 Markdown 二级标题结构：每个大章节都以 ## 标题开头，数量与大纲 sections 保持一致。',
    '5. Hook 后插入 1 张封面配图占位符 ![开篇配图，有画面感](image:cover)。',
    '6. 在每个 ## 大节开头之后（紧接 H2 标题的那段话之后），插入 1 个段落配图占位符：![配图描述](image:para-N)，N 从 1 开始递增。封面图和段落图都要有画面感。',
    constrainedModel
      ? '7. 全文字数严格控制在 1800-2200 字之间，不得少于 1800，也不得超过 2200。'
      : '7. 全文字数严格控制在 2200-2600 字之间，不得少于 2200，也不得超过 2600。',
    '7.1 如果篇幅不够，就补足案例、数据、对比分析和结尾推演，禁止为了简洁主动收短，也不得超出上限。',
    '8. 结尾必须收束观点、给出行动建议，并留下一个问题。',
    '',
    '## 输出 JSON schema',
    JSON.stringify(
      {
        title: bestTitle.title,
        content: '# ' + bestTitle.title + '\n\n完整 Markdown 正文',
      },
      null,
      2,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

function validateFinal(final: WriterFinal): string[] {
  const issues: string[] = []
  if (!final.content.startsWith('# ')) {
    issues.push('final.content 第一行必须是 Markdown H1 标题')
  }

  const slotMatches = [...final.content.matchAll(/!\[[^\]]*\]\(image:([a-z0-9-]+)\)/g)]
  const slotIds = slotMatches.map((match) => match[1])
  const coverCount = slotIds.filter((slotId) => slotId === 'cover').length
  const paragraphSlotIds = slotIds.filter((slotId) => slotId.startsWith('para-'))
  const h2Count = (final.content.match(/^##\s+/gm) ?? []).length

  if (coverCount !== 1) {
    issues.push(`封面配图占位符数量错误：${coverCount}（必须为 1）`)
  }
  if (paragraphSlotIds.length < Math.max(1, h2Count - 1)) {
    issues.push(
      `段落配图占位符不足：${paragraphSlotIds.length}（至少 ${Math.max(1, h2Count - 1)} 个）`,
    )
  }

  return issues
}

function normalizeFinal(final: WriterFinal): WriterFinal {
  const normalizedTitle = final.title.trim()
  let content = final.content.trim()

  if (!content.startsWith('# ')) {
    content = `# ${normalizedTitle}\n\n${content}`
  }

  const headingTitle = extractTitle(content)
  if (!headingTitle || headingTitle !== normalizedTitle) {
    content = content.replace(/^#\s+.*$/m, `# ${normalizedTitle}`)
  }

  content = normalizeParagraphImageSlots(content)

  return {
    title: normalizedTitle,
    content: content.trim(),
  }
}

function extractTitle(markdown: string): string | undefined {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
}

export async function runHumanizeEditor(
  provider: AIProvider,
  params: HumanizeEditorParams,
): Promise<WriterFinal> {
  const { context, outline, rewrite } = params
  const prompt = buildHumanizePrompt(context, outline, rewrite)
  const temperature = getTemperature(0.35, context.attempt, 'humanize')

  let lastError: string | null = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await provider.chat(
      [{ role: 'user', content: prompt }],
      {
        temperature,
        maxTokens: calcMaxTokens(),
        systemPrompt: HUMANIZE_SYSTEM_PROMPT,
      },
    )

    const raw = extractRawText(response)

    try {
      const final = parseAgentOutput(raw, FinalSchema, 'humanize-editor')
      const normalized = normalizeFinal(final)

      const issues = validateFinal(normalized)
      if (issues.length > 0) {
        throw new Error(`终稿质量不达标: ${issues.join('; ')}`)
      }

      return normalized
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : String(error)
      if (attempt === 3) break

      const retryPrompt = [
        prompt,
        '',
        '## 上一次输出失败原因（本次必须修复）',
        lastError,
        '',
        '重新输出完整、合法、严格符合 schema 的 JSON。不要解释。',
      ].join('\n')

      const retryResponse = await provider.chat(
        [{ role: 'user', content: retryPrompt }],
        {
          temperature,
          maxTokens: calcMaxTokens(),
          systemPrompt: HUMANIZE_SYSTEM_PROMPT,
        },
      )

      const retryRaw = extractRawText(retryResponse)
      try {
        const final = parseAgentOutput(retryRaw, FinalSchema, 'humanize-editor')
        const normalized = normalizeFinal(final)
        const issues = validateFinal(normalized)
        if (issues.length > 0) {
          throw new Error(`终稿质量不达标: ${issues.join('; ')}`)
        }
        return normalized
      } catch (retryError) {
        lastError =
          retryError instanceof Error ? retryError.message : String(retryError)
      }
    }
  }

  throw new Error(
    `[humanize-editor] 连续 3 次输出非法 JSON: ${lastError ?? '未知错误'}`,
  )
}

function extractRawText(response: {
  content: Array<{ type: string; text?: string }>
}): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
}
