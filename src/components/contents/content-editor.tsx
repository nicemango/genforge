'use client'

import { useState } from 'react'
import { compileWechatArticle, type WechatLayoutConfig, type WechatThemeId } from '@/lib/wechat-layout'
import StatusBadge from '@/components/ui/status-badge'

interface Content {
  id: string
  title: string
  body: string
  images: string
  summary: string
  wordCount: number
  status: string
  reviewNotes: string
  wechatMediaId: string | null
  publishedAt: Date | null
  account: { id: string; name: string; wechatConfig: string; writingStyle: string }
  topic: { id: string; title: string } | null
}

export default function ContentEditor({ content }: { content: Content }) {
  const [title, setTitle] = useState(content.title)
  const [body, setBody] = useState(content.body)
  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [regeneratingImages, setRegeneratingImages] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)

  const reviewNotes = (() => {
    try {
      return JSON.parse(content.reviewNotes) as { score?: number; issues?: string[]; suggestions?: string[] }
    } catch {
      return {}
    }
  })()

  const imageSummary = (() => {
    try {
      const images = JSON.parse(content.images) as Array<{
        renderMode?: string
        qualityStatus?: string
        uploadStatus?: string
      }>
      return {
        total: images.length,
        ai: images.filter((img) => img.renderMode === 'ai').length,
        template: images.filter((img) => img.renderMode === 'template').length,
        downgraded: images.filter((img) => img.qualityStatus === 'downgraded').length,
        failed: images.filter((img) => img.qualityStatus === 'failed').length,
      }
    } catch {
      return null
    }
  })()

  const accountWechatConfig = (() => {
    try {
      return JSON.parse(content.account.wechatConfig) as {
        themeId?: WechatThemeId
        brandName?: string
        primaryColor?: string
        accentColor?: string
        titleAlign?: 'left' | 'center'
        showEndingCard?: boolean
        endingCardText?: string
        imageStyle?: 'rounded' | 'soft-shadow' | 'square'
      }
    } catch {
      return {}
    }
  })()

  const writingStyle = (() => {
    try {
      return JSON.parse(content.account.writingStyle) as { brandName?: string }
    } catch {
      return {}
    }
  })()

  const previewLayout: WechatLayoutConfig = {
    themeId: accountWechatConfig.themeId,
    brandName: accountWechatConfig.brandName ?? writingStyle.brandName,
    primaryColor: accountWechatConfig.primaryColor,
    accentColor: accountWechatConfig.accentColor,
    titleAlign: accountWechatConfig.titleAlign,
    showEndingCard: accountWechatConfig.showEndingCard,
    endingCardText: accountWechatConfig.endingCardText,
    imageStyle: accountWechatConfig.imageStyle,
  }

  const previewHtml = compileWechatArticle(body, {
    title: title || content.title || '未命名文章',
    summary: content.summary,
    layoutConfig: previewLayout,
  })

  async function handleSave() {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch(`/api/contents/${content.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      })
      if (!res.ok) throw new Error(await res.text())
      setMessage('已保存')
      setMessageType('success')
    } catch (err) {
      setMessage(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    setShowPublishConfirm(false)
    setPublishing(true)
    setMessage('')
    try {
      const res = await fetch(`/api/contents/${content.id}/publish`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setMessage('已推送到微信草稿箱')
      setMessageType('success')
    } catch (err) {
      setMessage(`发布失败: ${err instanceof Error ? err.message : String(err)}`)
      setMessageType('error')
    } finally {
      setPublishing(false)
    }
  }

  async function handleRegenerateImages() {
    setRegeneratingImages(true)
    setMessage('')
    try {
      const saveRes = await fetch(`/api/contents/${content.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      })
      if (!saveRes.ok) throw new Error(await saveRes.text())

      const res = await fetch(`/api/contents/${content.id}/images`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { content?: { body?: string }; imageCount?: number }

      if (data.content?.body) {
        setBody(data.content.body)
      }
      setMessage(`已重生成 ${data.imageCount ?? 0} 张配图`)
      setMessageType('success')
    } catch (err) {
      setMessage(`重生成配图失败: ${err instanceof Error ? err.message : String(err)}`)
      setMessageType('error')
    } finally {
      setRegeneratingImages(false)
    }
  }

  return (
    <div className="flex gap-4" style={{ minHeight: 0, flex: 1 }}>
      {/* ── Main Editor ── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <StatusBadge status={content.status} />
            <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>{content.account.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {message && (
              <span
                className="text-xs px-2 py-1 rounded-lg"
                style={{
                  color: messageType === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                  background: messageType === 'success' ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
                }}
              >
                {message}
              </span>
            )}
            <button onClick={handleSave} disabled={saving} className="btn btn-secondary">
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => setPreviewEnabled((value) => !value)}
              className="btn btn-secondary"
              type="button"
            >
              {previewEnabled ? '隐藏预览' : '显示预览'}
            </button>
            <button
              onClick={handleRegenerateImages}
              disabled={saving || regeneratingImages || publishing}
              className="btn btn-secondary"
              type="button"
            >
              {regeneratingImages ? '配图生成中...' : '重生成配图'}
            </button>
            {content.status === 'READY' && (
              <button
                onClick={() => setShowPublishConfirm(true)}
                disabled={publishing}
                className="btn btn-primary"
              >
                {publishing ? '发布中...' : '推送草稿箱'}
              </button>
            )}
          </div>
        </div>

        {/* Title Input */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input"
          style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-weight-semibold)' }}
          placeholder="文章标题"
        />

        {/* Body Textarea */}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="input"
          style={{ flex: 1, fontFamily: 'monospace', resize: 'none', minHeight: '480px' }}
          placeholder="Markdown 正文..."
        />

        <div className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
          {countWords(body)} 字
        </div>

        {previewEnabled && (
          <div className="card">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--color-fg)' }}>本地排版预览</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--color-fg-muted)' }}>
                  使用当前账号主题实时渲染，和推送到微信草稿箱走同一套排版引擎
                </p>
              </div>
              <div className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
                主题：{previewLayout.themeId ?? 'brand-clean'}
              </div>
            </div>

            <div className="wechat-preview-frame">
              <div className="wechat-preview-canvas">
                <div className="wechat-preview-article" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Sidebar ── */}
      <aside className="w-64 flex-shrink-0 space-y-3">
        {content.topic && (
          <div className="card">
            <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-fg-muted)' }}>关联话题</h3>
            <p className="text-sm" style={{ color: 'var(--color-fg)' }}>{content.topic.title}</p>
          </div>
        )}

        {reviewNotes.score !== undefined && (
          <div className="card">
            <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-fg-muted)' }}>审核结果</h3>
            <div
              className="text-2xl font-bold mb-2"
              style={{
                color: reviewNotes.score >= 7 ? 'var(--color-success)' : reviewNotes.score >= 5 ? 'var(--color-warning)' : 'var(--color-error)',
              }}
            >
              {reviewNotes.score}<span className="text-sm font-normal" style={{ color: 'var(--color-fg-muted)' }}>/10</span>
            </div>
            {reviewNotes.issues?.length ? (
              <div className="mb-2">
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-fg-muted)' }}>问题</p>
                <ul className="space-y-1">
                  {reviewNotes.issues.map((issue, i) => (
                    <li key={i} className="text-xs" style={{ color: 'var(--color-error)' }}>· {issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {reviewNotes.suggestions?.length ? (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-fg-muted)' }}>建议</p>
                <ul className="space-y-1">
                  {reviewNotes.suggestions.map((s, i) => (
                    <li key={i} className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>· {s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {content.wechatMediaId && (
          <div className="card">
            <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-fg-muted)' }}>微信草稿 ID</h3>
            <p className="text-xs break-all" style={{ color: 'var(--color-fg-subtle)', fontFamily: 'monospace' }}>
              {content.wechatMediaId}
            </p>
          </div>
        )}

        {imageSummary && imageSummary.total > 0 && (
          <div className="card">
            <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-fg-muted)' }}>配图状态</h3>
            <div className="space-y-1 text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
              <p>总数：{imageSummary.total}</p>
              <p>AI 图：{imageSummary.ai}</p>
              <p>模板图：{imageSummary.template}</p>
              <p>自动降级：{imageSummary.downgraded}</p>
              <p>失败：{imageSummary.failed}</p>
            </div>
          </div>
        )}
      </aside>

      {/* ── Publish Confirm Dialog ── */}
      {showPublishConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => e.target === e.currentTarget && setShowPublishConfirm(false)}
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
              <h3 className="font-semibold" style={{ color: 'var(--color-fg)' }}>推送到微信草稿箱</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--color-fg-muted)' }}>
                确认将「{title || '此文章'}」推送到微信草稿箱？
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={handlePublish} className="btn btn-primary flex-1">
                确认推送
              </button>
              <button onClick={() => setShowPublishConfirm(false)} className="btn btn-secondary flex-1">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function countWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const englishWords = text.match(/[a-zA-Z]+/g)?.length ?? 0
  return chineseChars + englishWords
}
