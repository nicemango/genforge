import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const UpdateContentSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  summary: z.string().optional(),
  status: z.enum(['DRAFT', 'REVIEWING', 'READY', 'PUBLISHED', 'REJECTED']).optional(),
  reviewNotes: z.string().optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const content = await prisma.content.findUnique({
    where: { id },
    include: {
      topic: true,
      account: { select: { id: true, name: true } },
    },
  })

  if (!content) {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }

  return NextResponse.json(content)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json() as unknown
  const parsed = UpdateContentSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const updateData = { ...parsed.data } as Record<string, unknown>

  if (parsed.data.body !== undefined) {
    const wordCount = countWords(parsed.data.body)
    updateData.wordCount = wordCount
  }

  try {
    const content = await prisma.content.update({ where: { id }, data: updateData })
    return NextResponse.json(content)
  } catch {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    await prisma.content.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }
}

function countWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const englishWords = text.match(/[a-zA-Z]+/g)?.length ?? 0
  return chineseChars + englishWords
}
