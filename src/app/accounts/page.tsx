import { prisma } from '@/lib/prisma'
import AccountsClient from '@/components/accounts/accounts-client'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  let accounts: Awaited<ReturnType<typeof prisma.account.findMany>> = []
  let error: string | null = null

  try {
    accounts = await prisma.account.findMany({ orderBy: { createdAt: 'desc' } })
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-sm" style={{ color: 'var(--color-danger, #ef4444)' }}>加载账号失败: {error}</p>
      </div>
    )
  }

  return <AccountsClient initialAccounts={accounts} />
}
