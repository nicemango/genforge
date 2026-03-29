import { prisma } from '@/lib/prisma'
import { parseWechatConfig } from '@/lib/json'
import { runPublishAgent } from '@/agents/publisher'

async function main() {
  const contentId = process.argv[2]
  if (!contentId) {
    throw new Error('Usage: pnpm exec tsx scripts/publish-content-draft.ts <contentId>')
  }

  const content = await prisma.content.findUniqueOrThrow({
    where: { id: contentId },
    select: { id: true, accountId: true, title: true, summary: true, body: true },
  })

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: content.accountId },
    select: { wechatConfig: true },
  })

  const wechatConfig = parseWechatConfig(account.wechatConfig)
  const result = await runPublishAgent(content.accountId, content.title, content.body, content.summary, {
    contentId: content.id,
    author: wechatConfig.author,
  })

  console.log(
    JSON.stringify(
      {
        contentId: content.id,
        mediaId: result.mediaId,
        publishedAt: result.publishedAt,
        htmlLength: result.convertedHtml.length,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
