import { prisma } from '@/lib/prisma'
import Link from 'next/link'
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
      account: { select: { name: true } },
    },
  })

const qualityQuery = () =>
  prisma.qualityRecord.findMany({
    take: 200,
    orderBy: { createdAt: 'desc' },
    select: {
      accountId: true,
      score: true,
      passed: true,
      writeAttempts: true,
      account: { select: { name: true } },
    },
  })

type RecentContent = Awaited<ReturnType<typeof contentQuery>>[number]
type RecentTask = Awaited<ReturnType<typeof taskQuery>>[number]
type QualityRow = Awaited<ReturnType<typeof qualityQuery>>[number]

async function getDashboardData() {
  try {
    const [topicCount, contentCount, taskCount, recentContents, recentTasks, runningTasks, accounts, qualityRows] =
      await Promise.all([
        prisma.topic.count().catch(() => 0),
        prisma.content.count().catch(() => 0),
        prisma.taskRun.count().catch(() => 0),
        contentQuery().catch((): RecentContent[] => []),
        taskQuery().catch((): RecentTask[] => []),
        runningTasksQuery().catch(() => []),
        prisma.account
          .findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
          .catch(() => []),
        qualityQuery().catch((): QualityRow[] => []),
      ])

    return { topicCount, contentCount, taskCount, recentContents, recentTasks, runningTasks, accounts, qualityRows }
  } catch {
    return {
      topicCount: 0,
      contentCount: 0,
      taskCount: 0,
      recentContents: [] as RecentContent[],
      recentTasks: [] as RecentTask[],
      runningTasks: [],
      accounts: [],
      qualityRows: [] as QualityRow[],
    }
  }
}

export default async function DashboardPage() {
  const { topicCount, contentCount, taskCount, recentContents, recentTasks, runningTasks, accounts, qualityRows } =
    await getDashboardData()

  return (
    <div className="space-y-6">
      {/* Section 1: Stats Overview */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-fade-in">
        <StatCard label="话题总数" value={topicCount} href="/topics" color="primary" icon="topic" />
        <StatCard label="内容总数" value={contentCount} href="/contents" color="success" icon="content" />
        <StatCard label="任务总数" value={taskCount} href="/tasks" color="info" icon="task" />
      </section>

      {/* Section 2: Quality Monitor */}
      {qualityRows.length > 0 && (
        <section className="animate-fade-in" style={{ animationDelay: '50ms' }}>
          <QualityMonitorCard rows={qualityRows} />
        </section>
      )}

      {/* Section 3: Recent Activity */}
      <section className="animate-fade-in" style={{ animationDelay: '100ms' }}>
        <RecentActivity contents={recentContents} tasks={recentTasks} />
      </section>

      {/* Section 4: Pipeline Status */}
      <section className="animate-fade-in" style={{ animationDelay: '150ms' }}>
        <PipelineStatusCard runningTasks={runningTasks} accountCount={accounts.length} />
      </section>

      {/* Section 5: Article Research */}
      <section className="animate-fade-in" style={{ animationDelay: '200ms' }}>
        <ArticleResearchPanel accounts={accounts} />
      </section>
    </div>
  )
}

// ─── Quality Monitor Card ─────────────────────────────────────────────────────

interface QualityStats {
  accountName: string
  total: number
  avgScore: number
  passRate: number
  avgRetries: number
}

function QualityMonitorCard({
  rows,
}: {
  rows: { accountId: string; score: number; passed: boolean; writeAttempts: number; account: { name: string } }[]
}) {
  // Aggregate per account
  const byAccount = new Map<string, { name: string; scores: number[]; passed: number; retries: number[] }>()
  for (const r of rows) {
    if (!byAccount.has(r.accountId)) {
      byAccount.set(r.accountId, { name: r.account.name, scores: [], passed: 0, retries: [] })
    }
    const entry = byAccount.get(r.accountId)!
    entry.scores.push(r.score)
    if (r.passed) entry.passed++
    entry.retries.push(r.writeAttempts)
  }

  const stats: QualityStats[] = Array.from(byAccount.entries()).map(([, v]) => ({
    accountName: v.name,
    total: v.scores.length,
    avgScore: v.scores.reduce((a, b) => a + b, 0) / v.scores.length,
    passRate: v.passed / v.scores.length,
    avgRetries: v.retries.reduce((a, b) => a + b, 0) / v.retries.length,
  }))

  function scoreColor(avg: number): string {
    if (avg >= 7.5) return 'var(--color-success)'
    if (avg >= 6.5) return 'var(--color-warning)'
    return 'var(--color-danger, #ef4444)'
  }

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--color-primary-alpha)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </div>
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>写作质量监控</h2>
          <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>近 {rows.length} 条记录</p>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: '480px' }}>
          <thead>
            <tr>
              <th>账号</th>
              <th>平均分</th>
              <th>通过率</th>
              <th>平均重写次数</th>
              <th>样本数</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.accountName}>
                <td className="font-medium" style={{ color: 'var(--color-fg)' }}>{s.accountName}</td>
                <td>
                  <span className="font-semibold" style={{ color: scoreColor(s.avgScore) }}>
                    {s.avgScore.toFixed(1)}
                  </span>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-tertiary)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${s.passRate * 100}%`,
                          background: s.passRate >= 0.8 ? 'var(--color-success)' : s.passRate >= 0.6 ? 'var(--color-warning)' : 'var(--color-danger, #ef4444)',
                        }}
                      />
                    </div>
                    <span className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>{(s.passRate * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td style={{ color: s.avgRetries > 1.5 ? 'var(--color-warning)' : 'var(--color-fg-muted)' }}>
                  {s.avgRetries.toFixed(1)}
                </td>
                <td style={{ color: 'var(--color-fg-subtle)' }}>{s.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Pipeline Status Card ─────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  FETCH_TRENDS: '热点采集',
  SELECT_TOPICS: '话题筛选',
  RESEARCH: '内容研究',
  WRITE: '文章撰写',
  GENERATE_IMAGES: '图片生成',
  REVIEW: '内容审核',
  PUBLISH: '发布推送',
  FULL_PIPELINE: '完整流水线',
}

function PipelineStatusCard({
  runningTasks,
  accountCount,
}: {
  runningTasks: { taskType: string; startedAt: Date; account: { name: string } }[]
  accountCount: number
}) {
  const isRunning = runningTasks.length > 0

  return (
    <div className="card card-hover">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: isRunning ? 'var(--color-primary-alpha)' : 'var(--color-bg-secondary)' }}
          >
            {isRunning ? (
              <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>
                内容生产流水线
              </h2>
              {isRunning && (
                <span
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: 'var(--color-primary-alpha)', color: 'var(--color-primary)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {runningTasks.length} 个任务运行中
                </span>
              )}
            </div>
            {isRunning ? (
              <div className="flex flex-wrap gap-2 mt-1">
                {runningTasks.map((t, i) => (
                  <span key={i} className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                    {STEP_LABELS[t.taskType] ?? t.taskType}
                    <span style={{ color: 'var(--color-border)' }}> · </span>
                    {t.account.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-fg-muted)' }}>
                {accountCount === 0 ? '请先在「账号」页面完成配置' : '前往任务控制台手动或定时运行'}
              </p>
            )}
          </div>
        </div>

        <Link
          href="/tasks"
          className="btn btn-primary shrink-0"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {isRunning ? '查看进度' : '前往控制台'}
        </Link>
      </div>
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  href,
  color,
  icon,
}: {
  label: string
  value: number
  href: string
  color: 'primary' | 'success' | 'info'
  icon: 'topic' | 'content' | 'task'
}) {
  const colors = {
    primary: { bg: 'var(--color-primary-alpha)', text: 'var(--color-primary)' },
    success: { bg: 'rgba(22, 163, 74, 0.1)', text: 'var(--color-success)' },
    info: { bg: 'rgba(37, 99, 235, 0.1)', text: 'var(--color-info)' },
  }

  const icons = {
    topic: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 11a9 9 0 0 1 9 9"/>
        <path d="M4 4a16 16 0 0 1 16 16"/>
        <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/>
      </svg>
    ),
    content: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <line x1="10" y1="9" x2="8" y2="9"/>
      </svg>
    ),
    task: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  }

  return (
    <Link
      href={href}
      className="card card-hover group relative overflow-hidden"
      style={{ background: colors[color].bg, borderColor: 'transparent' }}
    >
      <div className="absolute top-0 right-0 w-24 h-24 opacity-10 transition-transform duration-500 group-hover:scale-110"
        style={{ color: colors[color].text }}
      >
        {icons[icon]}
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-1" style={{ color: colors[color].text }}>
          {icons[icon]}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <p className="text-3xl font-bold" style={{ color: colors[color].text, letterSpacing: 'var(--tracking-tight)' }}>
          {value.toLocaleString()}
        </p>
      </div>
    </Link>
  )
}
