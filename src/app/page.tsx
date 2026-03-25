import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import PipelineFlow from '@/components/dashboard/pipeline-flow'
import RecentActivity from '@/components/dashboard/recent-activity'
import ArticleResearchPanel from '@/components/dashboard/article-research-panel'

export const dynamic = 'force-dynamic'

const contentQuery = () =>
  prisma.content.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { account: { select: { name: true } } },
  })

const taskQuery = () =>
  prisma.taskRun.findMany({
    take: 10,
    orderBy: { startedAt: 'desc' },
    include: { account: { select: { name: true } } },
  })

const runningTasksQuery = () =>
  prisma.taskRun.findMany({
    where: { status: 'RUNNING' },
    select: {
      taskType: true,
      startedAt: true,
      input: true,
      account: { select: { name: true } },
    },
  })

type RecentContent = Awaited<ReturnType<typeof contentQuery>>[number]
type RecentTask = Awaited<ReturnType<typeof taskQuery>>[number]

interface RunningDetail {
  taskType: string
  startedAt: string
  topicId?: string
  topicTitle?: string | null
}

async function getDashboardData() {
  try {
    const [
      topicCount,
      contentCount,
      taskCount,
      recentContents,
      recentTasks,
      runningTasks,
      accounts,
      pendingTopics,
    ] = await Promise.all([
      prisma.topic.count().catch(() => 0),
      prisma.content.count().catch(() => 0),
      prisma.taskRun.count().catch(() => 0),
      contentQuery().catch((): RecentContent[] => []),
      taskQuery().catch((): RecentTask[] => []),
      runningTasksQuery().catch(() => []),
      prisma.account
        .findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
        .catch(() => []),
      prisma.topic
        .findMany({
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
          select: { id: true, title: true, status: true },
          take: 20,
          orderBy: { createdAt: 'desc' },
        })
        .catch(() => []),
    ])

    const runningSteps = runningTasks.map((t) => t.taskType)

    // Extract topicIds from input JSON
    const topicIds: string[] = []
    for (const t of runningTasks) {
      try {
        const input = JSON.parse(t.input) as { topicId?: string }
        if (input.topicId) topicIds.push(input.topicId)
      } catch { /* ignore */ }
    }
    const topicMap: Record<string, string> =
      topicIds.length > 0
        ? Object.fromEntries(
            (
              await prisma.topic.findMany({
                where: { id: { in: topicIds } },
                select: { id: true, title: true },
              })
            ).map((t) => [t.id, t.title]),
          )
        : {}

    const initialRunningDetails = runningTasks.map((t) => {
      let topicId: string | undefined
      try {
        const input = JSON.parse(t.input) as { topicId?: string }
        topicId = input.topicId
      } catch { /* ignore */ }
      return {
        taskType: t.taskType,
        startedAt: t.startedAt.toISOString(),
        topicId,
        topicTitle: topicId ? (topicMap[topicId] ?? null) : undefined,
      }
    })

    return {
      topicCount,
      contentCount,
      taskCount,
      recentContents,
      recentTasks,
      runningSteps,
      initialRunningDetails,
      accounts,
      pendingTopics,
    }
  } catch {
    return {
      topicCount: 0,
      contentCount: 0,
      taskCount: 0,
      recentContents: [] as RecentContent[],
      recentTasks: [] as RecentTask[],
      runningSteps: [] as string[],
      initialRunningDetails: [] as RunningDetail[],
      accounts: [],
      pendingTopics: [],
    }
  }
}

export default async function DashboardPage() {
  const { topicCount, contentCount, taskCount, recentContents, recentTasks, runningSteps, initialRunningDetails, accounts, pendingTopics } =
    await getDashboardData()

  return (
    <div className="space-y-6">
      {/* Section 1: Pipeline Launch Area */}
      <div className="card">
        <PipelineFlow
          accounts={accounts}
          initialTopics={pendingTopics}
          runningSteps={runningSteps}
          initialRunningDetails={initialRunningDetails}
        />
      </div>

      {/* Section 2: Article Research */}
      <ArticleResearchPanel accounts={accounts} />

      {/* Section 3: Recent Activity */}
      <RecentActivity contents={recentContents} tasks={recentTasks} />

      {/* Section 4: Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="话题总数" value={topicCount} href="/topics" color="primary" />
        <StatCard label="内容总数" value={contentCount} href="/contents" color="success" />
        <StatCard label="任务总数" value={taskCount} href="/tasks" color="info" />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  href,
  color,
}: {
  label: string
  value: number
  href: string
  color: 'primary' | 'success' | 'info'
}) {
  const colors = {
    primary: { bg: 'var(--color-primary-alpha)', text: 'var(--color-primary)' },
    success: { bg: 'rgba(22, 163, 74, 0.1)', text: 'var(--color-success)' },
    info: { bg: 'rgba(37, 99, 235, 0.1)', text: 'var(--color-info)' },
  }

  return (
    <Link
      href={href}
      className="card flex flex-col"
      style={{ background: colors[color].bg, borderColor: 'transparent' }}
    >
      <p
        className="text-3xl font-bold"
        style={{ color: colors[color].text, letterSpacing: 'var(--tracking-tight)' }}
      >
        {value}
      </p>
      <p className="text-sm mt-1" style={{ color: 'var(--color-fg-muted)' }}>
        {label}
      </p>
    </Link>
  )
}
