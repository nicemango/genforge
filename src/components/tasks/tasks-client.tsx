'use client'

import { useState, useEffect, useCallback } from 'react'
import { STEP_MAP, PIPELINE_STEPS } from '@/lib/pipeline-steps'
import PipelineFlowSection from './pipeline-flow-section'
import StepHistoryList from './step-history-list'

// ─── Types ───────────────────────────────────────────────────────────────────

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
}

interface Account {
  id: string
  name: string
}

interface Schedule {
  id: string
  name: string
  taskType: string
  cronExpr: string
  isEnabled: boolean
  lastRunAt: Date | null
  nextRunAt: Date | null
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

const CRON_PRESETS = [
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 14:00', value: '0 14 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每6小时', value: '0 */6 * * *' },
]

// ─── Main Component ──────────────────────────────────────────────────────────

export default function TasksClient({
  taskRuns: initialTaskRuns,
  accounts,
  schedules: initialSchedules,
}: {
  taskRuns: TaskRun[]
  accounts: Account[]
  schedules: Schedule[]
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? '')
  const [taskRuns, setTaskRuns] = useState(initialTaskRuns)
  const [running, setRunning] = useState(false)
  const [runMessage, setRunMessage] = useState('')
  const [runMessageType, setRunMessageType] = useState<'success' | 'error' | 'info'>('info')

  // Schedule state
  const [schedules, setSchedules] = useState(initialSchedules)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    taskType: 'FULL_PIPELINE',
    cronExpr: '0 9 * * *',
  })

  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null)

  // Live running state
  const [runningDetails, setRunningDetails] = useState<RunningDetail[]>([])

  // ── Poll running details ─────────────────────────────────────────────────
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/tasks?runningDetails=true', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json() as { runningDetails: RunningDetail[]; taskRuns?: TaskRun[] }
          setRunningDetails(data.runningDetails ?? [])
          // Refresh taskRuns when new tasks appear (polling brings back updated list from server)
          if (data.taskRuns) {
            setTaskRuns(data.taskRuns as TaskRun[])
          }
        }
      } catch { /* ignore */ }
    }
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [])

  // ── Execute ─────────────────────────────────────────────────────────────
  const handleStepExecute = useCallback(async (stepId: string, topicId?: string) => {
    if (!selectedAccountId) {
      setRunMessage('请先选择账号')
      setRunMessageType('error')
      return
    }

    setRunning(true)
    setRunMessage('')
    setRunMessageType('info')

    try {
      const endpoint = stepId === 'FULL_PIPELINE' ? '/api/pipeline/run' : '/api/pipeline/step'
      const body: Record<string, string> = { accountId: selectedAccountId }
      if (stepId !== 'FULL_PIPELINE') body.step = stepId
      if (topicId) body.topicId = topicId

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json() as { status: string; error?: string; taskRunId?: string }

      if (!res.ok || data.status === 'failed') {
        setRunMessage(`执行失败: ${data.error ?? '未知错误'}`)
        setRunMessageType('error')
      } else {
        const step = STEP_MAP[stepId]
        setRunMessage(`「${step?.label ?? stepId}」已启动`)
        setRunMessageType('success')
        // Refresh running state immediately
        const pollRes = await fetch('/api/tasks?runningDetails=true', { cache: 'no-store' })
        if (pollRes.ok) {
          const pollData = await pollRes.json() as { runningDetails: RunningDetail[] }
          setRunningDetails(pollData.runningDetails ?? [])
        }
        // Also refresh task runs
        const runsRes = await fetch('/api/tasks', { cache: 'no-store' })
        if (runsRes.ok) {
          const runsData = await runsRes.json() as { taskRuns: TaskRun[] }
          setTaskRuns(runsData.taskRuns ?? [])
        }
      }
    } catch (err) {
      setRunMessage(`请求失败: ${err instanceof Error ? err.message : String(err)}`)
      setRunMessageType('error')
    } finally {
      setRunning(false)
    }
  }, [selectedAccountId])

  // ── Schedule ───────────────────────────────────────────────────────────
  async function handleCreateSchedule(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccountId) return
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scheduleForm, accountId: selectedAccountId }),
      })
      if (!res.ok) throw new Error(await res.text())
      const schedule = await res.json() as Schedule
      setSchedules((prev) => [schedule, ...prev])
      setShowScheduleForm(false)
    } catch (err) {
      setRunMessage(`创建失败: ${err instanceof Error ? err.message : String(err)}`)
      setRunMessageType('error')
    }
  }

  async function handleDeleteSchedule(id: string) {
    setDeleteScheduleId(null)
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      setSchedules((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setRunMessage(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
      setRunMessageType('error')
    }
  }

  async function toggleSchedule(schedule: Schedule) {
    const res = await fetch(`/api/schedules/${schedule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: !schedule.isEnabled }),
    })
    if (res.ok) {
      const updated = await res.json() as Schedule
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>
            流水线控制台
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-fg-muted)' }}>
            点击任意步骤立即执行，或设置定时计划自动运行
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm border"
            style={{
              background: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-fg)',
            }}
          >
            {accounts.length === 0 && <option value="">无账号</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Pipeline Flow Section ─────────────────────────────────────── */}
      <div className="card">
        <PipelineFlowSection
          selectedAccountId={selectedAccountId}
          runningDetails={runningDetails}
          onStepExecute={handleStepExecute}
          disabled={running || !selectedAccountId}
        />
      </div>

      {/* ── Run message ──────────────────────────────────────────────── */}
      {runMessage && (
        <div
          className="flex items-center gap-2 text-sm px-4 py-3 rounded-xl"
          style={{
            background: runMessageType === 'error' ? 'rgba(220,38,38,0.06)'
              : runMessageType === 'success' ? 'rgba(22,163,74,0.06)'
              : 'var(--color-bg-secondary)',
            border: `1px solid ${runMessageType === 'error' ? 'rgba(220,38,38,0.15)'
              : runMessageType === 'success' ? 'rgba(22,163,74,0.15)'
              : 'var(--color-border)'}`,
            color: runMessageType === 'error' ? 'var(--color-error)'
              : runMessageType === 'success' ? 'var(--color-success)'
              : 'var(--color-fg)',
          }}
        >
          {runMessageType === 'success' ? <CheckCircleIcon /> : runMessageType === 'error' ? <ErrorIcon /> : <InfoIcon />}
          {runMessage}
        </div>
      )}

      {/* ── Running Status Banner ────────────────────────────────────── */}
      {runningDetails.length > 0 && (
        <div className="space-y-2">
          {runningDetails.map((detail) => {
            const stepMeta = STEP_MAP[detail.taskType]
            const isFullPipeline = detail.taskType === 'FULL_PIPELINE'
            const color = isFullPipeline ? 'var(--color-primary)' : (stepMeta?.color ?? 'var(--color-primary)')
            return (
              <div
                key={detail.taskType}
                className="flex flex-col gap-2 p-4 rounded-xl"
                style={{
                  background: isFullPipeline
                    ? 'linear-gradient(135deg, rgba(124,43,238,0.1), rgba(124,43,238,0.04))'
                    : 'var(--color-bg-secondary)',
                  border: `1px solid ${isFullPipeline ? 'rgba(124,43,238,0.25)' : 'var(--color-border)'}`,
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full animate-pulse shrink-0" style={{ background: color }} />
                  <span className="text-sm font-medium" style={{ color }}>
                    {isFullPipeline ? '完整流水线运行中' : `${stepMeta?.label ?? detail.taskType} 运行中`}
                  </span>
                  {detail.topicTitle && (
                    <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                      {detail.topicTitle}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-mono" style={{ color }}>
                    <ElapsedTimer startedAt={detail.startedAt} />
                  </span>
                </div>
                {isFullPipeline && detail.currentProgress && (
                  <div className="ml-5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-tertiary)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(detail.currentProgress.current / detail.currentProgress.total) * 100}%`,
                          background: 'var(--color-primary)',
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono shrink-0" style={{ color: 'var(--color-primary)' }}>
                      {detail.currentProgress.message ?? `${detail.currentProgress.current}/${detail.currentProgress.total}`}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Step History List ────────────────────────────────────────── */}
      <StepHistoryList
        taskRuns={taskRuns}
        runningDetails={runningDetails}
      />

      {/* ── Scheduled Plans ──────────────────────────────────────────── */}
      <div className="card">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>
              定时计划
            </h2>
            {schedules.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-xs" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg-muted)' }}>
                {schedules.length}
              </span>
            )}
          </div>
          {!showScheduleForm && (
            <button
              onClick={() => setShowScheduleForm(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
              style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg-muted)', border: '1px solid var(--color-border)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              添加计划
            </button>
          )}
        </div>

        {/* Schedule list */}
        {schedules.length > 0 && (
          <div className="mt-4 space-y-2">
            {schedules.map((s) => {
              const stepMeta = STEP_MAP[s.taskType]
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-3 rounded-xl"
                  style={{ background: 'var(--color-bg-secondary)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${stepMeta?.color ?? 'var(--color-primary)'}15` }}
                    >
                      <StepIcon name={stepMeta?.icon ?? 'circle'} color={stepMeta?.color ?? 'var(--color-primary)'} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>{s.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                          {stepMeta?.label ?? s.taskType}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-border)' }}>·</span>
                        <span className="text-xs font-mono" style={{ color: 'var(--color-fg-muted)' }}>
                          {s.cronExpr}
                        </span>
                        {s.nextRunAt && (
                          <>
                            <span className="text-xs" style={{ color: 'var(--color-border)' }}>·</span>
                            <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                              下次 {formatRelative(new Date(s.nextRunAt))}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleSchedule(s)}
                      className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors duration-200"
                      style={{
                        background: s.isEnabled ? 'rgba(22,163,74,0.1)' : 'var(--color-bg-tertiary)',
                        color: s.isEnabled ? 'var(--color-success)' : 'var(--color-fg-subtle)',
                      }}
                    >
                      {s.isEnabled ? '已启用' : '已停用'}
                    </button>
                    <button
                      onClick={() => setDeleteScheduleId(s.id)}
                      className="text-xs font-medium px-2 py-1.5 rounded-lg transition-colors duration-200"
                      style={{ color: 'var(--color-fg-subtle)' }}
                      title="删除计划"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {schedules.length === 0 && !showScheduleForm && (
          <p className="mt-4 text-xs text-center" style={{ color: 'var(--color-fg-subtle)' }}>
            暂无定时计划
          </p>
        )}

        {/* Schedule form */}
        {showScheduleForm && (
          <form onSubmit={handleCreateSchedule} className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">计划名称</label>
                <input
                  required
                  value={scheduleForm.name}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, name: e.target.value }))}
                  className="input"
                  placeholder="每天早间采集"
                />
              </div>
              <div>
                <label className="label">执行步骤</label>
                <select
                  value={scheduleForm.taskType}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, taskType: e.target.value }))}
                  className="input"
                >
                  {PIPELINE_STEPS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">执行时间</label>
                <div className="flex gap-2">
                  <input
                    required
                    value={scheduleForm.cronExpr}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, cronExpr: e.target.value }))}
                    className="input flex-1"
                    placeholder="0 9 * * *"
                  />
                  <select
                    value=""
                    onChange={(e) => e.target.value && setScheduleForm((f) => ({ ...f, cronExpr: e.target.value }))}
                    className="input w-auto"
                  >
                    <option value="">预设</option>
                    {CRON_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">创建计划</button>
              <button type="button" onClick={() => setShowScheduleForm(false)} className="btn btn-secondary">取消</button>
            </div>
          </form>
        )}
      </div>

      {/* ── Delete schedule confirm dialog ───────────────────────────── */}
      {deleteScheduleId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => e.target === e.currentTarget && setDeleteScheduleId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
            }}
          >
            <div>
              <h3 className="font-semibold" style={{ color: 'var(--color-fg)' }}>删除定时计划</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--color-fg-muted)' }}>
                确认删除「{schedules.find((s) => s.id === deleteScheduleId)?.name ?? '此计划'}」？此操作无法撤销。
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => handleDeleteSchedule(deleteScheduleId)}
                className="btn flex-1"
                style={{ background: 'var(--color-error)', color: '#fff' }}
              >
                确认删除
              </button>
              <button onClick={() => setDeleteScheduleId(null)} className="btn btn-secondary flex-1">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null) return '进行中'
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${s}s`
}

function formatRelative(date: Date): string {
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

function StepIcon({ name, color }: { name: string; color: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'rss': return <svg {...p}><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
    case 'target': return <svg {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
    case 'search': return <svg {...p}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    case 'pen': return <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
    case 'image': return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    case 'check': return <svg {...p}><path d="M20 6 9 17l-5-5"/></svg>
    case 'send': return <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    case 'zap': return <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    default: return <svg {...p}><circle cx="12" cy="12" r="10"/></svg>
  }
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  )
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  function compute() {
    const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }
  const [elapsed, setElapsed] = useState(compute)
  useEffect(() => {
    const interval = setInterval(() => setElapsed(compute()), 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt])
  return <>{elapsed}</>
}
