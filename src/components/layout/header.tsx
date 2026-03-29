'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PAGE_TITLES: Record<string, string> = {
  '/': '概览',
  '/topics': '话题管理',
  '/contents': '内容管理',
  '/accounts': '账号配置',
  '/tasks': '任务历史',
}

export default function Header() {
  const pathname = usePathname()

  const title =
    PAGE_TITLES[pathname] ??
    Object.entries(PAGE_TITLES).find(([key]) => key !== '/' && pathname.startsWith(key))?.[1] ??
    'Content Center'

  // Get breadcrumb segments
  const getBreadcrumbs = () => {
    if (pathname === '/') return [{ label: '概览', href: '/' }]

    const segments = pathname.split('/').filter(Boolean)
    const breadcrumbs = [{ label: '概览', href: '/' }]

    let currentPath = ''
    segments.forEach((segment) => {
      currentPath += `/${segment}`
      const label = PAGE_TITLES[currentPath] || segment
      breadcrumbs.push({ label, href: currentPath })
    })

    return breadcrumbs
  }

  const breadcrumbs = getBreadcrumbs()

  return (
    <header
      className="h-16 flex items-center justify-between px-6"
      style={{
        background: 'var(--color-card)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Breadcrumb / Title */}
      <div className="flex items-center gap-2">
        {breadcrumbs.length > 1 ? (
          <nav className="flex items-center gap-1.5">
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.href} className="flex items-center gap-1.5">
                {index > 0 && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-subtle)" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                )}
                <Link
                  href={crumb.href}
                  className={`text-sm transition-colors duration-200 ${
                    index === breadcrumbs.length - 1
                      ? 'font-semibold'
                      : 'hover:text-[var(--color-primary)]'
                  }`}
                  style={{
                    color: index === breadcrumbs.length - 1 ? 'var(--color-fg)' : 'var(--color-fg-muted)',
                  }}
                >
                  {crumb.label}
                </Link>
              </div>
            ))}
          </nav>
        ) : (
          <h1
            className="text-base font-semibold"
            style={{
              color: 'var(--color-fg)',
              letterSpacing: 'var(--tracking-tight)',
            }}
          >
            {title}
          </h1>
        )}
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        <Link
          href="/tasks"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:bg-[var(--color-bg-secondary)]"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          任务
        </Link>
      </div>
    </header>
  )
}
