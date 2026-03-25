import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runFullPipeline } from '@/pipeline'

const RunPipelineSchema = z.object({
  accountId: z.string().min(1),
  topicCount: z.number().int().min(1).max(10).optional(),
})

export async function POST(request: Request) {
  const body = await request.json() as unknown
  const parsed = RunPipelineSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const result = await runFullPipeline(parsed.data)

  const statusCode = result.status === 'failed' ? 500 : 200
  return NextResponse.json(result, { status: statusCode })
}
