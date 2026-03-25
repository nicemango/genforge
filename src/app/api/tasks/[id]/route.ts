import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const taskRun = await prisma.taskRun.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true } },
    },
  })

  if (!taskRun) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // Parse output JSON
  let parsedOutput: unknown = null
  try {
    parsedOutput = taskRun.output ? JSON.parse(taskRun.output) : null
  } catch { /* ignore */ }

  // Parse input JSON for topicId
  let topicId: string | null = null
  try {
    const input = taskRun.input ? JSON.parse(taskRun.input) : null
    topicId = input?.topicId ?? null
  } catch { /* ignore */ }

  // Fetch related topic if applicable
  let topic: { id: string; title: string; angle: string } | null = null
  if (topicId) {
    topic = await prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, title: true, angle: true },
    }).catch(() => null)
  }

  // For TOPIC_SELECT: fetch the created topics
  let selectedTopics: Array<{ id: string; title: string; heatScore: number }> = []
  if (taskRun.taskType === 'TOPIC_SELECT' && parsedOutput && typeof parsedOutput === 'object') {
    const output = parsedOutput as Record<string, unknown>
    const topicIds = (output.topicIds as string[] | undefined) ?? []
    if (topicIds.length > 0) {
      selectedTopics = await prisma.topic.findMany({
        where: { id: { in: topicIds } },
        select: { id: true, title: true, heatScore: true },
        orderBy: { heatScore: 'desc' },
      }).catch(() => [])
    }
  }

  // For WRITE: fetch the content
  let content: { id: string; title: string; summary: string; wordCount: number } | null = null
  if ((taskRun.taskType === 'WRITE' || taskRun.taskType === 'REVIEW') && parsedOutput && typeof parsedOutput === 'object') {
    const output = parsedOutput as Record<string, unknown>
    const contentId = output.contentId as string | undefined
    if (contentId) {
      content = await prisma.content.findUnique({
        where: { id: contentId },
        select: { id: true, title: true, summary: true, wordCount: true },
      }).catch(() => null)
    }
  }

  return NextResponse.json({
    taskRun: {
      ...taskRun,
      parsedOutput,
      topic,
      selectedTopics,
      content,
    },
  })
}
