import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import ContentEditor from '@/components/contents/content-editor'

export const dynamic = 'force-dynamic'

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const content = await prisma.content.findUnique({
    where: { id },
    include: {
      topic: true,
      account: { select: { id: true, name: true } },
    },
  })

  if (!content) notFound()

  return <ContentEditor content={content} />
}
