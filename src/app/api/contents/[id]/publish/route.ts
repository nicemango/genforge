import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runStep } from '@/pipeline'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const content = await prisma.content.findUnique({
    where: { id },
    select: { accountId: true, topicId: true, status: true },
  })

  if (!content) {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }

  if (content.status !== 'READY') {
    return NextResponse.json(
      { error: `Content status is "${content.status}". Only READY content can be published.` },
      { status: 400 },
    )
  }

  if (!content.topicId) {
    return NextResponse.json({ error: 'Content has no associated topic.' }, { status: 400 })
  }

  const result = await runStep({
    accountId: content.accountId,
    topicId: content.topicId,
    step: 'PUBLISH',
  })

  if (result.status === 'failed') {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json(result.output)
}
