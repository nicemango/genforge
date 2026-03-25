'use client'

import { useState, useCallback, useEffect } from 'react'
import { STEP_MAP, PIPELINE_STEPS, type PipelineStepMeta } from '@/lib/pipeline-steps'

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

interface Topic {
  id: string
  title: string
  status: string
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

interface RunningDetail {
  taskType: string
  startedAt: string
  topicId?: string
  topicTitle?: string | null
}

const CRON_PRESETS = [
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 14:00', value: '0 14 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每6小时', value: '0 */6 * * *' },
]

// ─── Main Component ──────────────────────────────────────────────────────────

export default function TasksClient({
  taskRuns,
  accounts,
  schedules: initialSchedules,
}: {
  taskRuns: TaskRun[]
  accounts: Account[]
  schedules: Schedule[]
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? '')
  const [selectedStep, setSelectedStep] = useState<string>('FULL_PIPELINE')
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopicId, setSelectedTopicId] = useState<string>('')
  const [topicsLoading, setTopicsLoading] = useState(false)
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

  // Live running state
  const [runningDetails, setRunningDetails] = useState<RunningDetail[]>([])
  const [runningElapsed, setRunningElapsed] = useState<Record<string, string>>({})

  // Result detail panel
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [taskDetailLoading, setTaskDetailLoading] = useState(false)

  const currentStep = STEP_MAP[selectedStep]

  // ── Load topics when step needs one ───────────────────────────────────
  const loadTopics = useCallback(async () => {
    setTopicsLoading(true)
    try {
      const [pendingRes, inProgressRes] = await Promise.all([
        fetch('/api/topics?status=PENDING', { cache: 'no-store' }),
        fetch('/api/topics?status=IN_PROGRESS', { cache: 'no-store' }),
      ])
      const [pendingData, inProgressData] = await Promise.all([
        pendingRes.ok ? pendingRes.json() as Promise<{ topics: Topic[] }> : { topics: [] },
        inProgressRes.ok ? inProgressRes.json() as Promise<{ topics: Topic[] }> : { topics: [] },
      ])
      const merged = [...pendingData.topics, ...inProgressData.topics]
      setTopics(merged)
      if (merged.length > 0 && !selectedTopicId) {
        setSelectedTopicId(merged[0].id)
      }
    } catch { /* ignore */ } finally {
      setTopicsLoading(false)
    }
  }, [selectedTopicId])

  // ── Poll running details + live timer ──────────────────────────────────
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/tasks?runningDetails=true', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json() as { runningDetails: RunningDetail[] }
          setRunningDetails(data.runningDetails ?? [])
        }
      } catch { /* ignore */ }
    }
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [])

  // Update elapsed time every second
  useEffect(() => {
    if (runningDetails.length === 0) return
    function update() {
      const now = Date.now()
      const next: Record<string, string> = {}
      for (const d of runningDetails) {
        const ms = now - new Date(d.startedAt).getTime()
        next[d.taskType] = formatDuration(ms)
      }
      setRunningElapsed(next)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [runningDetails])

  // Load topics when step changes
  function handleStepChange(stepId: string) {
    setSelectedStep(stepId)
    setRunMessage('')
    if (STEP_MAP[stepId]?.needsTopicId) {
      setTopics([])
      setSelectedTopicId('')
      loadTopics()
    } else {
      setTopics([])
      setSelectedTopicId('')
    }
  }

  // ── Execute ─────────────────────────────────────────────────────────────
  async function handleRun() {
    if (!selectedAccountId) {
      setRunMessage('请先选择账号')
      setRunMessageType('error')
      return
    }
    if (currentStep?.needsTopicId && !selectedTopicId) {
      setRunMessage('请先选择一个话题')
      setRunMessageType('error')
      return
    }

    setRunning(true)
    setRunMessage('')
    setRunMessageType('info')

    try {
      const endpoint = selectedStep === 'FULL_PIPELINE' ? '/api/pipeline/run' : '/api/pipeline/step'
      const body: Record<string, string> = { accountId: selectedAccountId }
      if (selectedStep !== 'FULL_PIPELINE') body.step = selectedStep
      if (selectedTopicId) body.topicId = selectedTopicId

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
        setRunMessage(`「${currentStep?.label}」已启动`)
        setRunMessageType('success')
        // Refresh running state
        const pollRes = await fetch('/api/tasks?runningDetails=true', { cache: 'no-store' })
        if (pollRes.ok) {
          const pollData = await pollRes.json() as { runningDetails: RunningDetail[] }
          setRunningDetails(pollData.runningDetails ?? [])
        }
      }
    } catch (err) {
      setRunMessage(`请求失败: ${err instanceof Error ? err.message : String(err)}`)
      setRunMessageType('error')
    } finally {
      setRunning(false)
    }
  }

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
      alert(`创建失败: ${err instanceof Error ? err.message : String(err)}`)
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

  // ── Result Detail ───────────────────────────────────────────────────────
  async function openTaskDetail(taskId: string) {
    setSelectedTaskId(taskId)
    setTaskDetail(null)
    setTaskDetailLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json() as { taskRun: TaskDetail }
        setTaskDetail(data.taskRun)
      }
    } catch { /* ignore */ } finally {
      setTaskDetailLoading(false)
    }
  }

  function closeTaskDetail() {
    setSelectedTaskId(null)
    setTaskDetail(null)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  const isStepRunnable = (step: PipelineStepMeta) => {
    if (running) return false
    if (!selectedAccountId) return false
    if (step.needsTopicId && topics.length === 0 && !topicsLoading) return false
    return true
  }

  // Recent runs (last 10, with step metadata enriched)
  const recentRuns = taskRuns.slice(0, 10).map((r) => ({
    ...r,
    meta: STEP_MAP[r.taskType],
  }))

  return (
    <div className="space-y-6">

      {/* ── Section 1: Header ─────────────────────────────────────────── */}
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

      {/* ── Section 2: Steps Grid ────────────────────────────────────── */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PIPELINE_STEPS.map((step, index) => {
            const isSelected = selectedStep === step.id
            const canRun = isStepRunnable(step)

            return (
              <button
                key={step.id}
                onClick={() => handleStepChange(step.id)}
                className="relative text-left p-4 rounded-xl transition-all duration-200 group"
                style={{
                  background: isSelected ? `${step.color}15` : 'var(--color-bg-secondary)',
                  border: `2px solid ${isSelected ? step.color : 'var(--color-border)'}`,
                }}
              >
                {/* Step number */}
                <span
                  className="absolute top-2 right-2 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center"
                  style={{ background: step.color, color: '#fff', fontSize: '10px' }}
                >
                  {index + 1}
                </span>

                <div className="flex items-center gap-2 mb-2">
                  <StepIcon name={step.icon} color={step.color} />
                  <span className="font-semibold text-sm" style={{ color: 'var(--color-fg)' }}>
                    {step.label}
                  </span>
                </div>

                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>
                  {step.description}
                </p>

                <div className="mt-2 flex flex-wrap gap-1">
                  {step.needsTopicId && (
                    <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--color-info)' }}>
                      需选话题
                    </span>
                  )}
                  {step.dependencies.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: `${step.color}12`, color: step.color }}>
                      依赖 {step.dependencies.map((d) => STEP_MAP[d]?.label ?? d).join('·')}
                    </span>
                  )}
                </div>

                {/* Execute button overlay on hover/select */}
                {(isSelected) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); if (canRun) handleRun() }}
                    disabled={running || !selectedAccountId || (step.needsTopicId && !selectedTopicId && !topicsLoading)}
                    className="mt-3 w-full py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center justify-center gap-1.5"
                    style={{
                      background: canRun ? step.color : `${step.color}44`,
                      color: canRun ? '#fff' : 'rgba(255,255,255,0.5)',
                      cursor: canRun ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {running ? (
                      <>
                        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                        </svg>
                        执行中...
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        立即执行
                      </>
                    )}
                  </button>
                )}
              </button>
            )
          })}
        </div>

        {/* Context bar: topic selector + run message */}
        <div className="mt-4 pt-4 flex items-center gap-4 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
          {/* Topic selector */}
          {currentStep?.needsTopicId && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium" style={{ color: 'var(--color-fg-muted)' }}>处理话题</label>
              <select
                value={selectedTopicId}
                onChange={(e) => setSelectedTopicId(e.target.value)}
                className="input text-xs py-1.5"
                disabled={topicsLoading}
              >
                <option value="">
                  {topicsLoading ? '加载中...' : topics.length === 0 ? '暂无话题（需先执行「话题筛选」）' : '选择话题'}
                </option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title.length > 30 ? t.title.slice(0, 30) + '...' : t.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Run message */}
          {runMessage && (
            <div
              className="flex items-center gap-2 text-xs"
              style={{
                color: runMessageType === 'error' ? 'var(--color-error)'
                  : runMessageType === 'success' ? 'var(--color-success)'
                  : 'var(--color-fg-muted)',
              }}
            >
              {runMessageType === 'success' ? <CheckCircleIcon /> : runMessageType === 'error' ? <ErrorIcon /> : <InfoIcon />}
              {runMessage}
            </div>
          )}

          {/* Running count indicator */}
          {runningDetails.length > 0 && (
            <div className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--color-primary)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--color-primary)' }} />
              {runningDetails.length} 个步骤运行中
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: Live Running Panel ─────────────────────────────── */}
      {runningDetails.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--color-primary)' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>
              正在运行
            </h2>
          </div>
          <div className="space-y-2">
            {runningDetails.map((d) => {
              const stepMeta = STEP_MAP[d.taskType]
              return (
                <div
                  key={d.taskType}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{
                    background: `${stepMeta?.color ?? 'var(--color-primary)'}12`,
                    border: `1px solid ${stepMeta?.color ?? 'var(--color-primary)'}30`,
                  }}
                >
                  <StepIcon name={stepMeta?.icon ?? 'circle'} color={stepMeta?.color ?? 'var(--color-primary)'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>
                        {stepMeta?.label ?? d.taskType}
                      </p>
                      <span className="text-xs font-mono" style={{ color: stepMeta?.color ?? 'var(--color-primary)' }}>
                        {runningElapsed[d.taskType] ?? '0s'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {d.topicTitle && (
                        <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-fg-muted)' }}>
                          {d.topicTitle.length > 35 ? d.topicTitle.slice(0, 35) + '...' : d.topicTitle}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-24 h-1.5 rounded-full overflow-hidden shrink-0" style={{ background: 'var(--color-bg-secondary)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        background: `${stepMeta?.color ?? 'var(--color-primary)'}88`,
                        animation: 'pulse-bar 2s ease-in-out infinite',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Section 4: Recent Executions ──────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>
            执行记录
            <span className="ml-2 text-sm font-normal" style={{ color: 'var(--color-fg-muted)' }}>
              共 {taskRuns.length} 条
            </span>
          </h2>
        </div>

        {recentRuns.length === 0 ? (
          <div className="text-center py-10">
            <div className="mb-3 flex justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>
              暂无执行记录，点击上方步骤开始第一次执行
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentRuns.map((run) => {
              const isRunning = run.status === 'RUNNING'
              const isFailed = run.status === 'FAILED'
              const isSuccess = run.status === 'SUCCESS'
              return (
                <div
                  key={run.id}
                  className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer hover:opacity-80"
                  style={{ background: 'var(--color-bg-secondary)' }}
                  onClick={() => !isRunning && openTaskDetail(run.id)}
                >
                  {/* Status icon */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: isRunning
                        ? 'rgba(59,130,246,0.12)'
                        : isFailed
                          ? 'rgba(220,38,38,0.1)'
                          : 'rgba(22,163,74,0.1)',
                    }}
                  >
                    {isRunning ? (
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.8)" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </svg>
                    ) : isFailed ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(220,38,38,0.8)" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(22,163,74,0.8)" strokeWidth="2" strokeLinecap="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: run.meta?.color ?? 'var(--color-border)' }}
                      />
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--color-fg)' }}>
                        {run.meta?.label ?? run.taskType}
                      </span>
                      <StatusBadgeInline status={run.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                        {run.account.name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-border)' }}>·</span>
                      <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                        {isRunning ? '进行中' : formatDuration(run.durationMs)}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-border)' }}>·</span>
                      <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                        {formatRelative(new Date(run.startedAt))}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isFailed && run.error && (
                      <ErrorHint error={run.error} />
                    )}
                    {isSuccess && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openTaskDetail(run.id) }}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-150"
                        style={{
                          background: 'var(--color-primary-alpha)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        查看结果
                      </button>
                    )}
                    {isRunning && (
                      <span className="text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--color-info)', background: 'rgba(59,130,246,0.08)' }}>
                        进行中
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Section 5: Scheduled Plans ───────────────────────────────── */}
      <div className="card">
        <button
          onClick={() => setShowScheduleForm(!showScheduleForm)}
          className="w-full flex items-center justify-between"
        >
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
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2"
            style={{ transform: showScheduleForm ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

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

        {/* Schedule list */}
        {schedules.length > 0 ? (
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
                </div>
              )
            })}
          </div>
        ) : (
          !showScheduleForm && (
            <p className="mt-3 text-xs text-center" style={{ color: 'var(--color-fg-subtle)' }}>
              暂无定时计划，<button onClick={() => setShowScheduleForm(true)} className="underline" style={{ color: 'var(--color-primary)' }}>创建第一个</button>
            </p>
          )
        )}
      </div>

      {/* ── Result Detail Panel ─────────────────────────────────────────── */}
      {selectedTaskId !== null && (
        <ResultDetailPanel
          detail={taskDetail}
          loading={taskDetailLoading}
          onClose={closeTaskDetail}
        />
      )}
    </div>
  )
}

// ─── Sub Components ────────────────────────────────────────────────────────────

function ResultDetailPanel({
  detail,
  loading,
  onClose,
}: {
  detail: TaskDetail | null
  loading: boolean
  onClose: () => void
}) {
  const stepMeta = detail ? STEP_MAP[detail.taskType] : null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="h-full w-full max-w-lg overflow-y-auto p-6 space-y-5"
        style={{
          background: 'var(--color-card)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {stepMeta && (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${stepMeta.color}18` }}
              >
                <StepIcon name={stepMeta.icon} color={stepMeta.color} />
              </div>
            )}
            <div>
              <h2 className="font-bold text-base" style={{ color: 'var(--color-fg)' }}>
                {stepMeta?.label ?? detail?.taskType ?? '执行结果'}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-fg-muted)' }}>
                {detail ? new Date(detail.startedAt).toLocaleString('zh-CN') : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-150"
            style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg-muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          </div>
        ) : detail?.error ? (
          <div className="p-4 rounded-xl" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-error)' }}>执行失败</p>
            <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-error)' }}>
              {detail.error}
            </pre>
          </div>
        ) : detail?.parsedOutput ? (
          <ParsedOutputView detail={detail} />
        ) : (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>暂无输出数据</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ParsedOutputView({ detail }: { detail: TaskDetail }) {
  const output = detail.parsedOutput as Record<string, unknown>

  const renderField = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return null
    return (
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-fg-muted)' }}>
          {label}
        </p>
        {typeof value === 'string' ? (
          /^https?:\/\//i.test(value) ? (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm leading-relaxed break-all hover:underline"
              style={{ color: 'var(--color-primary)' }}
            >
              {value}
            </a>
          ) : (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>{value}</p>
          )
        ) : typeof value === 'number' ? (
          <p className="text-sm font-mono" style={{ color: 'var(--color-fg)' }}>{value}</p>
        ) : typeof value === 'boolean' ? (
          <span
            className="inline-block px-2 py-0.5 rounded text-xs font-medium"
            style={{
              background: value ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
              color: value ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {value ? '是' : '否'}
          </span>
        ) : Array.isArray(value) ? (
          <div className="space-y-1">
            {value.slice(0, 10).map((item, i) => (
              <div key={i} className="p-2 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
                {typeof item === 'object' ? (
                  <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-fg)' }}>
                    {JSON.stringify(item, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--color-fg)' }}>{String(item)}</p>
                )}
              </div>
            ))}
            {value.length > 10 && (
              <p className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                ... 共 {value.length} 项
              </p>
            )}
          </div>
        ) : typeof value === 'object' ? (
          <div className="p-3 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
            <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-fg)' }}>
              {JSON.stringify(value, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    )
  }

  // Step-specific display
  switch (detail.taskType) {
    case 'TREND_CRAWL':
      return (
        <div className="space-y-4">
          {renderField('抓取时间', output.fetchedAt as string)}
          {renderField('总条目数', output.itemCount as number)}
          {renderField('话题过滤', output.topicFiltered as number)}
          {(() => {
            const items = output.items as Array<{ title?: string; source?: string; pubDate?: string }> | undefined
            return items && items.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-fg-muted)' }}>
                最近抓取内容
              </p>
              <div className="space-y-2">
                {items.slice(0, 8).map((item, i) => (
                  <div key={i} className="p-3 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
                    <p className="text-sm font-medium line-clamp-2" style={{ color: 'var(--color-fg)' }}>
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary-alpha)', color: 'var(--color-primary)' }}>
                        {item.source}
                      </span>
                      {item.pubDate && (
                        <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                          {new Date(item.pubDate).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            )
          })()}
        </div>
      )

    case 'TOPIC_SELECT':
      return (
        <div className="space-y-4">
          {renderField('筛选出话题数', output.topicCount as number)}
          {detail.selectedTopics.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-fg-muted)' }}>
                候选话题（按热度排序）
              </p>
              <div className="space-y-2">
                {detail.selectedTopics.map((t, i) => (
                  <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug" style={{ color: 'var(--color-fg)' }}>
                        {t.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.7)" strokeWidth="2">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                        <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                          热度 {t.heatScore.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )

    case 'RESEARCH':
      return (
        <div className="space-y-4">
          {detail.topic && (
            <div className="p-3 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-fg-muted)' }}>研究话题</p>
              <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>{detail.topic.title}</p>
            </div>
          )}
          {renderField('研究摘要', output.researchSummary as string)}
          {renderField('关键要点数', output.keyPointCount as number)}
          {(() => {
            const keyPoints = output.keyPoints as string[] | undefined
            return keyPoints && keyPoints.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-fg-muted)' }}>关键要点</p>
              <div className="space-y-1.5">
                {keyPoints.map((point, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'var(--color-primary-alpha)', color: 'var(--color-primary)' }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    <p className="text-sm leading-snug" style={{ color: 'var(--color-fg)' }}>{point}</p>
                  </div>
                ))}
              </div>
            </div>
            )
          })()}
          {(() => {
            const sources = output.sources as Array<{ title?: string; url?: string }> | undefined
            return sources && sources.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-fg-muted)' }}>参考资料</p>
              <div className="space-y-2">
                {sources.map((s, i) => (
                  <div key={i} className="p-3 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
                    <div className="flex items-start gap-2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2" className="shrink-0 mt-1">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--color-fg)' }}>{s.title}</p>
                        {s.url && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs mt-0.5 block truncate hover:underline"
                            style={{ color: 'var(--color-primary)' }}
                            title={s.url}
                          >
                            {s.url}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            )
          })()}
        </div>
      )

    case 'WRITE':
      return (
        <div className="space-y-4">
          {detail.content ? (
            <div className="space-y-3">
              <div className="p-4 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-fg-muted)' }}>生成标题</p>
                <p className="text-base font-bold leading-snug" style={{ color: 'var(--color-fg)' }}>
                  {detail.content.title || '(无标题)'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(22,163,74,0.08)' }}>
                  <p className="text-xl font-bold" style={{ color: 'var(--color-success)' }}>{detail.content.wordCount}</p>
                  <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>字数</p>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(124,43,238,0.08)' }}>
                  <p className="text-xl font-bold" style={{ color: 'var(--color-primary)' }}>
                    {(detail.content.wordCount / 350).toFixed(1)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>分钟阅读</p>
                </div>
              </div>
              {detail.content.summary && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-fg-muted)' }}>内容摘要</p>
                  <p className="text-sm leading-relaxed line-clamp-6" style={{ color: 'var(--color-fg)' }}>
                    {detail.content.summary}
                  </p>
                </div>
              )}
            </div>
          ) : renderField('生成结果', output)}
        </div>
      )

    case 'GENERATE_IMAGES':
      return (
        <div className="space-y-4">
          {renderField('生成图片数', output.imageCount as number)}
          {renderField('关联内容', output.contentId as string)}
        </div>
      )

    case 'REVIEW':
      return (
        <div className="space-y-4">
          {renderField('质量评分', output.score as number)}
          {renderField('是否通过', output.passed as boolean)}
          {(output.dimensionScores as Record<string, number> | undefined) && (
            <div className="p-3 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-fg-muted)' }}>各维度评分</p>
              <div className="space-y-2">
                {Object.entries(output.dimensionScores as Record<string, number>).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs w-16 shrink-0" style={{ color: 'var(--color-fg-muted)' }}>{key}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-tertiary)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(val / 10) * 100}%`,
                          background: val >= 7 ? 'var(--color-success)' : val >= 5 ? 'var(--color-warning)' : 'var(--color-error)',
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono w-8 text-right" style={{ color: 'var(--color-fg)' }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(() => {
            const issues = output.issues as string[] | undefined
            return issues && issues.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-error)' }}>发现问题</p>
              <div className="space-y-1.5">
                {issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'rgba(220,38,38,0.06)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" className="shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p className="text-xs leading-snug" style={{ color: 'var(--color-error)' }}>{issue}</p>
                  </div>
                ))}
              </div>
            </div>
            )
          })()}
          {(() => {
            const suggestions = output.suggestions as string[] | undefined
            return suggestions && suggestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-fg-muted)' }}>修改建议</p>
              <div className="space-y-1.5">
                {suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
                    <span className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold" style={{ background: 'var(--color-primary-alpha)', color: 'var(--color-primary)' }}>
                      {i + 1}
                    </span>
                    <p className="text-xs leading-snug" style={{ color: 'var(--color-fg)' }}>{s}</p>
                  </div>
                ))}
              </div>
            </div>
            )
          })()}
        </div>
      )

    case 'PUBLISH':
      return (
        <div className="space-y-4">
          {output.contentId ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-fg-muted)' }}>关联内容</p>
              <a
                href={`/contents/${output.contentId}`}
                className="inline-flex items-center gap-1.5 text-sm hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                {String(output.contentId)}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          ) : null}
          {renderField('微信 Media ID', output.mediaId as string)}
        </div>
      )

    case 'FULL_PIPELINE':
      return (
        <div className="space-y-4">
          {renderField('处理话题', output.topicId as string)}
          {renderField('写作尝试次数', output.attempts as number)}
          {output.reviewOutput ? renderField('审稿结果', `${(output.reviewOutput as { score: number }).score}/10`) : null}
        </div>
      )

    default:
      return (
        <div className="space-y-4">
          <pre className="text-xs p-3 rounded-xl overflow-x-auto whitespace-pre-wrap" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg)' }}>
            {JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )
  }
}

function StatusBadgeInline({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    SUCCESS: { bg: 'rgba(22,163,74,0.1)', text: 'var(--color-success)' },
    FAILED: { bg: 'rgba(220,38,38,0.1)', text: 'var(--color-error)' },
    RUNNING: { bg: 'rgba(59,130,246,0.1)', text: 'var(--color-info)' },
  }
  const s = styles[status] ?? { bg: 'var(--color-bg-tertiary)', text: 'var(--color-fg-subtle)' }
  const labels: Record<string, string> = {
    SUCCESS: '成功',
    FAILED: '失败',
    RUNNING: '进行中',
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: s.bg, color: s.text }}>
      {labels[status] ?? status}
    </span>
  )
}

function ErrorHint({ error }: { error: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs flex items-center gap-1"
        style={{ color: 'var(--color-error)' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        {expanded ? '收起' : '查看错误'}
      </button>
      {expanded && (
        <pre
          className="mt-1 p-2 rounded-lg text-xs overflow-x-auto"
          style={{
            background: 'rgba(220,38,38,0.06)',
            color: 'var(--color-error)',
            border: '1px solid rgba(220,38,38,0.15)',
            maxWidth: '320px',
            maxHeight: '120px',
            wordBreak: 'break-all',
          }}
        >
          {error}
        </pre>
      )}
    </div>
  )
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
