import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runArticleResearchAgent } from '@/agents/trend'
import { loadModelConfig, getDefaultModelConfig } from '@/lib/config'
import { prisma } from '@/lib/prisma'

const RequestSchema = z.object({
  input: z.string().min(1, 'input is required'),
  inputType: z.enum(['url', 'text']),
  accountId: z.string().optional(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const { input, inputType, accountId } = parsed.data

  let modelConfig
  if (accountId) {
    const account = await prisma.account.findUnique({ where: { id: accountId } })
    if (!account) {
      return NextResponse.json({ error: `Account ${accountId} not found` }, { status: 404 })
    }
    try {
      modelConfig = loadModelConfig(account.modelConfig)
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid modelConfig on account: ${err instanceof Error ? err.message : String(err)}` },
        { status: 422 },
      )
    }
  } else {
    try {
      modelConfig = getDefaultModelConfig()
    } catch (err) {
      return NextResponse.json(
        { error: `No modelConfig available: ${err instanceof Error ? err.message : String(err)}` },
        { status: 422 },
      )
    }
  }

  try {
    const result = await runArticleResearchAgent({
      article: inputType === 'url' ? { url: input } : { text: input },
      modelConfig,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
