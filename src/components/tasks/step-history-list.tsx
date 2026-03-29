'use client'

import { useState, useEffect, useCallback } from 'react'
import { PIPELINE_STEPS, STEP_MAP, PipelineStepMeta } from '@/lib/pipeline-steps'
import { InlineResultView } from './inline-result-view'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Topic {
  id: string
  title: string
  status: string
}

interface ChildRun {
  id: string
  taskType: string
  status: string
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  output: string | null
  error: string | null
}

interface TaskRun {
  id: string
  taskType: string
  status: string
  durationMs: number | null
  startedAt: Date
  finishedAt: Date | null
  error: string | null
  output: string | null
  input: string | null
  account: { id: string; name: string }
  parentRunId?: string | null
  children?: ChildRun[]
}

interface RunningDetail {
  taskType: string
  startedAt: string
  topicId?: string
  topicTitle?: string | null
  currentProgress?: {
    phase: string
    current: number
    total: number
    message?: string
  }
}

interface TaskDetail {
  id: string
  taskType: string
  status: string
  durationMs: number | null
  startedAt: string
  finishedAt: string | null
  error: string | null
  account: { id: string; name: string }
  parsedOutput: unknown
  topic: { id: string; title: string; angle: string } | null
  selectedTopics: Array<{ id: string; title: string; heatScore: number }>
  content: { id: string; title: string; summary: string; wordCount: number } | null
}

interface StepHistoryListProps {
  taskRuns: TaskRun[]
  runningDetails: RunningDetail[]
}

// ─── Step Icon ───────────────────────────────────────────────────────────────

function StepIcon({ name, color }: { name: string; color: string }) {
  const iconProps = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (name) {
    case 'rss':
      return (
        <svg {...iconProps}>
          <path d="M4 11a9 9 0 0 1 9 9" />
          <path d="M4 4a16 16 0 0 1 16 16" />
          <circle cx="5" cy="19" r="1" fill={color} stroke="none" />
        </svg>
      )
    case 'target':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" fill={color} stroke="none" />
        </svg>
      )
    case 'search':
      return (
        <svg {...iconProps}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      )
    case 'pen':
      return (
        <svg {...iconProps}>
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <path d="M2 2l7.586 7.586" />
          <circle cx="11" cy="11" r="2" />
        </svg>
      )
    case 'image':
      return (
        <svg {...iconProps}>
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" fill={color} stroke="none" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case 'check':
      return (
        <svg {...iconProps}>
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      )
    case 'send':
      return (
        <svg {...iconProps}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" fill={color} stroke="none" />
        </svg>
      )
    case 'zap':
      return (
        <svg {...iconProps}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill={color} stroke="none" />
        </svg>
      )
    default:
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      )
  }
}

// ─── Time Helpers ────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - dateObj.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 30) return `${diffDay} 天前`
  return dateObj.toLocaleDateString('zh-CN')
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function formatElapsedSeconds(startedAt: string): string {
  const start = new Date(startedAt).getTime()
  const now = Date.now()
  const elapsed = Math.floor((now - start) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  const min = Math.floor(elapsed / 60)
  const sec = elapsed % 60
  return `${min}m ${sec}s`
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function RunningRow({ detail, color }: { detail: RunningDetail; color: string }) {
  const [elapsed, setElapsed] = useState(() => formatElapsedSeconds(detail.startedAt))

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsedSeconds(detail.startedAt))
    }, 1000)
    return () => clearInterval(interval)
  }, [detail.startedAt])

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${color}33` }}
    >
      <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: color }} />
      <span className="text-xs font-medium" style={{ color }}>
        运行中
      </span>
      {detail.topicTitle && (
        <span className="text-xs truncate flex-1" style={{ color: 'var(--color-fg-muted)' }}>
          {detail.topicTitle}
        </span>
      )}
      <span className="text-xs font-mono" style={{ color: 'var(--color-fg-muted)' }}>
        {elapsed}
      </span>
    </div>
  )
}

function HistoryRow({
  run,
  color,
  isResultExpanded,
  detail,
  onToggleResult,
  onCloseResult,
}: {
  run: TaskRun
  color: string
  isResultExpanded: boolean
  detail?: TaskDetail
  onToggleResult: () => void
  onCloseResult: () => void
}) {
  const isSuccess = run.status === 'SUCCESS'
  const isFailed = run.status === 'FAILED'

  return (
    <div>
      <div
        className="flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-colors"
        style={{
          background: isResultExpanded ? 'var(--color-bg-secondary)' : 'transparent',
          border: `1px solid ${isResultExpanded ? 'var(--color-border)' : 'transparent'}`,
        }}
        onClick={() => {
          if (!isResultExpanded && !detail && isSuccess) {
            onToggleResult()
          } else if (isResultExpanded) {
            onCloseResult()
          }
        }}
      >
        {/* Status icon */}
        {isSuccess ? (
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(22,163,74,0.15)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        ) : isFailed ? (
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(220,38,38,0.15)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
        ) : (
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--color-bg-tertiary)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </span>
        )}

        {/* Account */}
        <span className="text-xs shrink-0" style={{ color: 'var(--color-fg-muted)' }}>
          {run.account?.name ?? '未知账号'}
        </span>

        {/* Divider */}
        <span style={{ color: 'var(--color-border)' }}>|</span>

        {/* Duration */}
        <span className="text-xs font-mono shrink-0" style={{ color: 'var(--color-fg-muted)' }}>
          {formatDuration(run.durationMs)}
        </span>

        {/* Time */}
        <span className="text-xs shrink-0" style={{ color: 'var(--color-fg-subtle)' }}>
          {formatRelativeTime(run.startedAt)}
        </span>

        {/* Action */}
        <div className="ml-auto flex items-center gap-2">
          {isSuccess && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (isResultExpanded) {
                  onCloseResult()
                } else {
                  onToggleResult()
                }
              }}
              className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
              style={{
                background: isResultExpanded ? 'var(--color-bg-tertiary)' : `${color}15`,
                color: isResultExpanded ? 'var(--color-fg-muted)' : color,
              }}
            >
              {isResultExpanded ? '收起' : '查看结果'}
            </button>
          )}
          {isFailed && (
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(220,38,38,0.08)', color: 'var(--color-error)' }}>
              查看错误
            </span>
          )}
        </div>
      </div>

      {/* Inline result */}
      {isResultExpanded && detail && (
        <div className="mt-2">
          <InlineResultView detail={detail} />
        </div>
      )}

      {/* Inline error */}
      {isFailed && run.error && (
        <div className="mt-2 p-3 rounded-xl" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
          <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-error)' }}>
            {run.error}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Child Step Output Parser ─────────────────────────────────────────────

function parseChildOutput(child: ChildRun): unknown {
  if (!child.output || child.output === '{}') return null
  try {
    return JSON.parse(child.output)
  } catch {
    return null
  }
}

function ChildStepOutput({ child }: { child: ChildRun }) {
  const output = parseChildOutput(child)
  if (!output) return null

  switch (child.taskType) {
    case 'TREND_CRAWL': {
      const o = output as { itemCount?: number; topicFiltered?: number; fetchedAt?: string; items?: unknown[] }
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          {o.itemCount != null && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
              采集 {o.itemCount} 条
            </span>
          )}
          {o.topicFiltered != null && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
              去重过滤 {o.topicFiltered} 条
            </span>
          )}
          {o.fetchedAt && (
            <span style={{ color: 'var(--color-fg-subtle)' }}>
              {new Date(o.fetchedAt).toLocaleTimeString('zh-CN')}
            </span>
          )}
          {o.items && Array.isArray(o.items) && o.items.length > 0 && (
            <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-fg-subtle)' }}>
              最新: {((o.items[0] as { title?: string })?.title ?? '').slice(0, 30)}...
            </span>
          )}
        </div>
      )
    }

    case 'TOPIC_SELECT': {
      const o = output as { topicCount?: number; topicIds?: string[]; strategy?: string }
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          {o.topicCount != null && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
              筛选出 {o.topicCount} 个话题
            </span>
          )}
          {o.strategy && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
              策略: {o.strategy}
            </span>
          )}
        </div>
      )
    }

    case 'RESEARCH': {
      const o = output as { topicId?: string; researchSummary?: string; keyPointCount?: number }
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          {o.keyPointCount != null && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
              提炼 {o.keyPointCount} 个关键点
            </span>
          )}
          {o.researchSummary && (
            <span className="truncate max-w-xs" style={{ color: 'var(--color-fg-subtle)' }}>
              {o.researchSummary.slice(0, 50)}...
            </span>
          )}
        </div>
      )
    }

    case 'WRITE': {
      const o = output as { contentId?: string; title?: string; wordCount?: number; summary?: string }
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          {o.title && (
            <span className="font-medium truncate max-w-xs" style={{ color: 'var(--color-fg)' }}>
              《{o.title}》
            </span>
          )}
          {o.wordCount != null && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
              {o.wordCount} 字
            </span>
          )}
        </div>
      )
    }

    case 'GENERATE_IMAGES': {
      const o = output as { contentId?: string; imageCount?: number }
      return (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          {o.imageCount != null && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
              生成 {o.imageCount} 张配图
            </span>
          )}
        </div>
      )
    }

    case 'REVIEW': {
      const o = output as { passed?: boolean; score?: number; issues?: string[] }
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          {o.score != null && (
            <span
              className="px-1.5 py-0.5 rounded font-medium"
              style={{
                background: o.passed ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                color: o.passed ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              评分 {o.score}/10 {o.passed ? '通过' : '未通过'}
            </span>
          )}
          {o.issues && o.issues.length > 0 && (
            <span className="truncate max-w-xs" style={{ color: 'var(--color-error)' }}>
              问题: {o.issues[0]}
            </span>
          )}
        </div>
      )
    }

    case 'PUBLISH': {
      const o = output as { contentId?: string; mediaId?: string }
      return (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          {o.mediaId && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(22,163,74,0.1)', color: 'var(--color-success)' }}>
              已发布 mediaId: {o.mediaId}
            </span>
          )}
        </div>
      )
    }

    default:
      return null
  }
}

// ─── Pipeline Run Card ─────────────────────────────────────────────────────

function PipelineRunCard({
  run,
  color,
  isRunning,
  runningDetails,
  onToggleResult,
  expandedResultId,
  resultDetails,
  onCloseResult,
}: {
  run: TaskRun
  color: string
  isRunning: boolean
  runningDetails: RunningDetail[]
  onToggleResult: () => void
  expandedResultId: string | null
  resultDetails: Record<string, TaskDetail>
  onCloseResult: () => void
}) {
  const [elapsed, setElapsed] = useState<string>('')
  const [isExpanded, setIsExpanded] = useState(false)
  const children = run.children ?? []
  const isSuccess = run.status === 'SUCCESS'
  const isFailed = run.status === 'FAILED'

  useEffect(() => {
    if (!isRunning) {
      setElapsed('')
      return
    }
    function update() {
      setElapsed(formatElapsedSeconds(run.startedAt.toString()))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [isRunning, run.startedAt])

  // Map child taskType to step metadata
  function getStepMeta(taskType: string) {
    const stepId = taskType.replace(/_RUNNING$|_SUCCESS$|_FAILED$/, '')
    return STEP_MAP[stepId] ?? null
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}
    >
      {/* Card header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-4 text-left transition-colors"
        style={{ background: isExpanded ? 'var(--color-bg-secondary)' : 'transparent' }}
      >
        {/* Status icon */}
        {isRunning ? (
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 animate-pulse" style={{ background: `${color}20` }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </span>
        ) : isSuccess ? (
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(22,163,74,0.15)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        ) : isFailed ? (
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(220,38,38,0.15)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
        ) : (
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--color-bg-tertiary)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </span>
        )}

        {/* Pipeline label */}
        <span className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>
          完整流水线
        </span>

        {/* Account */}
        <span className="text-xs shrink-0" style={{ color: 'var(--color-fg-muted)' }}>
          {run.account?.name ?? '未知账号'}
        </span>

        {/* Duration */}
        <span className="text-xs font-mono shrink-0" style={{ color: 'var(--color-fg-muted)' }}>
          {isRunning ? elapsed : formatDuration(run.durationMs)}
        </span>

        {/* Time */}
        <span className="text-xs shrink-0" style={{ color: 'var(--color-fg-subtle)' }}>
          {formatRelativeTime(run.startedAt)}
        </span>

        {/* Child step indicators */}
        {children.length > 0 && (
          <div className="flex items-center gap-1 ml-auto mr-2">
            {children.slice(0, 7).map((child) => {
              const meta = getStepMeta(child.taskType)
              return (
                <span
                  key={child.id}
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: child.status === 'SUCCESS' ? 'var(--color-success)'
                      : child.status === 'FAILED' ? 'var(--color-error)'
                      : child.status === 'RUNNING' ? meta?.color ?? color
                      : 'var(--color-border)',
                  }}
                  title={`${meta?.label ?? child.taskType}: ${child.status}`}
                />
              )
            })}
            {children.length > 7 && (
              <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>+{children.length - 7}</span>
            )}
          </div>
        )}

        {/* Expand icon */}
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded: child steps */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-1.5">
          <div style={{ borderTop: '1px solid var(--color-border)' }} className="pt-3 mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--color-fg-muted)' }}>子步骤详情</span>
          </div>
          {children.length === 0 ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--color-fg-subtle)' }}>无子步骤记录</p>
          ) : (
            children.map((child: ChildRun) => {
              const meta: PipelineStepMeta | null = getStepMeta(child.taskType)
              const output = parseChildOutput(child)
              return (
                <div
                  key={child.id}
                  className="rounded-lg overflow-hidden"
                  style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
                >
                  {/* Row header */}
                  <div className="flex items-center gap-2 p-2">
                    <StepIcon name={meta?.icon ?? 'circle'} color={meta?.color ?? 'var(--color-fg-muted)'} />
                    <span className="text-xs flex-1" style={{ color: 'var(--color-fg)' }}>
                      {meta?.label ?? child.taskType}
                    </span>
                    <span className="text-xs font-mono" style={{ color: 'var(--color-fg-muted)' }}>
                      {formatDuration(child.durationMs)}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full"
                      style={{
                        background: child.status === 'SUCCESS' ? 'rgba(22,163,74,0.1)' : child.status === 'FAILED' ? 'rgba(220,38,38,0.1)' : 'var(--color-bg-tertiary)',
                        color: child.status === 'SUCCESS' ? 'var(--color-success)' : child.status === 'FAILED' ? 'var(--color-error)' : 'var(--color-fg-muted)',
                      }}
                    >
                      {child.status === 'SUCCESS' ? '成功' : child.status === 'FAILED' ? '失败' : child.status === 'RUNNING' ? '进行中' : child.status}
                    </span>
                  </div>
                  {/* Output details */}
                  {!!output && (
                    <div className="px-3 pb-2">
                      <ChildStepOutput child={child} />
                    </div>
                  )}
                  {/* Error */}
                  {child.status === 'FAILED' && child.error && (
                    <div className="px-3 pb-2">
                      <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-error)' }}>
                        {child.error}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* Error */}
          {isFailed && run.error && (
            <div className="mt-2 p-3 rounded-xl" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
              <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-error)' }}>
                {run.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function StepHistoryList({
  taskRuns,
  runningDetails,
}: StepHistoryListProps) {
  const steps = PIPELINE_STEPS.filter((s) => s.id !== 'FULL_PIPELINE')
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null)
  const [resultDetails, setResultDetails] = useState<Record<string, TaskDetail>>({})
  const [loadingResults, setLoadingResults] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<'pipeline' | 'steps'>('pipeline')

  function getRunsForStep(stepId: string): TaskRun[] {
    return taskRuns.filter((r) => r.taskType === stepId && !r.parentRunId)
  }

  function getRunningForStep(stepId: string): RunningDetail | undefined {
    return runningDetails.find((d) => d.taskType === stepId)
  }

  const handleViewResult = useCallback(
    async (taskId: string) => {
      if (resultDetails[taskId]) {
        setExpandedResultId(expandedResultId === taskId ? null : taskId)
        return
      }
      if (loadingResults[taskId]) return

      setLoadingResults((prev) => ({ ...prev, [taskId]: true }))
      try {
        const res = await fetch(`/api/tasks/${taskId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { taskRun: TaskDetail }
        setResultDetails((prev) => ({ ...prev, [taskId]: data.taskRun }))
        setExpandedResultId(taskId)
      } catch (err) {
        console.error('Failed to load task detail:', err)
      } finally {
        setLoadingResults((prev) => ({ ...prev, [taskId]: false }))
      }
    },
    [resultDetails, expandedResultId, loadingResults],
  )

  function handleToggleResult(taskId: string) {
    if (expandedResultId === taskId) {
      setExpandedResultId(null)
    } else {
      handleViewResult(taskId)
    }
  }

  const pipelineRuns = taskRuns.filter((r) => r.taskType === 'FULL_PIPELINE')
  const standaloneCount = taskRuns.filter((r) => r.taskType !== 'FULL_PIPELINE' && !r.parentRunId).length

  return (
    <div className="space-y-3">
      {/* ── Tab Bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
        <button
          onClick={() => setActiveTab('pipeline')}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: activeTab === 'pipeline' ? 'var(--color-card)' : 'transparent',
            color: activeTab === 'pipeline' ? 'var(--color-fg)' : 'var(--color-fg-muted)',
            boxShadow: activeTab === 'pipeline' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          完整流水线
          {pipelineRuns.length > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                background: activeTab === 'pipeline' ? 'rgba(124,43,238,0.1)' : 'var(--color-bg-tertiary)',
                color: activeTab === 'pipeline' ? 'var(--color-primary)' : 'var(--color-fg-muted)',
              }}
            >
              {pipelineRuns.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('steps')}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: activeTab === 'steps' ? 'var(--color-card)' : 'transparent',
            color: activeTab === 'steps' ? 'var(--color-fg)' : 'var(--color-fg-muted)',
            boxShadow: activeTab === 'steps' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          单步执行
          {standaloneCount > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                background: activeTab === 'steps' ? 'rgba(124,43,238,0.1)' : 'var(--color-bg-tertiary)',
                color: activeTab === 'steps' ? 'var(--color-primary)' : 'var(--color-fg-muted)',
              }}
            >
              {standaloneCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Pipeline Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'pipeline' && (
        <div className="space-y-2">
          {pipelineRuns.length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: 'var(--color-fg-subtle)' }}>
              暂无完整流水线执行记录
            </p>
          ) : (
            pipelineRuns.map((run) => (
              <PipelineRunCard
                key={run.id}
                run={run}
                color="var(--color-primary)"
                isRunning={run.status === 'RUNNING'}
                runningDetails={runningDetails}
                onToggleResult={() => handleToggleResult(run.id)}
                expandedResultId={expandedResultId}
                resultDetails={resultDetails}
                onCloseResult={() => setExpandedResultId(null)}
              />
            ))
          )}
        </div>
      )}

      {/* ── Steps Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'steps' && (
        <div className="space-y-5">
          {steps.every((s) => getRunsForStep(s.id).length === 0 && !getRunningForStep(s.id)) ? (
            <p className="text-xs text-center py-8" style={{ color: 'var(--color-fg-subtle)' }}>
              暂无单步执行记录
            </p>
          ) : (
            steps.map((step, index) => {
              const runs = getRunsForStep(step.id)
              const running = getRunningForStep(step.id)
              if (runs.length === 0 && !running) return null

              return (
                <div key={step.id}>
                  {/* Step label */}
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: step.color, color: '#fff', fontSize: '9px' }}
                    >
                      {index + 1}
                    </span>
                    <StepIcon name={step.icon} color={step.color} />
                    <span className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>
                      {step.label}
                    </span>
                    {running && (
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: step.color }} />
                    )}
                    <span className="ml-auto text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                      {runs.length} 条
                    </span>
                  </div>

                  {/* History rows — flat, no accordion */}
                  <div className="space-y-1.5 pl-7">
                    {running && <RunningRow detail={running} color={step.color} />}
                    {runs.map((run) => (
                      <HistoryRow
                        key={run.id}
                        run={run}
                        color={step.color}
                        isResultExpanded={expandedResultId === run.id}
                        detail={resultDetails[run.id]}
                        onToggleResult={() => handleToggleResult(run.id)}
                        onCloseResult={() => setExpandedResultId(null)}
                      />
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
