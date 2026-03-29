'use client'

import { STEP_MAP } from '@/lib/pipeline-steps'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskDetail {
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

// ─── Inline Result View ───────────────────────────────────────────────────────

interface WriterTaskOutput {
  contentId?: string
  title?: string
  body?: string
  summary?: string
  wordCount?: number
  outline?: {
    titles?: string[]
    hook?: string
    sections?: Array<{ title?: string; corePoint?: string }>
    ending?: string
  }
  draft?: Array<{ sectionTitle?: string; content?: string }>
  rewrite?: Array<{
    sectionTitle?: string
    emotional?: string
    rational?: string
    casual?: string
    selectedStyle?: string
  }>
  final?: {
    title?: string
    content?: string
  }
  scores?: Array<{
    attempt?: number
    metrics?: {
      engagement?: number
      realism?: number
      emotion?: number
      value?: number
    }
    issues?: string[]
    optimizations?: string[]
    passed?: boolean
  }>
}
interface InlineResultViewProps {
  detail: TaskDetail
}

export function InlineResultView({ detail }: InlineResultViewProps) {
  const stepMeta = detail ? STEP_MAP[detail.taskType] : null

  if (detail.error) {
    return (
      <div className="p-4 rounded-xl" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-error)' }}>执行失败</p>
        <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-error)' }}>
          {detail.error}
        </pre>
      </div>
    )
  }

  if (!detail.parsedOutput) {
    return (
      <div className="text-center py-6">
        <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>
          暂无{stepMeta?.label ?? '任务'}输出数据
        </p>
      </div>
    )
  }

  return <ParsedOutputView detail={detail} />
}

// ─── Parsed Output View ───────────────────────────────────────────────────────

function ParsedOutputView({ detail }: { detail: TaskDetail }) {
  const output = detail.parsedOutput as Record<string, unknown>

  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0

  const renderSimpleList = (items: string[]) => (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div key={`${item}-${index}`} className="flex items-start gap-2">
          <span
            className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: 'var(--color-primary)' }}
          />
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>
            {item}
          </p>
        </div>
      ))}
    </div>
  )

  const renderField = (label: string, value: unknown) => {
    if (value == null) return null

    if (typeof value === 'string' && value.trim() === '') {
      return null
    }

    const content =
      typeof value === 'object'
        ? JSON.stringify(value, null, 2)
        : typeof value === 'boolean'
          ? value ? '是' : '否'
          : String(value)

    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-fg-muted)' }}>
          {label}
        </p>
        {typeof value === 'object' ? (
          <pre
            className="text-xs p-3 rounded-xl overflow-x-auto whitespace-pre-wrap"
            style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg)' }}
          >
            {content}
          </pre>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-fg)' }}>
            {content}
          </p>
        )}
      </div>
    )
  }

  const renderWriterStructuredView = (writerOutput: WriterTaskOutput) => {
    const outline = writerOutput.outline
    const draft = Array.isArray(writerOutput.draft) ? writerOutput.draft : []
    const rewrite = Array.isArray(writerOutput.rewrite) ? writerOutput.rewrite : []
    const finalResult = writerOutput.final
    const scores = Array.isArray(writerOutput.scores) ? writerOutput.scores : []
    const hasStructuredData = Boolean(outline || draft.length || rewrite.length || finalResult || scores.length)

    if (!hasStructuredData) return null

    return (
      <div className="space-y-4">
        <div className="p-4 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-fg-muted)' }}>生成标题</p>
          <p className="text-base font-bold leading-snug" style={{ color: 'var(--color-fg)' }}>
            {writerOutput.title || finalResult?.title || detail.content?.title || '(无标题)'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(22,163,74,0.08)' }}>
            <p className="text-xl font-bold" style={{ color: 'var(--color-success)' }}>
              {writerOutput.wordCount ?? detail.content?.wordCount ?? 0}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>字数</p>
          </div>
          <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(124,43,238,0.08)' }}>
            <p className="text-xl font-bold" style={{ color: 'var(--color-primary)' }}>
              {(((writerOutput.wordCount ?? detail.content?.wordCount ?? 0) || 0) / 350).toFixed(1)}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>分钟阅读</p>
          </div>
        </div>

        {isNonEmptyString(writerOutput.summary) && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-fg-muted)' }}>内容摘要</p>
            <p className="text-sm leading-relaxed line-clamp-6" style={{ color: 'var(--color-fg)' }}>
              {writerOutput.summary}
            </p>
          </div>
        )}

        {outline && (
          <div className="p-4 rounded-xl space-y-4" style={{ background: 'var(--color-bg-secondary)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-muted)' }}>Outline</p>
            {Array.isArray(outline.titles) && outline.titles.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-fg-muted)' }}>标题候选</p>
                {renderSimpleList(outline.titles.filter(isNonEmptyString))}
              </div>
            )}
            {isNonEmptyString(outline.hook) && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-fg-muted)' }}>Hook</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>{outline.hook}</p>
              </div>
            )}
            {Array.isArray(outline.sections) && outline.sections.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-fg-muted)' }}>章节结构</p>
                <div className="space-y-2">
                  {outline.sections.map((section, index) => (
                    <div key={`${section.title ?? 'section'}-${index}`} className="p-3 rounded-lg" style={{ background: 'var(--color-bg-tertiary)' }}>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>
                        {index + 1}. {section.title || '(无标题)'}
                      </p>
                      {isNonEmptyString(section.corePoint) && (
                        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>
                          {section.corePoint}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isNonEmptyString(outline.ending) && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-fg-muted)' }}>结尾策略</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-fg)' }}>{outline.ending}</p>
              </div>
            )}
          </div>
        )}

        {draft.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-muted)' }}>Draft</p>
            {draft.map((section, index) => (
              <div key={`${section.sectionTitle ?? 'draft'}-${index}`} className="p-4 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
                <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-fg)' }}>{section.sectionTitle || `章节 ${index + 1}`}</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-fg)' }}>
                  {section.content || '(无内容)'}
                </p>
              </div>
            ))}
          </div>
        )}

        {rewrite.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-muted)' }}>Rewrite</p>
            {rewrite.map((section, index) => (
              <div key={`${section.sectionTitle ?? 'rewrite'}-${index}`} className="p-4 rounded-xl space-y-3" style={{ background: 'var(--color-bg-secondary)' }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>{section.sectionTitle || `章节 ${index + 1}`}</p>
                  {isNonEmptyString(section.selectedStyle) && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'var(--color-primary-alpha)', color: 'var(--color-primary)' }}>
                      选中 {section.selectedStyle}
                    </span>
                  )}
                </div>
                {([
                  ['emotional', section.emotional],
                  ['rational', section.rational],
                  ['casual', section.casual],
                ] as const).map(([label, content]) => (
                  isNonEmptyString(content) && (
                    <div key={label}>
                      <p className="text-xs font-semibold mb-1.5 uppercase" style={{ color: 'var(--color-fg-muted)' }}>{label}</p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-fg)' }}>{content}</p>
                    </div>
                  )
                ))}
              </div>
            ))}
          </div>
        )}

        {finalResult && (
          <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--color-bg-secondary)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-muted)' }}>Final</p>
            {isNonEmptyString(finalResult.title) && (
              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-fg-muted)' }}>最终标题</p>
                <p className="text-base font-bold leading-snug" style={{ color: 'var(--color-fg)' }}>{finalResult.title}</p>
              </div>
            )}
            {isNonEmptyString(finalResult.content) && (
              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-fg-muted)' }}>正文预览</p>
                <pre className="text-xs whitespace-pre-wrap overflow-x-auto" style={{ color: 'var(--color-fg)' }}>
                  {finalResult.content.slice(0, 4000)}
                </pre>
                {finalResult.content.length > 4000 && (
                  <p className="text-xs mt-2" style={{ color: 'var(--color-fg-subtle)' }}>正文过长，已截断显示前 4000 个字符</p>
                )}
              </div>
            )}
          </div>
        )}

        {scores.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-muted)' }}>Scores</p>
            {scores.map((score, index) => (
              <div key={`score-${score.attempt ?? index}`} className="p-4 rounded-xl space-y-3" style={{ background: 'var(--color-bg-secondary)' }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>第 {score.attempt ?? index + 1} 轮</p>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={{
                      background: score.passed ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.12)',
                      color: score.passed ? 'var(--color-success)' : 'var(--color-warning)',
                    }}
                  >
                    {score.passed ? '通过' : '待优化'}
                  </span>
                </div>
                {score.metrics && (
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(score.metrics).map(([key, value]) => (
                      <div key={key} className="p-2 rounded-lg" style={{ background: 'var(--color-bg-tertiary)' }}>
                        <p className="text-xs uppercase" style={{ color: 'var(--color-fg-muted)' }}>{key}</p>
                        <p className="text-sm font-mono mt-1" style={{ color: 'var(--color-fg)' }}>{value ?? '-'}</p>
                      </div>
                    ))}
                  </div>
                )}
                {Array.isArray(score.issues) && score.issues.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-error)' }}>问题</p>
                    {renderSimpleList(score.issues.filter(isNonEmptyString))}
                  </div>
                )}
                {Array.isArray(score.optimizations) && score.optimizations.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-fg-muted)' }}>优化方向</p>
                    {renderSimpleList(score.optimizations.filter(isNonEmptyString))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }


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

    case 'WRITE': {
      const writerOutput = output as WriterTaskOutput
      const structuredView = renderWriterStructuredView(writerOutput)

      return (
        <div className="space-y-4">
          {structuredView ?? (
            detail.content ? (
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
            ) : renderField('生成结果', output)
          )}
        </div>
      )
    }

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
