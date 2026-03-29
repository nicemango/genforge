import { z } from 'zod'
import type { AIProvider } from '@/lib/providers/types'
import type { TopicSuggestion } from '@/agents/topic'
import type { ResearchResult } from '@/agents/research'
import { parseAgentOutput } from '@/lib/parse-agent-output'
import {
  OUTLINE_SYSTEM_PROMPT,
  buildStyleInstructions,
  buildFeedbackContext,
} from '../team/prompts'
import type { WriterContext } from '../team/types'
import { getTemperature } from '../team/context'

const TitleCandidateSchema = z.object({
  title: z.string().min(8),
  score: z.number().min(1).max(10),
  reason: z.string().min(10),
})

const OutlineSchema = z.object({
  titles: z.array(TitleCandidateSchema).length(3),
  hook: z.string().min(30),
  sections: z
    .array(
      z.object({
        title: z.string().min(6),
        corePoint: z.string().min(10),
      }),
    )
    .min(3)
    .max(5),
  ending: z.string().min(20),
})

export interface TitleCandidate {
  title: string
  score: number
  reason: string
}

export interface WriterOutline {
  titles: TitleCandidate[]
  hook: string
  sections: Array<{ title: string; corePoint: string }>
  ending: string
}

interface OutlineEditorParams {
  context: WriterContext
}

function buildOutlinePrompt(
  topic: TopicSuggestion,
  research: ResearchResult,
  context: WriterContext,
): string {
  const hookMode = context.writingStyle?.preferredHookMode

  return [
    buildFeedbackContext(context.reviewFeedback, context.optimizationFeedback),
    '## 话题',
    `标题方向：${topic.title}`,
    `写作角度：${topic.angle}`,
    `核心摘要：${topic.summary}`,
    '',
    '## 风格要求',
    buildStyleInstructions(context.writingStyle),
    '',
    hookMode && hookMode !== 'auto'
      ? `## 账号偏好\nHook 必须使用模式 ${hookMode}`
      : '## Hook 要求\n在 A 反常识 / B 具体场景 / C 辛辣设问 中选最适合的一个',
    '',
    '## 研究资料',
    research.rawOutput,
    '',
    '## 输出 JSON schema',
    JSON.stringify(
      {
        titles: [
          { title: '标题候选1（最高分）', score: 9, reason: '...' },
          { title: '标题候选2', score: 8, reason: '...' },
          { title: '标题候选3', score: 7, reason: '...' },
        ],
        hook: '开篇 hook 的策略说明，80-160字',
        sections: [
          { title: '观点句章节标题1', corePoint: '章节核心观点1' },
          { title: '观点句章节标题2', corePoint: '章节核心观点2' },
          { title: '观点句章节标题3', corePoint: '章节核心观点3' },
        ],
        ending: '结尾策略，包含核心判断、行动建议、留白问题',
      },
      null,
      2,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

function validateOutline(outline: WriterOutline): string[] {
  const issues: string[] = []
  const descriptiveTitle =
    /^(市场|技术|行业|产品|用户|政策|竞争)(现状|概况|背景|概述|介绍|分析|探讨|研究|趋势|格局|发展|挑战|影响)$/
  // 认知落差标记：数字（含中文数字）、对比结构、否定结构、疑问句、反常识判断词
  const cognitiveGapPattern =
    /[0-9０１２３４５６７８９零一二三四五六七八九百千万亿兆]+|最|反|却|竟|仅|只有|不足|超过|高达|低至|失败|倒下|打穿|颠覆|崩塌|黑化|主动|失控|欺骗|为何|为什么|正在|从.+到.+|比.+更|越.+越|不是.+而是|当.+时|当.+[：:]|？|被|每|都|居然|竟然|猛地|骤然|忽然|陡然|怦然|悄然|恍然|贸然|悍然|毅然|本该|理应|应该|本来|原来|实际上|其实|你以为|难道/

  if (outline.titles.length !== 3) {
    issues.push(`标题候选数量错误：${outline.titles.length}（必须为 3）`)
  }

  outline.titles.forEach((candidate, index) => {
    if (!cognitiveGapPattern.test(candidate.title)) {
      issues.push(`标题候选 ${index + 1} 缺少认知落差：${candidate.title}`)
    }
  })

  const scores = outline.titles.map((t) => t.score)
  const maxScore = Math.max(...scores)
  const minScore = Math.min(...scores)
  if (maxScore - minScore < 1) {
    issues.push(`三个标题候选评分差距不足（最高${maxScore}，最低${minScore}），需拉大质量差异`)
  }

  if (outline.sections.length < 3 || outline.sections.length > 5) {
    issues.push(`章节数量错误：${outline.sections.length}（必须为 3-5）`)
  }

  for (const section of outline.sections) {
    if (descriptiveTitle.test(section.title.trim())) {
      issues.push(`章节标题过于描述性：${section.title}`)
    }
  }

  return issues
}

export async function runOutlineEditor(
  provider: AIProvider,
  params: OutlineEditorParams,
): Promise<WriterOutline> {
  const { context } = params
  const { topic, research } = context

  const prompt = buildOutlinePrompt(topic, research, context)
  const temperature = getTemperature(0.2, context.attempt, 'outline')

  let lastError: string | null = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await provider.chat(
      [{ role: 'user', content: prompt }],
      { temperature, maxTokens: 1800, systemPrompt: OUTLINE_SYSTEM_PROMPT },
    )

    const raw = extractRawText(response)

    try {
      const outline = parseAgentOutput(raw, OutlineSchema, 'outline-editor')

      const issues = validateOutline(outline)
      if (issues.length > 0) {
        throw new Error(`大纲质量不达标: ${issues.join('; ')}`)
      }

      return outline
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : String(error)
      if (attempt === 3) break

      // Retry with error context
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
        { temperature, maxTokens: 1800, systemPrompt: OUTLINE_SYSTEM_PROMPT },
      )

      const retryRaw = extractRawText(retryResponse)
      try {
        const outline = parseAgentOutput(retryRaw, OutlineSchema, 'outline-editor')
        const issues = validateOutline(outline)
        if (issues.length > 0) {
          throw new Error(`大纲质量不达标: ${issues.join('; ')}`)
        }
        return outline
      } catch (retryError) {
        lastError =
          retryError instanceof Error ? retryError.message : String(retryError)
      }
    }
  }

  throw new Error(
    `[outline-editor] 连续 3 次输出非法 JSON: ${lastError ?? '未知错误'}`,
  )
}

function extractRawText(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
}
