import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10)

  const where: Record<string, unknown> = {}
  if (accountId) where.accountId = accountId
  if (status) where.status = status

  const [topics, total] = await Promise.all([
    prisma.topic.findMany({
      where,
      orderBy: [{ heatScore: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.topic.count({ where }),
  ])

  return NextResponse.json({ topics, total, page, pageSize })
}
