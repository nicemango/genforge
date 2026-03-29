import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const PublishPlatformSchema = z.enum(['wechat', 'juejin'])

const UpdateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  modelConfig: z.record(z.unknown()).optional(),
  writingStyle: z.record(z.unknown()).optional(),
  wechatConfig: z.record(z.unknown()).optional(),
  juejinConfig: z.record(z.unknown()).optional(),
  defaultPublishPlatform: PublishPlatformSchema.optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const account = await prisma.account.findUnique({ where: { id } })

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  return NextResponse.json(account)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json() as unknown
  const parsed = UpdateAccountSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const {
    name,
    isActive,
    modelConfig,
    writingStyle,
    wechatConfig,
    juejinConfig,
    defaultPublishPlatform,
  } = parsed.data

  const updateData: Record<string, unknown> = {}
  if (name !== undefined) updateData.name = name
  if (isActive !== undefined) updateData.isActive = isActive
  if (modelConfig !== undefined) updateData.modelConfig = JSON.stringify(modelConfig)
  if (writingStyle !== undefined) updateData.writingStyle = JSON.stringify(writingStyle)
  if (wechatConfig !== undefined) updateData.wechatConfig = JSON.stringify(wechatConfig)
  if (juejinConfig !== undefined) updateData.juejinConfig = JSON.stringify(juejinConfig)
  if (defaultPublishPlatform !== undefined) updateData.defaultPublishPlatform = defaultPublishPlatform

  try {
    const account = await prisma.account.update({ where: { id }, data: updateData })
    return NextResponse.json(account)
  } catch {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    await prisma.account.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }
}
