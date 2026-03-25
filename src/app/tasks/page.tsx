import { prisma } from '@/lib/prisma'
import TasksClient from '@/components/tasks/tasks-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '流水线控制台 - Content Center',
}

export default async function TasksPage() {
  try {
    const [taskRuns, accounts, schedules] = await Promise.all([
      prisma.taskRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 50,
        include: { account: { select: { id: true, name: true } } },
      }),
      prisma.account.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      prisma.scheduledTask.findMany({ orderBy: { createdAt: 'desc' } }),
    ])

    return <TasksClient taskRuns={taskRuns} accounts={accounts} schedules={schedules} />
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return (
      <div className="card text-center py-8">
        <p className="text-sm" style={{ color: 'var(--color-danger, #ef4444)' }}>加载任务失败: {error}</p>
      </div>
    )
  }
}
