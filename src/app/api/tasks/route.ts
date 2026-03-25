import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const taskType = searchParams.get('taskType')
  const status = searchParams.get('status')
  const runningStepsOnly = searchParams.get('runningStepsOnly')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10)

  // Lightweight query for polling running steps (no includes, no total)
  if (runningStepsOnly === 'true') {
    const running = await prisma.taskRun.findMany({
      where: { status: 'RUNNING' },
      select: { taskType: true },
    })
    return NextResponse.json({ runningSteps: running.map((r) => r.taskType) })
  }

  // Rich running details for dashboard polling
  if (searchParams.get('runningDetails') === 'true') {
    const running = await prisma.taskRun.findMany({
      where: { status: 'RUNNING' },
      select: {
        taskType: true,
        startedAt: true,
        input: true,
        account: { select: { name: true } },
      },
    })
    // Extract topicId from input JSON
    const topicIds: string[] = []
    for (const r of running) {
      try {
        const input = JSON.parse(r.input) as { topicId?: string }
        if (input.topicId) topicIds.push(input.topicId)
      } catch { /* ignore */ }
    }
    const topics = topicIds.length > 0
      ? await prisma.topic.findMany({
          where: { id: { in: topicIds } },
          select: { id: true, title: true },
        })
      : []
    const topicMap = Object.fromEntries(topics.map((t) => [t.id, t.title]))

    const runningDetails = running.map((r) => {
      let topicId: string | undefined
      try {
        const input = JSON.parse(r.input) as { topicId?: string }
        topicId = input.topicId
      } catch { /* ignore */ }
      return {
        taskType: r.taskType,
        startedAt: r.startedAt.toISOString(),
        topicId,
        topicTitle: topicId ? (topicMap[topicId] ?? null) : undefined,
        accountName: r.account.name,
      }
    })

    return NextResponse.json({
      runningSteps: running.map((r) => r.taskType),
      runningDetails,
    })
  }

  const where: Record<string, unknown> = {}
  if (accountId) where.accountId = accountId
  if (taskType) where.taskType = taskType
  if (status) where.status = status

  const [taskRuns, total] = await Promise.all([
    prisma.taskRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { account: { select: { id: true, name: true } } },
    }),
    prisma.taskRun.count({ where }),
  ])

  return NextResponse.json({ taskRuns, total, page, pageSize })
}
