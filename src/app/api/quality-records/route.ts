import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10)

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }

  const where = { accountId }

  const [records, total] = await Promise.all([
    prisma.qualityRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.qualityRecord.count({ where }),
  ])

  // Compute aggregate stats for the account
  const stats = await prisma.qualityRecord.aggregate({
    where: { accountId },
    _avg: { score: true },
    _count: true,
  })

  const passedCount = await prisma.qualityRecord.count({
    where: { accountId, passed: true },
  })

  return NextResponse.json({
    records: records.map((r) => ({
      ...r,
      issues: JSON.parse(r.issues as string),
      suggestions: JSON.parse(r.suggestions as string),
    })),
    stats: {
      avgScore: stats._avg.score ? Math.round(stats._avg.score * 10) / 10 : null,
      total: stats._count,
      passRate: stats._count > 0 ? Math.round((passedCount / stats._count) * 100) / 100 : null,
    },
    page,
    pageSize,
    total,
  })
}
