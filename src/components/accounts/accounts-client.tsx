'use client'

import { useState } from 'react'
import type {
  AccountRecord,
  FrontendJuejinConfig,
  FrontendModelConfig,
  FrontendWechatConfig,
  WechatThemeId,
  FrontendWritingStyle,
  PublishPlatform,
} from '@/types/accounts'

type Account = AccountRecord
type ModelConfig = FrontendModelConfig
type WechatConfig = FrontendWechatConfig
type JuejinConfig = FrontendJuejinConfig
type WritingStyle = FrontendWritingStyle

export default function AccountsClient({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    apiKey: '',
    baseURL: '',
    defaultModel: 'claude-sonnet-4-6',
    appId: '',
    appSecret: '',
    themeId: 'wechat-pro' as WechatThemeId,
    themeBrandName: '',
    themePrimaryColor: '',
    themeAccentColor: '',
    titleAlign: 'left' as 'left' | 'center',
    showEndingCard: true,
    endingCardText: '',
    imageStyle: 'rounded' as 'rounded' | 'soft-shadow' | 'square',
    juejinCookie: '',
    defaultPublishPlatform: 'wechat' as PublishPlatform,
    tone: '专业但通俗',
    length: '1500-2500字',
    brandName: '',
    targetAudience: '',
    preferredHookMode: 'auto' as 'auto' | 'A' | 'B' | 'C',
    tonePreset: '' as '' | 'sharp' | 'balanced' | 'professional',
  })

  function startEdit(account: Account) {
    const mc = JSON.parse(account.modelConfig) as ModelConfig
    const wc = JSON.parse(account.wechatConfig) as WechatConfig
    const jc = JSON.parse(account.juejinConfig) as JuejinConfig
    const ws = JSON.parse(account.writingStyle) as WritingStyle

    setForm({
      name: account.name,
      apiKey: mc.apiKey ?? '',
      baseURL: mc.baseURL ?? '',
      defaultModel: mc.defaultModel ?? 'claude-sonnet-4-6',
      appId: wc.appId ?? '',
      appSecret: wc.appSecret ?? '',
      themeId: wc.themeId ?? 'wechat-pro',
      themeBrandName: wc.brandName ?? ws.brandName ?? '',
      themePrimaryColor: wc.primaryColor ?? '',
      themeAccentColor: wc.accentColor ?? '',
      titleAlign: wc.titleAlign ?? 'left',
      showEndingCard: wc.showEndingCard ?? true,
      endingCardText: wc.endingCardText ?? '',
      imageStyle: wc.imageStyle ?? 'rounded',
      juejinCookie: jc.cookie ?? '',
      defaultPublishPlatform: account.defaultPublishPlatform,
      tone: ws.tone ?? '专业但通俗',
      length: ws.length ?? '1500-2500字',
      brandName: ws.brandName ?? '',
      targetAudience: ws.targetAudience ?? '',
      preferredHookMode: ws.preferredHookMode ?? 'auto',
      tonePreset: ws.tonePreset ?? '',
    })
    setEditId(account.id)
    setShowForm(true)
  }

  function startNew() {
    setForm({
      name: '',
      apiKey: '',
      baseURL: '',
      defaultModel: 'claude-sonnet-4-6',
      appId: '',
      appSecret: '',
      themeId: 'wechat-pro',
      themeBrandName: '',
      themePrimaryColor: '',
      themeAccentColor: '',
      titleAlign: 'left',
      showEndingCard: true,
      endingCardText: '',
      imageStyle: 'rounded',
      juejinCookie: '',
      defaultPublishPlatform: 'wechat',
      tone: '专业但通俗',
      length: '1500-2500字',
      brandName: '',
      targetAudience: '',
      preferredHookMode: 'auto',
      tonePreset: '',
    })
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
      wechatConfig: {
        appId: form.appId,
        appSecret: form.appSecret,
        enabled: !!(form.appId && form.appSecret),
        themeId: form.themeId,
        brandName: form.themeBrandName || undefined,
        primaryColor: form.themePrimaryColor || undefined,
        accentColor: form.themeAccentColor || undefined,
        titleAlign: form.titleAlign,
        showEndingCard: form.showEndingCard,
        endingCardText: form.endingCardText || undefined,
        imageStyle: form.imageStyle,
      },
      juejinConfig: { cookie: form.juejinCookie || undefined, enabled: !!form.juejinCookie },
      defaultPublishPlatform: form.defaultPublishPlatform,
      writingStyle: {
        tone: form.tone,
        length: form.length,
        brandName: form.brandName || undefined,
        targetAudience: form.targetAudience || undefined,
        preferredHookMode: form.preferredHookMode,
        tonePreset: form.tonePreset || undefined,
      },
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
      setMessageType('success')
    } catch (err) {
      setMessage(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(account: Account) {
    setTogglingId(account.id)
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !account.isActive }),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json() as Account
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? updated : a)))
    } catch (err) {
      setMessage(`操作失败: ${err instanceof Error ? err.message : String(err)}`)
      setMessageType('error')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(id: string) {
    setDeleteConfirmId(null)
    setDeletingId(id)
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      setAccounts((prev) => prev.filter((a) => a.id !== id))
      setMessage('账号已删除')
      setMessageType('success')
    } catch (err) {
      setMessage(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
      setMessageType('error')
    } finally {
      setDeletingId(null)
    }
  }

  const deleteTarget = accounts.find((a) => a.id === deleteConfirmId)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>{accounts.length} 个账号</p>
        <button onClick={startNew} className="btn btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建账号
        </button>
      </div>

      {/* Feedback message */}
      {message && (
        <p
          className="text-sm px-3 py-2 rounded-lg"
          style={{
            color: messageType === 'success' ? 'var(--color-success)' : 'var(--color-error)',
            background: messageType === 'success' ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
          }}
        >
          {message}
        </p>
      )}

      {/* Edit / Create form */}
      {showForm && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-fg)', letterSpacing: 'var(--tracking-tight)' }}>
            {editId ? '编辑账号' : '新建账号'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label label-required">账号名称</label>
                <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input" placeholder="例如：AI科技号" />
              </div>
              <div>
                <label className="label">默认模型</label>
                <select value={form.defaultModel} onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))} className="input">
                  <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                  <option value="claude-opus-4-6">claude-opus-4-6</option>
                  <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
                </select>
              </div>
              <div>
                <label className="label">AI API Key</label>
                <input value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} type="password" className="input" placeholder="sk-ant-..." />
              </div>
              <div>
                <label className="label">API Base URL (可选)</label>
                <input value={form.baseURL} onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))} className="input" placeholder="https://api.anthropic.com" />
              </div>
              <div>
                <label className="label">微信 AppID</label>
                <input value={form.appId} onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))} className="input" placeholder="wx..." />
              </div>
              <div>
                <label className="label">微信 AppSecret</label>
                <input value={form.appSecret} onChange={(e) => setForm((f) => ({ ...f, appSecret: e.target.value }))} type="password" className="input" />
              </div>
              <div>
                <label className="label">排版主题</label>
                <select value={form.themeId} onChange={(e) => setForm((f) => ({ ...f, themeId: e.target.value as WechatThemeId }))} className="input">
                  <option value="brand-clean">Brand Clean</option>
                  <option value="brand-magazine">Brand Magazine</option>
                  <option value="brand-warm">Brand Warm</option>
                  <option value="wechat-pro">WeChat Pro</option>
                </select>
              </div>
              <div>
                <label className="label">标题对齐</label>
                <select value={form.titleAlign} onChange={(e) => setForm((f) => ({ ...f, titleAlign: e.target.value as typeof f.titleAlign }))} className="input">
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                </select>
              </div>
              <div>
                <label className="label">品牌主色</label>
                <input value={form.themePrimaryColor} onChange={(e) => setForm((f) => ({ ...f, themePrimaryColor: e.target.value }))} className="input" placeholder="#1f6feb" />
              </div>
              <div>
                <label className="label">强调底色</label>
                <input value={form.themeAccentColor} onChange={(e) => setForm((f) => ({ ...f, themeAccentColor: e.target.value }))} className="input" placeholder="#dbeafe" />
              </div>
              <div>
                <label className="label">图片风格</label>
                <select value={form.imageStyle} onChange={(e) => setForm((f) => ({ ...f, imageStyle: e.target.value as typeof f.imageStyle }))} className="input">
                  <option value="rounded">圆角</option>
                  <option value="soft-shadow">柔和投影</option>
                  <option value="square">直角</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-fg-muted)' }}>
                  <input type="checkbox" checked={form.showEndingCard} onChange={(e) => setForm((f) => ({ ...f, showEndingCard: e.target.checked }))} />
                  发布时自动追加结尾互动卡片
                </label>
              </div>
              <div>
                <label className="label">排版品牌名</label>
                <input value={form.themeBrandName} onChange={(e) => setForm((f) => ({ ...f, themeBrandName: e.target.value }))} className="input" placeholder="内容中心 / 你的公众号名" />
              </div>
              <div>
                <label className="label">结尾引导文案</label>
                <input value={form.endingCardText} onChange={(e) => setForm((f) => ({ ...f, endingCardText: e.target.value }))} className="input" placeholder="欢迎点个在看，留言说说你的判断。" />
              </div>
              <div className="col-span-2">
                <label className="label">掘金 Cookie</label>
                <textarea value={form.juejinCookie} onChange={(e) => setForm((f) => ({ ...f, juejinCookie: e.target.value }))} className="input min-h-[96px]" placeholder="sessionid=...; sid_tt=..." />
              </div>
              <div>
                <label className="label">默认发布平台</label>
                <select value={form.defaultPublishPlatform} onChange={(e) => setForm((f) => ({ ...f, defaultPublishPlatform: e.target.value as PublishPlatform }))} className="input">
                  <option value="wechat">微信公众号</option>
                  <option value="juejin">掘金</option>
                </select>
              </div>
              <div>
                <label className="label">写作语气</label>
                <input value={form.tone} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))} className="input" placeholder="专业但通俗" />
              </div>
              <div>
                <label className="label">文章长度</label>
                <input value={form.length} onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))} className="input" placeholder="1500-2500字" />
              </div>
              <div>
                <label className="label">品牌名称</label>
                <input value={form.brandName} onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))} className="input" placeholder="科技猫（默认）" />
              </div>
              <div>
                <label className="label">目标读者</label>
                <input value={form.targetAudience} onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value }))} className="input" placeholder="25-40岁科技爱好者（默认）" />
              </div>
              <div>
                <label className="label">Hook 偏好</label>
                <select value={form.preferredHookMode} onChange={(e) => setForm((f) => ({ ...f, preferredHookMode: e.target.value as typeof f.preferredHookMode }))} className="input">
                  <option value="auto">自动选择</option>
                  <option value="A">A — 反常识（颠覆认知数据）</option>
                  <option value="B">B — 具体场景（真实案例映射）</option>
                  <option value="C">C — 辛辣设问（尖锐问题切入）</option>
                </select>
              </div>
              <div>
                <label className="label">语气预设</label>
                <select value={form.tonePreset} onChange={(e) => setForm((f) => ({ ...f, tonePreset: e.target.value as typeof f.tonePreset }))} className="input">
                  <option value="">默认（随语气字段）</option>
                  <option value="sharp">犀利 — 敢于下判断，有锋芒</option>
                  <option value="balanced">均衡 — 数据说话，结论有余地</option>
                  <option value="professional">专业 — 商业沉稳，逻辑严密</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? '保存中...' : '保存'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Account table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>模型</th>
              <th>默认发布</th>
              <th>微信配置</th>
              <th>掘金配置</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8" style={{ color: 'var(--color-fg-muted)' }}>
                  暂无账号，点击&quot;新建账号&quot;开始配置。
                </td>
              </tr>
            ) : (
              accounts.map((account) => {
                const mc = JSON.parse(account.modelConfig) as ModelConfig
                const wc = JSON.parse(account.wechatConfig) as WechatConfig
                const jc = JSON.parse(account.juejinConfig) as JuejinConfig
                const isToggling = togglingId === account.id
                const isDeleting = deletingId === account.id
                return (
                  <tr key={account.id}>
                    <td className="font-medium" style={{ color: 'var(--color-fg)' }}>{account.name}</td>
                    <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                      {mc.defaultModel ?? '默认'}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                      {account.defaultPublishPlatform === 'wechat' ? '微信公众号' : '掘金'}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                      {wc.appId ? `${wc.appId.slice(0, 8)}... / ${wc.themeId ?? 'brand-clean'}` : '未配置'}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                      {jc.cookie ? '已配置' : '未配置'}
                    </td>
                    <td>
                      <button
                        onClick={() => handleToggleActive(account)}
                        disabled={isToggling}
                        className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors duration-200"
                        style={{
                          background: account.isActive ? 'rgba(22,163,74,0.1)' : 'var(--color-bg-tertiary)',
                          color: account.isActive ? 'var(--color-success)' : 'var(--color-fg-subtle)',
                          cursor: isToggling ? 'not-allowed' : 'pointer',
                          opacity: isToggling ? 0.5 : 1,
                        }}
                      >
                        {isToggling ? '...' : account.isActive ? '启用中' : '已停用'}
                      </button>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => startEdit(account)}
                          className="text-sm font-medium transition-colors duration-300"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(account.id)}
                          disabled={isDeleting}
                          className="text-sm font-medium transition-colors duration-300"
                          style={{ color: 'var(--color-error)', opacity: isDeleting ? 0.5 : 1 }}
                        >
                          {isDeleting ? '...' : '删除'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirm dialog */}
      {deleteConfirmId && deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => e.target === e.currentTarget && setDeleteConfirmId(null)}
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
              <h3 className="font-semibold" style={{ color: 'var(--color-fg)' }}>删除账号</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--color-fg-muted)' }}>
                确认删除账号「{deleteTarget.name}」？此操作无法撤销。
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="btn flex-1"
                style={{ background: 'var(--color-error)', color: '#fff' }}
              >
                确认删除
              </button>
              <button onClick={() => setDeleteConfirmId(null)} className="btn btn-secondary flex-1">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
