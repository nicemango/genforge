// Status style definitions with dot indicators
const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; pulse?: boolean }> = {
  PENDING: { bg: 'bg-[var(--color-bg-secondary)]', text: 'text-[var(--color-fg-muted)]', dot: 'bg-[var(--color-fg-subtle)]' },
  IN_PROGRESS: { bg: 'bg-[var(--color-info)]/10', text: 'text-[var(--color-info)]', dot: 'bg-[var(--color-info)]', pulse: true },
  DONE: { bg: 'bg-[var(--color-success)]/10', text: 'text-[var(--color-success)]', dot: 'bg-[var(--color-success)]' },
  SKIPPED: { bg: 'bg-[var(--color-bg-tertiary)]', text: 'text-[var(--color-fg-subtle)]', dot: 'bg-[var(--color-fg-subtle)]' },
  DRAFT: { bg: 'bg-[var(--color-bg-secondary)]', text: 'text-[var(--color-fg-muted)]', dot: 'bg-[var(--color-fg-subtle)]' },
  REVIEWING: { bg: 'bg-[var(--color-warning)]/10', text: 'text-[var(--color-warning)]', dot: 'bg-[var(--color-warning)]', pulse: true },
  READY: { bg: 'bg-[var(--color-success)]/10', text: 'text-[var(--color-success)]', dot: 'bg-[var(--color-success)]' },
  PUBLISHED: { bg: 'bg-[var(--color-info)]/10', text: 'text-[var(--color-info)]', dot: 'bg-[var(--color-info)]' },
  REJECTED: { bg: 'bg-[var(--color-error)]/10', text: 'text-[var(--color-error)]', dot: 'bg-[var(--color-error)]' },
  RUNNING: { bg: 'bg-[var(--color-info)]/10', text: 'text-[var(--color-info)]', dot: 'bg-[var(--color-info)]', pulse: true },
  SUCCESS: { bg: 'bg-[var(--color-success)]/10', text: 'text-[var(--color-success)]', dot: 'bg-[var(--color-success)]' },
  FAILED: { bg: 'bg-[var(--color-error)]/10', text: 'text-[var(--color-error)]', dot: 'bg-[var(--color-error)]' },
  CANCELLED: { bg: 'bg-[var(--color-bg-tertiary)]', text: 'text-[var(--color-fg-subtle)]', dot: 'bg-[var(--color-fg-subtle)]' },
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

export default function StatusBadge({ status, showDot = true }: { status: string; showDot?: boolean }) {
  const config = STATUS_CONFIG[status] ?? {
    bg: 'bg-[var(--color-bg-secondary)]',
    text: 'text-[var(--color-fg-muted)]',
    dot: 'bg-[var(--color-fg-subtle)]'
  }
  const label = STATUS_LABELS[status] ?? status

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}
    >
      {showDot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? 'animate-pulse' : ''}`}
        />
      )}
      {label}
    </span>
  )
}
