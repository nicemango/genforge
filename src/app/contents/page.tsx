import { prisma } from '@/lib/prisma'
import StatusBadge from '@/components/ui/status-badge'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ContentsPage() {
  const query = () => prisma.content.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      account: { select: { name: true } },
      topic: { select: { title: true } },
    },
    take: 100,
  })
  type ContentWithRelations = Awaited<ReturnType<typeof query>>[number]

  let contents: ContentWithRelations[] = []
  let error: string | null = null

  try {
    contents = await query()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-sm" style={{ color: 'var(--color-danger, #ef4444)' }}>加载内容失败: {error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>共 {contents.length} 篇内容</p>
      </div>

      <div className="table-container" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: '640px' }}>
          <thead>
            <tr>
              <th>标题</th>
              <th>账号</th>
              <th>字数</th>
              <th>状态</th>
              <th>创建时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contents.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8" style={{ color: 'var(--color-fg-muted)' }}>
                  暂无内容。先运行完整 Pipeline 生成文章。
                </td>
              </tr>
            ) : (
              contents.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div>
                      <p className="font-medium truncate max-w-xs" style={{ color: 'var(--color-fg)' }}>
                        {c.title || '(无标题)'}
                      </p>
                      {c.topic && (
                        <p className="text-xs truncate max-w-xs mt-0.5" style={{ color: 'var(--color-fg-muted)' }}>
                          话题: {c.topic.title}
                        </p>
                      )}
                    </div>
                  </td>
                  <td style={{ color: 'var(--color-fg-muted)' }}>{c.account.name}</td>
                  <td style={{ color: 'var(--color-fg-muted)' }}>{c.wordCount}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                    {formatDate(c.createdAt)}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <Link
                        href={`/contents/${c.id}`}
                        className="text-sm font-medium transition-colors duration-300"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        编辑
                      </Link>
                    </div>
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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}
