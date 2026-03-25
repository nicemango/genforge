import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { nextRunDate } from '@/lib/scheduler'

const UpdateScheduleSchema = z.object({
  name: z.string().optional(),
  cronExpr: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json() as unknown
  const parsed = UpdateScheduleSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name
  if (parsed.data.isEnabled !== undefined) updateData.isEnabled = parsed.data.isEnabled
  if (parsed.data.config !== undefined) updateData.config = JSON.stringify(parsed.data.config)

  if (parsed.data.cronExpr !== undefined) {
    try {
      updateData.cronExpr = parsed.data.cronExpr
      updateData.nextRunAt = nextRunDate(parsed.data.cronExpr)
    } catch {
      return NextResponse.json({ error: `Invalid cron expression: ${parsed.data.cronExpr}` }, { status: 400 })
    }
  }

  try {
    const schedule = await prisma.scheduledTask.update({ where: { id }, data: updateData })
    return NextResponse.json(schedule)
  } catch {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    await prisma.scheduledTask.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }
}
