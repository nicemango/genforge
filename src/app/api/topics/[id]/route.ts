import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const UpdateTopicSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED']).optional(),
  title: z.string().optional(),
  angle: z.string().optional(),
  summary: z.string().optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const topic = await prisma.topic.findUnique({ where: { id }, include: { contents: true } })

  if (!topic) {
    return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  }

  return NextResponse.json(topic)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json() as unknown
  const parsed = UpdateTopicSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  try {
    const topic = await prisma.topic.update({ where: { id }, data: parsed.data })
    return NextResponse.json(topic)
  } catch {
    return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    await prisma.topic.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  }
}
