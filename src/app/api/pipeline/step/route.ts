import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runStep } from '@/pipeline'

const RunStepSchema = z.object({
  accountId: z.string().min(1),
  step: z.enum(['TREND_CRAWL', 'TOPIC_SELECT', 'RESEARCH', 'WRITE', 'GENERATE_IMAGES', 'REVIEW', 'PUBLISH']),
  topicId: z.string().optional(),
  topicCount: z.number().int().min(1).max(10).optional(),
})

export async function POST(request: Request) {
  const body = await request.json() as unknown
  const parsed = RunStepSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const result = await runStep(parsed.data)

  const statusCode = result.status === 'failed' ? 500 : 200
  return NextResponse.json(result, { status: statusCode })
}
