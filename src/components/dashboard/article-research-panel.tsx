'use client'

import { useState } from 'react'

interface Account {
  id: string
  name: string
}

interface ArticleAnalysis {
  summary: string
  keywords: string[]
  entities: string[]
  contentAngle: string
  suggestedTopics: string[]
}

interface RelatedItem {
  title: string
  link: string
  pubDate: string
  snippet: string
  source: string
}

interface ResearchResult {
  articleAnalysis: ArticleAnalysis
  relatedItems: RelatedItem[]
  fetchedAt: string
  stats: {
    total: number
    success: number
    failed: number
    timedOut: number
    topicFiltered: number
  }
}

export default function ArticleResearchPanel({ accounts }: { accounts: Account[] }) {
  const [inputType, setInputType] = useState<'url' | 'text'>('url')
  const [input, setInput] = useState('')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResearchResult | null>(null)

  async function handleSubmit() {
    const trimmed = input.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/article-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: trimmed,
          inputType,
          accountId: accountId || undefined,
        }),
      })

      const data = await res.json() as ResearchResult & { error?: string }

      if (!res.ok) {
        setError(data.error ?? `请求失败 (${res.status})`)
        return
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card card-hover space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-primary-alpha)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
        </div>
        <h2
          className="text-lg font-semibold"
          style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}
        >
          文章研究
        </h2>
      </div>

      {/* Account selector */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-muted)" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg text-sm border focus-ring"
            style={{
              background: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-fg)',
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Input type tabs */}
      <div
        className="inline-flex gap-1 p-1 rounded-xl"
        style={{ background: 'var(--color-bg-secondary)' }}
      >
        {(['url', 'text'] as const).map((type) => (
          <button
            key={type}
            onClick={() => { setInputType(type); setInput('') }}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2"
            style={
              inputType === type
                ? {
                    background: 'var(--color-card)',
                    color: 'var(--color-primary)',
                    boxShadow: 'var(--shadow-xs)',
                  }
                : { color: 'var(--color-fg-muted)' }
            }
          >
            {type === 'url' ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                链接
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <line x1="10" y1="9" x2="8" y2="9"/>
                </svg>
                文本
              </>
            )}
          </button>
        ))}
      </div>

      {/* Input area */}
      {inputType === 'url' ? (
        <input
          type="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="https://example.com/article"
          className="w-full px-3 py-2 rounded-lg text-sm border"
          style={{
            background: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-fg)',
          }}
        />
      ) : (
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴文章正文..."
          rows={5}
          className="w-full px-3 py-2 rounded-lg text-sm border resize-none"
          style={{
            background: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-fg)',
          }}
        />
      )}

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="btn btn-primary"
          style={loading || !input.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
        >
          {loading ? (
            <>
              <Spinner />
              分析中...
            </>
          ) : (
            <>
              <SearchIcon />
              开始分析
            </>
          )}
        </button>
        {result && !loading && (
          <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
            找到 {result.relatedItems.length} 篇相关文章
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="px-4 py-3 rounded-lg text-sm"
          style={{ background: 'rgba(220, 38, 38, 0.08)', color: 'var(--color-error)' }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && <ResearchResultView result={result} />}
    </div>
  )
}

function ResearchResultView({ result }: { result: ResearchResult }) {
  const { articleAnalysis: a, relatedItems, stats } = result
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? relatedItems : relatedItems.slice(0, 5)

  return (
    <div className="space-y-4 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
      {/* Analysis */}
      <div className="space-y-3">
        {/* Summary */}
        <div>
          <Label>摘要</Label>
          <p className="text-sm mt-1" style={{ color: 'var(--color-fg)', lineHeight: 'var(--leading-relaxed)' }}>
            {a.summary}
          </p>
        </div>

        {/* Content Angle */}
        {a.contentAngle && (
          <div>
            <Label>核心观点</Label>
            <p
              className="text-sm mt-1 px-3 py-2 rounded-lg italic"
              style={{ background: 'var(--color-primary-alpha)', color: 'var(--color-primary)' }}
            >
              {a.contentAngle}
            </p>
          </div>
        )}

        {/* Keywords */}
        {a.keywords.length > 0 && (
          <div>
            <Label>关键词</Label>
            <TagList tags={a.keywords} color="primary" />
          </div>
        )}

        {/* Entities */}
        {a.entities.length > 0 && (
          <div>
            <Label>核心实体</Label>
            <TagList tags={a.entities} color="neutral" />
          </div>
        )}

        {/* Suggested Topics */}
        {a.suggestedTopics.length > 0 && (
          <div>
            <Label>建议研究方向</Label>
            <TagList tags={a.suggestedTopics} color="success" />
          </div>
        )}
      </div>

      {/* Related Articles */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>
            相关文章
            <span
              className="ml-2 px-1.5 py-0.5 rounded text-xs font-normal"
              style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-fg-muted)' }}
            >
              {relatedItems.length}
            </span>
          </Label>
          <span className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
            成功 {stats.success}/{stats.total} 源
            {stats.timedOut > 0 && `，${stats.timedOut} 超时`}
          </span>
        </div>

        {relatedItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>未找到相关文章</p>
        ) : (
          <div className="space-y-2">
            {visibleItems.map((item, i) => (
              <a
                key={i}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-lg transition-all duration-200 hover:translate-y-[-1px]"
                style={{
                  background: 'var(--color-bg-secondary)',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug" style={{ color: 'var(--color-fg)' }}>
                    {item.title}
                  </p>
                  <span
                    className="shrink-0 text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: 'var(--color-primary-alpha)',
                      color: 'var(--color-primary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.source}
                  </span>
                </div>
                {item.snippet && (
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-fg-muted)' }}>
                    {item.snippet}
                  </p>
                )}
              </a>
            ))}

            {relatedItems.length > 5 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-full py-2 text-sm rounded-lg transition-colors duration-200"
                style={{ color: 'var(--color-primary)', background: 'var(--color-primary-alpha)' }}
              >
                {expanded ? '收起' : `展开全部 ${relatedItems.length} 篇`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-fg-muted)' }}>
      {children}
    </p>
  )
}

function TagList({ tags, color }: { tags: string[]; color: 'primary' | 'neutral' | 'success' }) {
  const styles = {
    primary: { background: 'var(--color-primary-alpha)', color: 'var(--color-primary)' },
    neutral: { background: 'var(--color-bg-tertiary)', color: 'var(--color-fg-muted)' },
    success: { background: 'rgba(22, 163, 74, 0.1)', color: 'var(--color-success)' },
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={styles[color]}
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}
