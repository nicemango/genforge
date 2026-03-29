import { z } from 'zod'
import type { AIProvider } from '@/lib/providers/types'
import { parseAgentOutput } from '@/lib/parse-agent-output'
import {
  REWRITE_SYSTEM_PROMPT,
  buildStyleInstructions,
  buildFeedbackContext,
} from '../team/prompts'
import type { WriterContext } from '../team/types'
import type { WriterOutline } from './outline-editor'
import type { WriterDraftSection } from './draft-writer'
import { getTemperature } from '../team/context'

const RewriteSchema = z
  .array(
    z.object({
      sectionTitle: z.string().min(1),
      emotional: z.string().min(120),
      rational: z.string().min(120),
      casual: z.string().min(120),
      selectedStyle: z.enum(['emotional', 'rational', 'casual']),
    }),
  )
  .min(3)
  .max(5)

export type WriterRewriteStyle = 'emotional' | 'rational' | 'casual'

export type WriterRewriteSection = z.infer<typeof RewriteSchema>[number]

interface RewriteEditorParams {
  context: WriterContext
  outline: WriterOutline
  draft: WriterDraftSection[]
}

const MAX_DRAFT_CONTENT_LEN = 400

function truncateDraft(draft: WriterDraftSection[]): WriterDraftSection[] {
  return draft.map((s) => ({
    ...s,
    content:
      s.content.length > MAX_DRAFT_CONTENT_LEN
        ? s.content.slice(0, MAX_DRAFT_CONTENT_LEN) + '...（已截断）'
        : s.content,
  }))
}

const MAX_RESEARCH_LEN = 3000

function buildRewritePrompt(
  context: WriterContext,
  outline: WriterOutline,
  draft: WriterDraftSection[],
): string {
  const truncatedDraft = truncateDraft(draft)
  const researchRaw =
    context.research.rawOutput.length > MAX_RESEARCH_LEN
      ? context.research.rawOutput.slice(0, MAX_RESEARCH_LEN) + '...（已截断）'
      : context.research.rawOutput

  return [
    buildFeedbackContext(context.reviewFeedback, context.optimizationFeedback),
    '## 章节目标',
    ...outline.sections.map(
      (section, index) =>
        `${index + 1}. ${section.title}\n核心观点：${section.corePoint}`,
    ),
    '',
    '## 初稿分段（已截断，仅供风格参考）',
    JSON.stringify(truncatedDraft, null, 2),
    '',
    '## 研究资料（已截断）',
    researchRaw,
    '',
    '## 风格要求',
    buildStyleInstructions(context.writingStyle),
    '',
    '## 输出 JSON schema',
    JSON.stringify(
      [
        {
          sectionTitle: outline.sections[0]?.title ?? '章节标题',
          emotional: '更有冲击力的版本',
          rational: '更强调逻辑与数据的版本',
          casual: '更像朋友聊天的版本',
          selectedStyle: 'rational',
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
  stage: 'rewrite',
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

export async function runRewriteEditor(
  provider: AIProvider,
  params: RewriteEditorParams,
): Promise<WriterRewriteSection[]> {
  const { context, outline, draft } = params
  const prompt = buildRewritePrompt(context, outline, draft)
  const temperature = getTemperature(0.55, context.attempt, 'rewrite')

  let lastError: string | null = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await provider.chat(
      [{ role: 'user', content: prompt }],
      { temperature, maxTokens: 4200, systemPrompt: REWRITE_SYSTEM_PROMPT },
    )

    const raw = extractRawText(response)

    try {
      const rewrite = parseAgentOutput(raw, RewriteSchema, 'rewrite-editor')

      const issues = validateSectionAlignment('rewrite', outline, rewrite)
      if (issues.length > 0) {
        throw new Error(`改写结构不匹配: ${issues.join('; ')}`)
      }

      return rewrite
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

      // Retry with corrected prompt
      const retryResponse = await provider.chat(
        [{ role: 'user', content: retryPrompt }],
        { temperature, maxTokens: 4200, systemPrompt: REWRITE_SYSTEM_PROMPT },
      )

      const retryRaw = extractRawText(retryResponse)
      try {
        const rewrite = parseAgentOutput(retryRaw, RewriteSchema, 'rewrite-editor')
        const issues = validateSectionAlignment('rewrite', outline, rewrite)
        if (issues.length > 0) {
          throw new Error(`改写结构不匹配: ${issues.join('; ')}`)
        }
        return rewrite
      } catch (retryError) {
        lastError =
          retryError instanceof Error ? retryError.message : String(retryError)
      }
    }
  }

  throw new Error(
    `[rewrite-editor] 连续 3 次输出非法 JSON: ${lastError ?? '未知错误'}`,
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
