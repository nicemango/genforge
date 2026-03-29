import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const PublishPlatformSchema = z.enum(['wechat', 'juejin'])

const CreateAccountSchema = z.object({
  name: z.string().min(1),
  modelConfig: z.record(z.unknown()).optional(),
  writingStyle: z.record(z.unknown()).optional(),
  wechatConfig: z.record(z.unknown()).optional(),
  juejinConfig: z.record(z.unknown()).optional(),
  defaultPublishPlatform: PublishPlatformSchema.optional(),
})

export async function GET() {
  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      isActive: true,
      modelConfig: true,
      writingStyle: true,
      wechatConfig: true,
      juejinConfig: true,
      defaultPublishPlatform: true,
      qualityConfig: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json(accounts)
}

export async function POST(request: Request) {
  const body = await request.json() as unknown
  const parsed = CreateAccountSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const {
    name,
    modelConfig = {},
    writingStyle = {},
    wechatConfig = {},
    juejinConfig = {},
    defaultPublishPlatform = 'wechat',
  } = parsed.data

  const account = await prisma.account.create({
    data: {
      name,
      modelConfig: JSON.stringify(modelConfig),
      writingStyle: JSON.stringify(writingStyle),
      wechatConfig: JSON.stringify(wechatConfig),
      juejinConfig: JSON.stringify(juejinConfig),
      defaultPublishPlatform,
    },
  })

  return NextResponse.json(account, { status: 201 })
}
