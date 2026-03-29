import { z } from 'zod'
import type { AIProvider } from '@/lib/providers/types'
import { parseAgentOutput } from '@/lib/parse-agent-output'
import {
  DRAFT_SYSTEM_PROMPT,
  buildStyleInstructions,
  buildFeedbackContext,
} from '../team/prompts'
import type { WriterContext } from '../team/types'
import type { WriterOutline } from './outline-editor'
import { getTemperature } from '../team/context'

const DraftSchema = z
  .array(
    z.object({
      sectionTitle: z.string().min(1),
      content: z.string().min(120),
    }),
  )
  .min(3)
  .max(5)

export type WriterDraftSection = z.infer<typeof DraftSchema>[number]

interface DraftWriterParams {
  context: WriterContext
  outline: WriterOutline
}

function buildDraftPrompt(context: WriterContext, outline: WriterOutline): string {
  return [
    buildFeedbackContext(context.reviewFeedback, context.optimizationFeedback),
    '## 文章方向',
    `主标题候选：${outline.titles.map((t) => t.title).join(' / ')}`,
    `推荐 hook：${outline.hook}`,
    '',
    '## 章节骨架（按顺序生成，sectionTitle 必须与 title 完全一致）',
    ...outline.sections.map(
      (section, index) =>
        `${index + 1}. ${section.title}\n核心观点：${section.corePoint}`,
    ),
    '',
    '## 选题背景',
    `标题方向：${context.topic.title}`,
    `写作角度：${context.topic.angle}`,
    '',
    '## 风格要求',
    buildStyleInstructions(context.writingStyle),
    '',
    '## 研究资料',
    context.research.rawOutput,
    '',
    '## 输出 JSON schema',
    JSON.stringify(
      [
        {
          sectionTitle: outline.sections[0]?.title ?? '章节标题',
          content: '该章节初稿正文',
        },
      ],
      null,
      2,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

function validateSectionAlignment(
  stage: 'draft',
  outline: WriterOutline,
  sections: Array<{ sectionTitle: string }>,
): string[] {
  const issues: string[] = []
  if (sections.length !== outline.sections.length) {
    issues.push(
      `${stage} 段落数与大纲不一致：${sections.length} vs ${outline.sections.length}`,
    )
    return issues
  }

  outline.sections.forEach((section, index) => {
    const actualTitle = sections[index]?.sectionTitle
    if (actualTitle !== section.title) {
      issues.push(
        `${stage} 第 ${index + 1} 段标题不匹配：${actualTitle ?? '缺失'} vs ${section.title}`,
      )
    }
  })

  return issues
}

export async function runDraftWriter(
  provider: AIProvider,
  params: DraftWriterParams,
): Promise<WriterDraftSection[]> {
  const { context, outline } = params
  const prompt = buildDraftPrompt(context, outline)
  const temperature = getTemperature(0.45, context.attempt, 'draft')

  let lastError: string | null = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await provider.chat(
      [{ role: 'user', content: prompt }],
      { temperature, maxTokens: 3200, systemPrompt: DRAFT_SYSTEM_PROMPT },
    )

    const raw = extractRawText(response)

    try {
      const draft = parseAgentOutput(raw, DraftSchema, 'draft-writer')

      const issues = validateSectionAlignment('draft', outline, draft)
      if (issues.length > 0) {
        throw new Error(`初稿结构不匹配: ${issues.join('; ')}`)
      }

      return draft
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
        { temperature, maxTokens: 3200, systemPrompt: DRAFT_SYSTEM_PROMPT },
      )

      const retryRaw = extractRawText(retryResponse)
      try {
        const draft = parseAgentOutput(retryRaw, DraftSchema, 'draft-writer')
        const issues = validateSectionAlignment('draft', outline, draft)
        if (issues.length > 0) {
          throw new Error(`初稿结构不匹配: ${issues.join('; ')}`)
        }
        return draft
      } catch (retryError) {
        lastError =
          retryError instanceof Error ? retryError.message : String(retryError)
      }
    }
  }

  throw new Error(
    `[draft-writer] 连续 3 次输出非法 JSON: ${lastError ?? '未知错误'}`,
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
