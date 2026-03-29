import { prisma } from '@/lib/prisma'
import StatusBadge from '@/components/ui/status-badge'
import Link from 'next/link'
import SkipTopicButton from '@/components/topics/skip-topic-button'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED'] as const
type TopicStatus = typeof VALID_STATUSES[number]

const STATUS_LABELS: Record<TopicStatus, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  SKIPPED: '已跳过',
}

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: rawStatus } = await searchParams
  const activeStatus = VALID_STATUSES.includes(rawStatus as TopicStatus) ? (rawStatus as TopicStatus) : null

  const query = () =>
    prisma.topic.findMany({
      where: activeStatus ? { status: activeStatus } : undefined,
      orderBy: [{ heatScore: 'desc' }, { createdAt: 'desc' }],
      include: { account: { select: { name: true } } },
      take: 100,
    })
  type TopicWithAccount = Awaited<ReturnType<typeof query>>[number]

  // Count per status for tab badges
  const countQuery = () =>
    prisma.topic.groupBy({ by: ['status'], _count: { _all: true } })

  let topics: TopicWithAccount[] = []
  let statusCounts: Record<string, number> = {}
  let error: string | null = null

  try {
    const [topicRows, countRows] = await Promise.all([query(), countQuery()])
    topics = topicRows
    statusCounts = Object.fromEntries(countRows.map((r) => [r.status, r._count._all]))
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-sm" style={{ color: 'var(--color-danger, #ef4444)' }}>加载话题失败: {error}</p>
      </div>
    )
  }

  const totalCount = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-primary-alpha)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
              <path d="M4 11a9 9 0 0 1 9 9"/>
              <path d="M4 4a16 16 0 0 1 16 16"/>
              <circle cx="5" cy="19" r="1" fill="var(--color-primary)" stroke="none"/>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>话题管理</h1>
            <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>
              {activeStatus ? `${STATUS_LABELS[activeStatus]} ${topics.length} 个` : `共 ${totalCount} 个话题`}
            </p>
          </div>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--color-bg-secondary)' }}>
        <Link
          href="/topics"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200"
          style={
            !activeStatus
              ? { background: 'var(--color-card)', color: 'var(--color-primary)', boxShadow: 'var(--shadow-xs)' }
              : { color: 'var(--color-fg-muted)' }
          }
        >
          全部
          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: !activeStatus ? 'var(--color-primary-alpha)' : 'var(--color-bg-tertiary)', color: !activeStatus ? 'var(--color-primary)' : 'var(--color-fg-subtle)' }}>
            {totalCount}
          </span>
        </Link>
        {VALID_STATUSES.map((s) => {
          const isActive = activeStatus === s
          const count = statusCounts[s] ?? 0
          return (
            <Link
              key={s}
              href={`/topics?status=${s}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200"
              style={
                isActive
                  ? { background: 'var(--color-card)', color: 'var(--color-primary)', boxShadow: 'var(--shadow-xs)' }
                  : { color: 'var(--color-fg-muted)' }
              }
            >
              {STATUS_LABELS[s]}
              {count > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: isActive ? 'var(--color-primary-alpha)' : 'var(--color-bg-tertiary)', color: isActive ? 'var(--color-primary)' : 'var(--color-fg-subtle)' }}>
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div className="table-container card-hover" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: '640px' }}>
          <thead>
            <tr>
              <th>标题</th>
              <th>账号</th>
              <th>热度</th>
              <th>状态</th>
              <th>创建时间</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {topics.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M4 11a9 9 0 0 1 9 9"/>
                        <path d="M4 4a16 16 0 0 1 16 16"/>
                        <circle cx="5" cy="19" r="1"/>
                      </svg>
                    </div>
                    <p>{activeStatus ? `暂无${STATUS_LABELS[activeStatus]}话题` : '暂无话题'}</p>
                    {!activeStatus && <p className="text-sm mt-1">先在任务页面运行热点采集和话题筛选</p>}
                  </div>
                </td>
              </tr>
            ) : (
              topics.map((topic) => (
                <tr key={topic.id} className="table-row-hover">
                  <td>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: 'var(--color-primary-alpha)' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
                          <path d="M4 11a9 9 0 0 1 9 9"/>
                          <path d="M4 4a16 16 0 0 1 16 16"/>
                          <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/>
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-xs" style={{ color: 'var(--color-fg)' }}>
                          {topic.title}
                        </p>
                        {topic.angle && (
                          <p className="text-xs truncate max-w-xs mt-0.5" style={{ color: 'var(--color-fg-muted)' }}>
                            {topic.angle}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-fg-muted)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                      {topic.account.name}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-tertiary)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min((topic.heatScore / 10) * 100, 100)}%`,
                            background: topic.heatScore >= 8 ? 'var(--color-success)' : topic.heatScore >= 5 ? 'var(--color-warning)' : 'var(--color-fg-subtle)'
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8" style={{ color: 'var(--color-fg)' }}>
                        {topic.heatScore.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  <td><StatusBadge status={topic.status} /></td>
                  <td>
                    <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--color-fg-muted)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      {formatDate(topic.createdAt)}
                    </span>
                  </td>
                  <td className="text-right">
                    <TopicActions topicId={topic.id} status={topic.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TopicActions({ topicId, status }: { topicId: string; status: string }) {
  if (status === 'SKIPPED' || status === 'DONE') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--color-fg-subtle)', background: 'var(--color-bg-secondary)' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        {status === 'DONE' ? '已完成' : '已跳过'}
      </span>
    )
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        href={`/tasks?action=research&topicId=${topicId}`}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 hover:opacity-80"
        style={{ color: '#fff', background: 'var(--color-primary)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        研究
      </Link>
      <SkipTopicButton topicId={topicId} />
    </div>
  )
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}
