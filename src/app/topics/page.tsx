import { prisma } from '@/lib/prisma'
import StatusBadge from '@/components/ui/status-badge'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function TopicsPage() {
  const query = () => prisma.topic.findMany({
    orderBy: [{ heatScore: 'desc' }, { createdAt: 'desc' }],
    include: { account: { select: { name: true } } },
    take: 100,
  })
  type TopicWithAccount = Awaited<ReturnType<typeof query>>[number]

  let topics: TopicWithAccount[] = []
  let error: string | null = null

  try {
    topics = await query()
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>共 {topics.length} 个话题</p>
      </div>

      <div className="table-container" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: '640px' }}>
          <thead>
            <tr>
              <th>标题</th>
              <th>账号</th>
              <th>热度</th>
              <th>状态</th>
              <th>创建时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {topics.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8" style={{ color: 'var(--color-fg-muted)' }}>
                  暂无话题。先在任务页面运行热点采集和话题筛选。
                </td>
              </tr>
            ) : (
              topics.map((topic) => (
                <tr key={topic.id}>
                  <td>
                    <div>
                      <p className="font-medium truncate max-w-xs" style={{ color: 'var(--color-fg)' }}>
                        {topic.title}
                      </p>
                      <p className="text-xs truncate max-w-xs mt-0.5" style={{ color: 'var(--color-fg-muted)' }}>
                        {topic.angle}
                      </p>
                    </div>
                  </td>
                  <td style={{ color: 'var(--color-fg-muted)' }}>{topic.account.name}</td>
                  <td style={{ color: 'var(--color-fg-muted)' }}>{topic.heatScore.toFixed(1)}</td>
                  <td><StatusBadge status={topic.status} /></td>
                  <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                    {formatDate(topic.createdAt)}
                  </td>
                  <td>
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
    return null
  }

  return (
    <div className="flex gap-2">
      <Link
        href={`/tasks?action=research&topicId=${topicId}`}
        className="text-sm font-medium transition-colors duration-300"
        style={{ color: 'var(--color-primary)' }}
      >
        研究
      </Link>
      <SkipTopicButton topicId={topicId} />
    </div>
  )
}

function SkipTopicButton({ topicId }: { topicId: string }) {
  return (
    <form action={`/api/topics/${topicId}`} method="PATCH">
      <button
        type="submit"
        className="text-sm font-medium transition-colors duration-300"
        style={{ color: 'var(--color-fg-muted)' }}
        formAction={`/api/topics/${topicId}`}
      >
        跳过
      </button>
    </form>
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
