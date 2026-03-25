import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { matchesCron, nextRunDate } from '@/lib/scheduler'
import { runStep } from '@/pipeline'
import type { TaskType } from '@prisma/client'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expectedToken = process.env.CRON_SECRET

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  const schedules = await prisma.scheduledTask.findMany({
    where: {
      isEnabled: true,
      nextRunAt: { lte: now },
    },
  })

  const results: Array<{ scheduleId: string; taskRunId: string; status: string }> = []

  for (const schedule of schedules) {
    if (!matchesCron(schedule.cronExpr, now)) {
      continue
    }

    const config = JSON.parse(schedule.config) as Record<string, unknown>

    const result = await runStep({
      accountId: schedule.accountId,
      step: schedule.taskType as TaskType,
      topicId: config.topicId as string | undefined,
      topicCount: config.topicCount as number | undefined,
    })

    let nextRun: Date
    try {
      nextRun = nextRunDate(schedule.cronExpr, now)
    } catch {
      nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    }

    await prisma.scheduledTask.update({
      where: { id: schedule.id },
      data: { lastRunAt: now, nextRunAt: nextRun },
    })

    results.push({ scheduleId: schedule.id, taskRunId: result.taskRunId, status: result.status })
  }

  return NextResponse.json({ triggered: results.length, results })
}
