const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-[var(--color-bg-secondary)] text-[var(--color-fg-muted)]',
  IN_PROGRESS: 'bg-[var(--color-info)]/10 text-[var(--color-info)]',
  DONE: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
  SKIPPED: 'bg-[var(--color-bg-tertiary)] text-[var(--color-fg-subtle)]',
  DRAFT: 'bg-[var(--color-bg-secondary)] text-[var(--color-fg-muted)]',
  REVIEWING: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
  READY: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
  PUBLISHED: 'bg-[var(--color-info)]/10 text-[var(--color-info)]',
  REJECTED: 'bg-[var(--color-error)]/10 text-[var(--color-error)]',
  RUNNING: 'bg-[var(--color-info)]/10 text-[var(--color-info)]',
  SUCCESS: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
  FAILED: 'bg-[var(--color-error)]/10 text-[var(--color-error)]',
  CANCELLED: 'bg-[var(--color-bg-tertiary)] text-[var(--color-fg-subtle)]',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  SKIPPED: '已跳过',
  DRAFT: '草稿',
  REVIEWING: '审核中',
  READY: '待发布',
  PUBLISHED: '已发布',
  REJECTED: '已拒绝',
  RUNNING: '运行中',
  SUCCESS: '成功',
  FAILED: '失败',
  CANCELLED: '已取消',
}

export default function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-[var(--color-bg-secondary)] text-[var(--color-fg-muted)]'
  const label = STATUS_LABELS[status] ?? status

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style}`}
    >
      {label}
    </span>
  )
}
