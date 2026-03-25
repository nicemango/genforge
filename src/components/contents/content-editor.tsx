'use client'

import { useState } from 'react'
import StatusBadge from '@/components/ui/status-badge'

interface Content {
  id: string
  title: string
  body: string
  summary: string
  wordCount: number
  status: string
  reviewNotes: string
  wechatMediaId: string | null
  publishedAt: Date | null
  account: { id: string; name: string }
  topic: { id: string; title: string } | null
}

export default function ContentEditor({ content }: { content: Content }) {
  const [title, setTitle] = useState(content.title)
  const [body, setBody] = useState(content.body)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState('')

  const reviewNotes = (() => {
    try {
      return JSON.parse(content.reviewNotes) as { score?: number; issues?: string[]; suggestions?: string[] }
    } catch {
      return {}
    }
  })()

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
    } catch (err) {
      setMessage(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!confirm('确认推送到微信草稿箱？')) return
    setPublishing(true)
    setMessage('')
    try {
      const res = await fetch(`/api/contents/${content.id}/publish`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setMessage('已推送到微信草稿箱')
    } catch (err) {
      setMessage(`发布失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="flex gap-4 h-full">
      <div className="flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={content.status} />
            <span className="text-xs text-gray-500">{content.account.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {message && <span className="text-xs text-gray-600">{message}</span>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            {content.status === 'READY' && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {publishing ? '发布中...' : '推送草稿箱'}
              </button>
            )}
          </div>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 text-lg font-medium border border-gray-200 rounded-md focus:outline-none focus:border-gray-400"
          placeholder="文章标题"
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="flex-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 font-mono resize-none"
          placeholder="Markdown 正文..."
          rows={30}
        />

        <div className="text-xs text-gray-500">
          {countWords(body)} 字
        </div>
      </div>

      <aside className="w-64 flex-shrink-0 space-y-3">
        {content.topic && (
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <h3 className="text-xs font-medium text-gray-700 mb-1">关联话题</h3>
            <p className="text-sm text-gray-600">{content.topic.title}</p>
          </div>
        )}

        {reviewNotes.score !== undefined && (
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <h3 className="text-xs font-medium text-gray-700 mb-2">审核结果</h3>
            <div className="text-2xl font-semibold text-gray-900 mb-2">{reviewNotes.score}/10</div>
            {reviewNotes.issues?.length ? (
              <div className="mb-2">
                <p className="text-xs text-gray-500 mb-1">问题</p>
                <ul className="space-y-1">
                  {reviewNotes.issues.map((issue, i) => (
                    <li key={i} className="text-xs text-red-600">- {issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {reviewNotes.suggestions?.length ? (
              <div>
                <p className="text-xs text-gray-500 mb-1">建议</p>
                <ul className="space-y-1">
                  {reviewNotes.suggestions.map((s, i) => (
                    <li key={i} className="text-xs text-gray-600">- {s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {content.wechatMediaId && (
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <h3 className="text-xs font-medium text-gray-700 mb-1">微信草稿</h3>
            <p className="text-xs text-gray-500 break-all">{content.wechatMediaId}</p>
          </div>
        )}
      </aside>
    </div>
  )
}

function countWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const englishWords = text.match(/[a-zA-Z]+/g)?.length ?? 0
  return chineseChars + englishWords
}
