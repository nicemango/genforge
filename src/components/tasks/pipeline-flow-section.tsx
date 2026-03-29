'use client'

import { useState, useEffect, useCallback } from 'react'
import { PIPELINE_STEPS, STEP_MAP, type PipelineStepMeta } from '@/lib/pipeline-steps'

interface Topic {
  id: string
  title: string
  status: string
}

interface RunningDetail {
  taskType: string
  startedAt: string
  topicId?: string
  topicTitle?: string | null
}

interface PipelineFlowSectionProps {
  selectedAccountId: string
  runningDetails: RunningDetail[]
  onStepExecute: (stepId: string, topicId?: string) => Promise<void>
  disabled?: boolean
}

export default function PipelineFlowSection({
  selectedAccountId,
  runningDetails,
  onStepExecute,
  disabled = false,
}: PipelineFlowSectionProps) {
  const [hoveredStep, setHoveredStep] = useState<string | null>(null)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [isLoadingTopics, setIsLoadingTopics] = useState(false)
  const [selectedTopicId, setSelectedTopicId] = useState<string>('')
  const [topicError, setTopicError] = useState<string>('')
  const [executingStep, setExecutingStep] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<Record<string, string>>({})

  const flowSteps = PIPELINE_STEPS.filter((s) => s.id !== 'FULL_PIPELINE')

  const loadTopics = useCallback(async () => {
    setIsLoadingTopics(true)
    setTopicError('')
    try {
      const [pendingRes, inProgressRes] = await Promise.all([
        fetch('/api/topics?status=PENDING', { cache: 'no-store' }),
        fetch('/api/topics?status=IN_PROGRESS', { cache: 'no-store' }),
      ])
      const [pendingData, inProgressData] = await Promise.all([
        pendingRes.ok ? pendingRes.json() as Promise<{ topics: Topic[] }> : { topics: [] },
        inProgressRes.ok ? inProgressRes.json() as Promise<{ topics: Topic[] }> : { topics: [] },
      ])
      const merged = [...pendingData.topics, ...inProgressData.topics].sort((a, b) =>
        a.title.localeCompare(b.title),
      )
      setTopics(merged)
      if (merged.length > 0 && !selectedTopicId) {
        setSelectedTopicId(merged[0].id)
      }
    } catch {
      setTopicError('加载话题失败')
    } finally {
      setIsLoadingTopics(false)
    }
  }, [selectedTopicId])

  useEffect(() => {
    const details = runningDetails
    if (details.length === 0) return

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
  }, [runningDetails])

  function handleStepClick(step: PipelineStepMeta) {
    if (disabled) return
    const runningStepIds = runningDetails.map((d) => d.taskType)
    if (runningStepIds.includes(step.id)) return

    if (step.needsTopicId) {
      setActiveDropdown(step.id)
      loadTopics()
      setTopicError('')
    } else {
      setActiveDropdown(null)
      setExecutingStep(step.id)
      onStepExecute(step.id).finally(() => setExecutingStep(null))
    }
  }

  function handleDropdownSelect(step: PipelineStepMeta) {
    if (!selectedAccountId) {
      setTopicError('请先选择账号')
      return
    }
    if (!selectedTopicId) {
      setTopicError('请先选择话题')
      return
    }
    setActiveDropdown(null)
    setExecutingStep(step.id)
    onStepExecute(step.id, selectedTopicId).finally(() => setExecutingStep(null))
  }

  function closeDropdown() {
    setActiveDropdown(null)
    setTopicError('')
  }

  function isStepRunning(stepId: string): boolean {
    return runningDetails.some((d) => d.taskType === stepId)
  }

  function isStepExecuting(stepId: string): boolean {
    return executingStep === stepId
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>
          内容生产流水线
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-fg-muted)' }}>
          点击任意步骤立即执行
        </p>
      </div>

      <div className="relative">
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {flowSteps.map((step, index) => {
            const isRunning = isStepRunning(step.id)
            const isExecuting = isStepExecuting(step.id)
            const isActive = isRunning || isExecuting
            const isHovered = hoveredStep === step.id
            const showDropdown = activeDropdown === step.id

            return (
              <div key={step.id} className="flex items-start shrink-0">
                <div className="relative flex flex-col items-center">
                  <div
                    className="relative flex flex-col items-center cursor-pointer group"
                    onMouseEnter={() => setHoveredStep(step.id)}
                    onMouseLeave={() => setHoveredStep(null)}
                    onClick={() => !isActive && handleStepClick(step)}
                  >
                    {isActive && (
                      <span
                        className="absolute inset-0 rounded-xl animate-ping opacity-25"
                        style={{ background: step.color }}
                      />
                    )}

                    <div
                      className="relative w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-200"
                      style={{
                        background: isActive
                          ? step.color
                          : isHovered
                            ? `${step.color}22`
                            : 'var(--color-bg-secondary)',
                        border: `2px solid ${isActive || isHovered ? step.color : 'var(--color-border)'}`,
                        boxShadow: isActive
                          ? `0 0 16px ${step.color}66`
                          : isHovered
                            ? `0 4px 12px ${step.color}33`
                            : 'none',
                        opacity: disabled ? 0.5 : 1,
                      }}
                    >
                      <StepIcon
                        name={step.icon}
                        color={isActive ? '#fff' : step.color}
                        loading={isExecuting}
                      />

                      {isActive && elapsed[step.id] && (
                        <span
                          className="absolute -bottom-1 -right-1 text-xs font-mono px-1.5 py-0.5 rounded-full"
                          style={{
                            background: 'var(--color-bg)',
                            color: isActive ? step.color : 'var(--color-fg-muted)',
                            fontSize: '9px',
                            border: `1px solid ${step.color}66`,
                          }}
                        >
                          {elapsed[step.id]}
                        </span>
                      )}
                    </div>

                    <span
                      className="mt-1.5 text-xs font-medium whitespace-nowrap"
                      style={{ color: isActive ? step.color : 'var(--color-fg)' }}
                    >
                      {step.label}
                    </span>

                    <span
                      className="absolute -top-1 -left-1 w-4 h-4 rounded-full text-xs font-bold flex items-center justify-center"
                      style={{
                        background: step.color,
                        color: '#fff',
                        fontSize: '9px',
                      }}
                    >
                      {index + 1}
                    </span>

                    {isHovered && !showDropdown && !isActive && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 z-50 w-52 p-3 rounded-xl shadow-xl text-xs pointer-events-none"
                        style={{
                          background: 'var(--color-card)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-fg)',
                          top: 'calc(100% + 8px)',
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

                  {showDropdown && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 z-50 w-56 mt-2 rounded-xl shadow-xl text-xs"
                      style={{
                        background: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        top: '100%',
                      }}
                    >
                      <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold" style={{ color: 'var(--color-fg)' }}>
                            选择话题
                          </span>
                          <button
                            onClick={closeDropdown}
                            className="w-5 h-5 flex items-center justify-center rounded"
                            style={{ color: 'var(--color-fg-muted)' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/>
                              <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>

                        <select
                          value={selectedTopicId}
                          onChange={(e) => setSelectedTopicId(e.target.value)}
                          disabled={isLoadingTopics}
                          className="w-full px-2 py-1.5 rounded-lg text-xs border"
                          style={{
                            background: 'var(--color-bg-secondary)',
                            borderColor: 'var(--color-border)',
                            color: 'var(--color-fg)',
                          }}
                        >
                          {isLoadingTopics && <option value="">加载中...</option>}
                          {!isLoadingTopics && topics.length === 0 && <option value="">暂无可用话题</option>}
                          {topics.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title} ({t.status === 'PENDING' ? '待处理' : '进行中'})
                            </option>
                          ))}
                        </select>

                        {topicError && (
                          <p className="text-xs" style={{ color: 'var(--color-error)' }}>
                            {topicError}
                          </p>
                        )}

                        <button
                          onClick={() => handleDropdownSelect(step)}
                          disabled={isLoadingTopics || (!isLoadingTopics && topics.length === 0)}
                          className="w-full py-1.5 rounded-lg text-xs font-medium transition-all"
                          style={{
                            background: 'var(--color-primary)',
                            color: '#fff',
                            opacity:
                              isLoadingTopics || (!isLoadingTopics && topics.length === 0) ? 0.5 : 1,
                          }}
                        >
                          确认执行
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {index < flowSteps.length - 1 && (
                  <div className="flex items-center mx-1 shrink-0 mt-5">
                    <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
                      <path
                        d="M0 5H12M12 5L8 1M12 5L8 9"
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

      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (!disabled) {
              setExecutingStep('FULL_PIPELINE')
              onStepExecute('FULL_PIPELINE').finally(() => setExecutingStep(null))
            }
          }}
          disabled={disabled || isStepRunning('FULL_PIPELINE') || isStepExecuting('FULL_PIPELINE')}
          className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-all"
          style={{
            background: 'var(--color-primary)',
            color: '#fff',
            opacity:
              disabled || isStepRunning('FULL_PIPELINE') || isStepExecuting('FULL_PIPELINE')
                ? 0.5
                : 1,
          }}
        >
          {(isStepRunning('FULL_PIPELINE') || isStepExecuting('FULL_PIPELINE')) ? (
            <>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
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
          自动执行全部 7 个步骤
        </span>
      </div>
    </div>
  )
}

function StepIcon({ name, color, loading }: { name: string; color: string; loading?: boolean }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (loading) {
    return (
      <svg {...props} className="animate-spin">
        <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
      </svg>
    )
  }

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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
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
