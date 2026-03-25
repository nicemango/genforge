'use client'

import { useState } from 'react'
import type { AccountRecord, FrontendModelConfig, FrontendWechatConfig, FrontendWritingStyle } from '@/types/accounts'

// Alias for local use
type Account = AccountRecord
type ModelConfig = FrontendModelConfig
type WechatConfig = FrontendWechatConfig
type WritingStyle = FrontendWritingStyle

export default function AccountsClient({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [form, setForm] = useState({
    name: '',
    apiKey: '',
    baseURL: '',
    defaultModel: 'claude-sonnet-4-6',
    appId: '',
    appSecret: '',
    tone: '专业但通俗',
    length: '1500-2500字',
  })

  function startEdit(account: Account) {
    const mc = JSON.parse(account.modelConfig) as ModelConfig
    const wc = JSON.parse(account.wechatConfig) as WechatConfig
    const ws = JSON.parse(account.writingStyle) as WritingStyle

    setForm({
      name: account.name,
      apiKey: mc.apiKey ?? '',
      baseURL: mc.baseURL ?? '',
      defaultModel: mc.defaultModel ?? 'claude-sonnet-4-6',
      appId: wc.appId ?? '',
      appSecret: wc.appSecret ?? '',
      tone: ws.tone ?? '专业但通俗',
      length: ws.length ?? '1500-2500字',
    })
    setEditId(account.id)
    setShowForm(true)
  }

  function startNew() {
    setForm({ name: '', apiKey: '', baseURL: '', defaultModel: 'claude-sonnet-4-6', appId: '', appSecret: '', tone: '专业但通俗', length: '1500-2500字' })
    setEditId(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    const payload = {
      name: form.name,
      modelConfig: { apiKey: form.apiKey, baseURL: form.baseURL || undefined, defaultModel: form.defaultModel },
      wechatConfig: { appId: form.appId, appSecret: form.appSecret, enabled: !!(form.appId && form.appSecret) },
      writingStyle: { tone: form.tone, length: form.length },
    }

    try {
      const res = await fetch(editId ? `/api/accounts/${editId}` : '/api/accounts', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error(await res.text())

      const updated = await res.json() as Account

      if (editId) {
        setAccounts((prev) => prev.map((a) => (a.id === editId ? updated : a)))
      } else {
        setAccounts((prev) => [updated, ...prev])
      }

      setShowForm(false)
      setMessage(editId ? '账号已更新' : '账号已创建')
    } catch (err) {
      setMessage(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>{accounts.length} 个账号</p>
        <button
          onClick={startNew}
          className="btn btn-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建账号
        </button>
      </div>

      {message && (
        <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>{message}</p>
      )}

      {showForm && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>
            {editId ? '编辑账号' : '新建账号'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label label-required">账号名称</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input"
                  placeholder="例如：AI科技号"
                />
              </div>
              <div>
                <label className="label">默认模型</label>
                <select
                  value={form.defaultModel}
                  onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
                  className="input"
                >
                  <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                  <option value="claude-opus-4-6">claude-opus-4-6</option>
                  <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
                </select>
              </div>
              <div>
                <label className="label">AI API Key</label>
                <input
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  type="password"
                  className="input"
                  placeholder="sk-ant-..."
                />
              </div>
              <div>
                <label className="label">API Base URL (可选)</label>
                <input
                  value={form.baseURL}
                  onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
                  className="input"
                  placeholder="https://api.anthropic.com"
                />
              </div>
              <div>
                <label className="label">微信 AppID</label>
                <input
                  value={form.appId}
                  onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
                  className="input"
                  placeholder="wx..."
                />
              </div>
              <div>
                <label className="label">微信 AppSecret</label>
                <input
                  value={form.appSecret}
                  onChange={(e) => setForm((f) => ({ ...f, appSecret: e.target.value }))}
                  type="password"
                  className="input"
                />
              </div>
              <div>
                <label className="label">写作语气</label>
                <input
                  value={form.tone}
                  onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))}
                  className="input"
                  placeholder="专业但通俗"
                />
              </div>
              <div>
                <label className="label">文章长度</label>
                <input
                  value={form.length}
                  onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))}
                  className="input"
                  placeholder="1500-2500字"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-secondary"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>模型</th>
              <th>微信配置</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8" style={{ color: 'var(--color-fg-muted)' }}>
                  暂无账号，点击&quot;新建账号&quot;开始配置。
                </td>
              </tr>
            ) : (
              accounts.map((account) => {
                const mc = JSON.parse(account.modelConfig) as ModelConfig
                const wc = JSON.parse(account.wechatConfig) as WechatConfig
                return (
                  <tr key={account.id}>
                    <td className="font-medium" style={{ color: 'var(--color-fg)' }}>{account.name}</td>
                    <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                      {mc.defaultModel ?? '默认'}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                      {wc.appId ? `${wc.appId.slice(0, 8)}...` : '未配置'}
                    </td>
                    <td>
                      <span
                        className="text-xs font-medium"
                        style={{ color: account.isActive ? 'var(--color-success)' : 'var(--color-fg-subtle)' }}
                      >
                        {account.isActive ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => startEdit(account)}
                        className="text-sm font-medium transition-colors duration-300"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
