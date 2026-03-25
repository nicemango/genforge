import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { nextRunDate } from '@/lib/scheduler'

const CreateScheduleSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1),
  taskType: z.enum(['TREND_CRAWL', 'TOPIC_SELECT', 'RESEARCH', 'WRITE', 'REVIEW', 'PUBLISH', 'FULL_PIPELINE']),
  cronExpr: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
})

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')

  const where: Record<string, unknown> = {}
  if (accountId) where.accountId = accountId

  const schedules = await prisma.scheduledTask.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(schedules)
}

export async function POST(request: Request) {
  const body = await request.json() as unknown
  const parsed = CreateScheduleSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const { accountId, name, taskType, cronExpr, config = {}, isEnabled = true } = parsed.data

  let nextRunAt: Date
  try {
    nextRunAt = nextRunDate(cronExpr)
  } catch {
    return NextResponse.json({ error: `Invalid cron expression: ${cronExpr}` }, { status: 400 })
  }

  const schedule = await prisma.scheduledTask.create({
    data: {
      accountId,
      name,
      taskType,
      cronExpr,
      config: JSON.stringify(config),
      isEnabled,
      nextRunAt,
    },
  })

  return NextResponse.json(schedule, { status: 201 })
}
