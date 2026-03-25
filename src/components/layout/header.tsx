'use client'

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

  return (
    <header
      className="h-16 flex items-center px-6"
      style={{
        background: 'var(--color-card)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <h1
        className="text-base font-semibold"
        style={{
          color: 'var(--color-fg)',
          letterSpacing: 'var(--tracking-tight)',
        }}
      >
        {title}
      </h1>
    </header>
  )
}
