import { prisma } from '@/lib/prisma'
import AccountsClient from '@/components/accounts/accounts-client'
import type { AccountRecord } from '@/types/accounts'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  let error: string | null = null

  try {
    const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'desc' } })
    const typedAccounts: AccountRecord[] = accounts.map((a) => ({
      ...a,
      defaultPublishPlatform: a.defaultPublishPlatform as AccountRecord['defaultPublishPlatform'],
    }))

    return <AccountsClient initialAccounts={typedAccounts} />
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="card text-center py-8">
      <p className="text-sm" style={{ color: 'var(--color-danger, #ef4444)' }}>加载账号失败: {error}</p>
    </div>
  )
}
