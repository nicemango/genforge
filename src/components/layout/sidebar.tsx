'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: '概览', icon: GridIcon },
  { href: '/topics', label: '话题', icon: TopicIcon },
  { href: '/contents', label: '内容', icon: ContentIcon },
  { href: '/accounts', label: '账号', icon: AccountIcon },
  { href: '/tasks', label: '任务', icon: TaskIcon },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col" style={{ background: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
      <div className="h-16 flex items-center px-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-primary)' }}>
            <span className="text-white text-sm font-bold">CC</span>
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-fg)' }}>Content Center</span>
        </div>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-300"
              style={{
                background: isActive ? 'var(--color-primary-alpha)' : 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-fg-muted)',
                fontWeight: isActive ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
              }}
            >
              <Icon active={isActive} />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="p-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="text-xs" style={{ color: 'var(--color-fg-subtle)' }}>
          AI 自动化内容生产
        </div>
      </div>
    </aside>
  )
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function TopicIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" fill={active ? 'var(--color-primary)' : 'currentColor'} />
    </svg>
  )
}

function ContentIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  )
}

function AccountIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function TaskIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--color-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
