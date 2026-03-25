'use client'

import { useState, useEffect, useCallback } from 'react'
import { PIPELINE_STEPS, STEP_MAP, type PipelineStepMeta } from '@/lib/pipeline-steps'

interface Topic {
  id: string
  title: string
  status: string
}

interface Account {
  id: string
  name: string
}

interface RunningTaskDetail {
  taskType: string
  startedAt: string
  topicId?: string
  topicTitle?: string | null
  accountName?: string
}

interface PipelineFlowProps {
  accounts: Account[]
  initialTopics?: Topic[]
  runningSteps?: string[]
  initialRunningDetails?: RunningTaskDetail[]
}

export default function PipelineFlow({
  accounts,
  initialTopics = [],
  runningSteps: initialRunning = [],
  initialRunningDetails = [],
}: PipelineFlowProps) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? '')
  const [topics, setTopics] = useState<Topic[]>(initialTopics)
  const [runningSteps, setRunningSteps] = useState<string[]>(initialRunning)
  const [runningDetails, setRunningDetails] = useState<RunningTaskDetail[]>(initialRunningDetails)
  const [hoveredStep, setHoveredStep] = useState<string | null>(null)
  const [activeDialog, setActiveDialog] = useState<{
    step: PipelineStepMeta
    topicId?: string
  } | null>(null)
  const [dialogMessage, setDialogMessage] = useState('')
  const [isLoadingTopics, setIsLoadingTopics] = useState(false)

  // Poll for running tasks every 3s
  useEffect(() => {
    if (runningSteps.length === 0) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/tasks?runningDetails=true', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json() as { runningSteps: string[]; runningDetails: RunningTaskDetail[] }
          setRunningSteps(data.runningSteps ?? [])
          setRunningDetails(data.runningDetails ?? [])
        }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [runningSteps.length])

  const loadTopics = useCallback(async () => {
    setIsLoadingTopics(true)
    try {
      // Fetch both PENDING and IN_PROGRESS topics separately since the API only supports exact match
      const [pendingRes, inProgressRes] = await Promise.all([
        fetch('/api/topics?status=PENDING', { cache: 'no-store' }),
        fetch('/api/topics?status=IN_PROGRESS', { cache: 'no-store' }),
      ])
      const [pendingData, inProgressData] = await Promise.all([
        pendingRes.ok ? pendingRes.json() as Promise<{ topics: Topic[] }> : { topics: [] },
        inProgressRes.ok ? inProgressRes.json() as Promise<{ topics: Topic[] }> : { topics: [] },
      ])
      const merged = [...pendingData.topics, ...inProgressData.topics]
        .sort((a, b) => a.title.localeCompare(b.title))
      setTopics(merged)
    } catch { /* ignore */ } finally {
      setIsLoadingTopics(false)
    }
  }, [])

  async function handleStepClick(step: PipelineStepMeta) {
    if (!selectedAccountId) {
      setDialogMessage('请先选择账号')
      setActiveDialog({ step })
      return
    }

    if (step.needsTopicId) {
      await loadTopics()
      if (topics.length === 0) {
        setDialogMessage('当前没有待处理的话题，请先运行「话题筛选」步骤')
        setActiveDialog({ step })
        return
      }
      setDialogMessage('')
      setActiveDialog({ step, topicId: topics[0]?.id })
    } else {
      setDialogMessage('')
      setActiveDialog({ step })
    }
  }

  async function handleConfirm() {
    if (!activeDialog) return
    const { step, topicId } = activeDialog

    setActiveDialog(null)
    setRunningSteps((prev) => [...prev, step.id])

    try {
      const endpoint = step.id === 'FULL_PIPELINE' ? '/api/pipeline/run' : '/api/pipeline/step'
      const body: Record<string, string> = { accountId: selectedAccountId }
      if (step.id !== 'FULL_PIPELINE') body.step = step.id
      if (topicId) body.topicId = topicId

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json() as { status: string; error?: string; taskRunId?: string }

      if (!res.ok || data.status === 'failed') {
        setDialogMessage(`任务失败: ${data.error ?? '未知错误'}`)
        setActiveDialog({ step })
      } else {
        setDialogMessage('任务已启动，请前往「任务」页面查看进度')
        setTimeout(() => {
          window.location.href = '/tasks'
        }, 1500)
      }
    } catch (err) {
      setDialogMessage(`请求失败: ${err instanceof Error ? err.message : String(err)}`)
      setActiveDialog({ step })
    } finally {
      setRunningSteps((prev) => prev.filter((s) => s !== step.id))
    }
  }

  // Hide FULL_PIPELINE from the horizontal flow (it's the big button)
  const flowSteps = PIPELINE_STEPS.filter((s) => s.id !== 'FULL_PIPELINE')

  return (
    <div className="space-y-5">
      {/* Header + Account selector */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>
            内容生产流水线
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-fg-muted)' }}>
            点击任意步骤立即执行，或一键启动完整流程
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            {accounts.length === 0 && <option value="">请先创建账号</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Pipeline Steps Flow */}
      <div className="relative">
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {flowSteps.map((step, index) => {
            const isRunning = runningSteps.includes(step.id)
            const isHovered = hoveredStep === step.id
            return (
              <div key={step.id} className="flex items-center shrink-0">
                {/* Step Node */}
                <div
                  className="relative flex flex-col items-center cursor-pointer group"
                  onMouseEnter={() => setHoveredStep(step.id)}
                  onMouseLeave={() => setHoveredStep(null)}
                  onClick={() => !isRunning && handleStepClick(step)}
                >
                  {/* Pulsing ring for running */}
                  {isRunning && (
                    <span
                      className="absolute inset-0 rounded-2xl animate-ping opacity-30"
                      style={{ background: step.color }}
                    />
                  )}

                  {/* Node */}
                  <div
                    className="relative w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200"
                    style={{
                      background: isRunning
                        ? step.color
                        : isHovered
                          ? `${step.color}22`
                          : 'var(--color-bg-secondary)',
                      border: `2px solid ${isRunning || isHovered ? step.color : 'var(--color-border)'}`,
                      boxShadow: isRunning
                        ? `0 0 16px ${step.color}66`
                        : isHovered
                          ? `0 4px 12px ${step.color}33`
                          : 'none',
                    }}
                  >
                    <StepIcon name={step.icon} color={isRunning ? '#fff' : step.color} />
                  </div>

                  {/* Label */}
                  <span
                    className="mt-2 text-xs font-medium whitespace-nowrap"
                    style={{ color: isRunning ? step.color : 'var(--color-fg)' }}
                  >
                    {step.label}
                  </span>

                  {/* Step number */}
                  <span
                    className="absolute -top-1 -left-1 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center"
                    style={{
                      background: step.color,
                      color: '#fff',
                      fontSize: '10px',
                    }}
                  >
                    {index + 1}
                  </span>

                  {/* Tooltip */}
                  {isHovered && !activeDialog && (
                    <div
                      className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 w-56 p-3 rounded-xl shadow-xl text-xs"
                      style={{
                        background: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-fg)',
                        pointerEvents: 'none',
                      }}
                    >
                      <p className="font-semibold mb-1" style={{ color: 'var(--color-fg)' }}>
                        {step.label}
                      </p>
                      <p style={{ color: 'var(--color-fg-muted)' }}>{step.description}</p>
                      {step.dependencies.length > 0 && (
                        <p className="mt-1.5" style={{ color: 'var(--color-primary)' }}>
                          依赖: {step.dependencies.map((d) => STEP_MAP[d]?.label ?? d).join('、')}
                        </p>
                      )}
                      {step.needsTopicId && (
                        <p className="mt-1" style={{ color: 'var(--color-fg-subtle)' }}>
                          需要先选择话题
                        </p>
                      )}
                      <p className="mt-1.5" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                        点击执行
                      </p>
                    </div>
                  )}
                </div>

                {/* Arrow */}
                {index < flowSteps.length - 1 && (
                  <div className="flex items-center mx-1 shrink-0">
                    <svg width="20" height="12" viewBox="0 0 20 12" fill="none">
                      <path
                        d="M0 6H16M16 6L11 1M16 6L11 11"
                        stroke="var(--color-border)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Running Steps Detail Panel */}
      {runningSteps.length > 0 && runningDetails.length > 0 && (
        <RunningDetailPanel details={runningDetails} />
      )}

      {/* Full Pipeline CTA */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => handleStepClick(STEP_MAP['FULL_PIPELINE'])}
          disabled={runningSteps.includes('FULL_PIPELINE') || accounts.length === 0}
          className="btn btn-primary text-sm px-5 py-2.5 flex items-center gap-2"
        >
          {runningSteps.includes('FULL_PIPELINE') ? (
            <>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              运行中...
            </>
          ) : (
            <>
              <ZapIcon />
              一键启动完整流程
            </>
          )}
        </button>
        <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
          自动执行全部 7 个步骤，无需手动干预
        </span>
      </div>

      {/* Dialog */}
      {activeDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => e.target === e.currentTarget && setActiveDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${activeDialog.step.color}22` }}
              >
                <StepIcon name={activeDialog.step.icon} color={activeDialog.step.color} />
              </div>
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--color-fg)' }}>
                  执行「{activeDialog.step.label}」
                </h3>
                <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                  {activeDialog.step.description}
                </p>
              </div>
            </div>

            {/* Topic selector for steps needing topicId */}
            {activeDialog.step.needsTopicId && (
              <div>
                <label className="label">选择话题</label>
                <select
                  value={activeDialog.topicId ?? ''}
                  onChange={(e) => setActiveDialog((d) => d ? { ...d, topicId: e.target.value } : null)}
                  className="input w-full"
                >
                  {isLoadingTopics && <option value="">加载中...</option>}
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({t.status === 'PENDING' ? '待处理' : '进行中'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Account display */}
            <div>
              <label className="label">执行账号</label>
              <p className="text-sm" style={{ color: 'var(--color-fg)' }}>
                {accounts.find((a) => a.id === selectedAccountId)?.name ?? '未选择'}
              </p>
            </div>

            {/* Message */}
            {dialogMessage && (
              <div
                className="px-4 py-3 rounded-lg text-sm"
                style={{
                  background: dialogMessage.includes('失败') || dialogMessage.includes('错误')
                    ? 'rgba(220,38,38,0.08)'
                    : 'rgba(22,163,74,0.08)',
                  color: dialogMessage.includes('失败') || dialogMessage.includes('错误')
                    ? 'var(--color-error)'
                    : 'var(--color-success)',
                }}
              >
                {dialogMessage}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleConfirm}
                className="btn btn-primary flex-1"
                disabled={activeDialog.step.needsTopicId && !activeDialog.topicId}
              >
                确认执行
              </button>
              <button
                onClick={() => { setActiveDialog(null); setDialogMessage('') }}
                className="btn btn-secondary flex-1"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StepIcon({ name, color }: { name: string; color: string }) {
  const props = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (name) {
    case 'rss':
      return <svg {...props}><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
    case 'target':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
    case 'search':
      return <svg {...props}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    case 'pen':
      return <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
    case 'image':
      return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    case 'check':
      return <svg {...props}><path d="M20 6 9 17l-5-5"/></svg>
    case 'send':
      return <svg {...props}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    case 'zap':
      return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    default:
      return <svg {...props}><circle cx="12" cy="12" r="10"/></svg>
  }
}

function ZapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  )
}

// ─── Running Detail Panel ──────────────────────────────────────────────────────

function RunningDetailPanel({ details }: { details: RunningTaskDetail[] }) {
  const [elapsed, setElapsed] = useState<Record<string, string>>({})

  useEffect(() => {
    function update() {
      const now = Date.now()
      const next: Record<string, string> = {}
      for (const d of details) {
        const ms = now - new Date(d.startedAt).getTime()
        next[d.taskType] = formatDuration(ms)
      }
      setElapsed(next)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [details])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ background: 'var(--color-primary)' }}
        />
        <span className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>
          正在执行 ({details.length})
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {details.map((d) => {
          const stepMeta = STEP_MAP[d.taskType]
          return (
            <div
              key={d.taskType}
              className="p-3 rounded-xl transition-all duration-300"
              style={{
                background: `${stepMeta?.color ?? 'var(--color-primary)'}14`,
                border: `1.5px solid ${stepMeta?.color ?? 'var(--color-primary)'}33`,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StepIcon name={stepMeta?.icon ?? 'circle'} color={stepMeta?.color ?? 'var(--color-primary)'} />
                  <span className="font-semibold text-sm" style={{ color: 'var(--color-fg)' }}>
                    {stepMeta?.label ?? d.taskType}
                  </span>
                </div>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full"
                  style={{
                    background: `${stepMeta?.color ?? 'var(--color-primary)'}22`,
                    color: stepMeta?.color ?? 'var(--color-primary)',
                  }}
                >
                  {elapsed[d.taskType] ?? '0s'}
                </span>
              </div>

              {/* Description */}
              <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--color-fg-muted)' }}>
                {stepMeta?.description}
              </p>

              {/* Meta */}
              <div className="flex flex-wrap gap-1.5">
                {d.topicTitle && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg-muted)' }}
                  >
                    话题: {d.topicTitle.length > 20 ? d.topicTitle.slice(0, 20) + '...' : d.topicTitle}
                  </span>
                )}
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg-muted)' }}
                >
                  账号: {d.accountName}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: `${stepMeta?.color ?? 'var(--color-primary)'}22`, color: stepMeta?.color ?? 'var(--color-primary)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'currentColor' }} />
                  运行中
                </span>
              </div>

              {/* Progress bar */}
              <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
                <div
                  className="h-full rounded-full animate-pulse"
                  style={{
                    background: `${stepMeta?.color ?? 'var(--color-primary)'}88`,
                    width: '60%',
                    animation: 'pulse-bar 2s ease-in-out infinite',
                  }}
                />
              </div>

              {/* Dependencies */}
              {stepMeta?.dependencies && stepMeta.dependencies.length > 0 && (
                <p className="mt-2 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                  依赖: {stepMeta.dependencies.map((dep) => STEP_MAP[dep]?.label ?? dep).join(' → ')}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${s}s`
}
