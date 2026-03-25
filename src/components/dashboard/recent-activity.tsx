'use client'

import { useState } from 'react'
import Link from 'next/link'
import StatusBadge from '@/components/ui/status-badge'
import { STEP_MAP } from '@/lib/pipeline-steps'

interface RecentContent {
  id: string
  title: string | null
  summary: string | null
  status: string
  wordCount: number
  createdAt: Date
  account: { name: string }
}

interface RecentTask {
  id: string
  taskType: string
  status: string
  durationMs: number | null
  startedAt: Date
  error: string | null
  account: { name: string }
}

interface RecentActivityProps {
  contents: RecentContent[]
  tasks: RecentTask[]
}

export default function RecentActivity({ contents, tasks }: RecentActivityProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'contents' | 'tasks'>('all')
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set())

  // Merge and sort by date
  type ActivityItem =
    | { kind: 'content'; data: RecentContent; date: Date }
    | { kind: 'task'; data: RecentTask; date: Date }

  const activities: ActivityItem[] = [
    ...contents.map((c) => ({ kind: 'content' as const, data: c, date: new Date(c.createdAt) })),
    ...tasks.map((t) => ({ kind: 'task' as const, data: t, date: new Date(t.startedAt) })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime())

  const filtered =
    activeTab === 'contents'
      ? activities.filter((a) => a.kind === 'content')
      : activeTab === 'tasks'
        ? activities.filter((a) => a.kind === 'task')
        : activities

  function toggleError(id: string) {
    setExpandedErrors((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>
          最近动态
        </h2>
        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
          {(['all', 'contents', 'tasks'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all duration-200"
              style={
                activeTab === tab
                  ? { background: 'var(--color-card)', color: 'var(--color-primary)', boxShadow: 'var(--shadow-xs)' }
                  : { color: 'var(--color-fg-muted)' }
              }
            >
              {tab === 'all' ? '全部' : tab === 'contents' ? '内容' : '任务'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>
            暂无动态，运行任务后即可看到进度
          </p>
          <Link href="/tasks" className="mt-3 inline-block text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            前往任务页面 →
          </Link>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filtered.slice(0, 20).map((item) =>
            item.kind === 'content' ? (
              <ActivityContentItem
                key={`content-${item.data.id}`}
                content={item.data}
                date={item.date}
              />
            ) : (
              <ActivityTaskItem
                key={`task-${item.data.id}`}
                task={item.data}
                date={item.date}
                expanded={expandedErrors.has(item.data.id)}
                onToggle={() => toggleError(item.data.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}

function ActivityContentItem({ content, date }: { content: RecentContent; date: Date }) {
  return (
    <Link
      href={`/contents/${content.id}`}
      className="flex items-start gap-3 p-3 rounded-lg transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid transparent',
      }}
    >
      <div
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
        style={{ background: 'var(--color-primary-alpha)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-fg)' }}>
            {content.title || '(无标题)'}
          </p>
          <StatusBadge status={content.status} />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
            {content.account.name}
          </span>
          <span style={{ color: 'var(--color-border)' }}>·</span>
          <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
            {content.wordCount} 字
          </span>
          <span style={{ color: 'var(--color-border)' }}>·</span>
          <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
            {formatRelativeTime(date)}
          </span>
        </div>
        {content.summary && (
          <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-fg-muted)' }}>
            {content.summary}
          </p>
        )}
      </div>
    </Link>
  )
}

function ActivityTaskItem({
  task,
  date,
  expanded,
  onToggle,
}: {
  task: RecentTask
  date: Date
  expanded: boolean
  onToggle: () => void
}) {
  const stepMeta = STEP_MAP[task.taskType]
  const isFailed = task.status === 'FAILED'
  const isRunning = task.status === 'RUNNING'

  return (
    <div
      className="p-3 rounded-lg transition-all duration-200"
      style={{ background: 'var(--color-bg-secondary)' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
          style={{
            background: isRunning
              ? 'rgba(59,130,246,0.15)'
              : isFailed
                ? 'rgba(220,38,38,0.12)'
                : 'rgba(22,163,74,0.1)',
          }}
        >
          {isRunning ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.8)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
            </svg>
          ) : isFailed ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(220,38,38,0.8)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(22,163,74,0.8)" strokeWidth="2" strokeLinecap="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>
              {stepMeta?.label ?? task.taskType}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={task.status} />
              <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                {formatRelativeTime(date)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
              {task.account.name}
            </span>
            <span style={{ color: 'var(--color-border)' }}>·</span>
            <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
              {formatDuration(task.durationMs)}
            </span>
          </div>
          {isFailed && task.error && (
            <div className="mt-2">
              <button
                onClick={onToggle}
                className="text-xs flex items-center gap-1"
                style={{ color: 'var(--color-error)' }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {expanded ? '收起错误' : '查看错误详情'}
              </button>
              {expanded && (
                <pre
                  className="mt-1.5 p-2 rounded-lg text-xs overflow-x-auto"
                  style={{
                    background: 'rgba(220,38,38,0.06)',
                    color: 'var(--color-error)',
                    border: '1px solid rgba(220,38,38,0.15)',
                    maxHeight: '120px',
                  }}
                >
                  {task.error}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '进行中'
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  if (totalMinutes < 60) return `${totalMinutes}m ${remainingSeconds}s`
  const hours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}
