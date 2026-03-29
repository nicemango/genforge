import { z } from 'zod'
import type { AIProvider } from '@/lib/providers/types'
import { parseAgentOutput } from '@/lib/parse-agent-output'
import { SCORE_SYSTEM_PROMPT, sanitizeFeedback } from '../team/prompts'
import type { WriterFinal } from './humanize-editor'
import type { ScoreResult } from '../team/types'

const ScoreSchema = z.object({
  metrics: z.object({
    engagement: z.number().min(0).max(10),
    realism: z.number().min(0).max(10),
    emotion: z.number().min(0).max(10),
    value: z.number().min(0).max(10),
  }),
  issues: z.array(z.string()).max(8),
  optimizations: z.array(z.string()).max(8),
  passed: z.boolean().optional(),
})

interface ScoreJudgeParams {
  final: WriterFinal
  reviewFeedback?: string | null
}

function buildScorePrompt(final: WriterFinal, reviewFeedback?: string | null): string {
  return [
    sanitizeFeedback(reviewFeedback)
      ? `## 外部审核反馈（如与正文冲突，以修复反馈为优先）\n${sanitizeFeedback(reviewFeedback)}`
      : '',
    '',
    '## 评分对象',
    `标题：${final.title}`,
    '',
    final.content,
    '',
    '## 评分规则',
    'engagement：开头抓人、信息推进、是否有读下去的冲动。',
    'realism：是否具体、是否像人写的、是否避免模板腔。',
    'emotion：情绪张力、态度、节奏变化。',
    'value：洞察、信息增量、对读者是否有用。',
    '',
    '## 输出 JSON schema',
    JSON.stringify(
      {
        metrics: {
          engagement: 8.6,
          realism: 8.4,
          emotion: 8.2,
          value: 8.8,
        },
        issues: ['如果未过线，指出最关键问题'],
        optimizations: ['如果未过线，给出下一轮具体改法'],
        passed: true,
      },
      null,
      2,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

export async function runScoreJudge(
  provider: AIProvider,
  params: ScoreJudgeParams,
): Promise<ScoreResult> {
  const { final, reviewFeedback } = params
  const prompt = buildScorePrompt(final, reviewFeedback)

  const response = await provider.chat(
    [{ role: 'user', content: prompt }],
    { temperature: 0.1, maxTokens: 1200, systemPrompt: SCORE_SYSTEM_PROMPT },
  )

  const raw = extractRawText(response)
  const score = parseAgentOutput(raw, ScoreSchema, 'score-judge')

  const passed =
    score.passed ??
    Object.values(score.metrics).every((value) => value >= 8)

  return {
    metrics: score.metrics,
    issues: score.issues,
    optimizations: score.optimizations,
    passed,
  }
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
