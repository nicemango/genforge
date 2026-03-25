export interface PipelineStepMeta {
  id: string
  label: string
  description: string
  icon: string
  /** Step IDs that must run before this one */
  dependencies: string[]
  /** Whether this step requires a topicId to be selected */
  needsTopicId: boolean
  color: string
}

export const PIPELINE_STEPS: PipelineStepMeta[] = [
  {
    id: 'TREND_CRAWL',
    label: '热点采集',
    description: '从 26 个 RSS 源抓取趋势文章，自动去重、关键词过滤、热度排序',
    icon: 'rss',
    dependencies: [],
    needsTopicId: false,
    color: '#7c2bee',
  },
  {
    id: 'TOPIC_SELECT',
    label: '话题筛选',
    description: 'AI 从采集内容中选出最适合公众号定位的 3-5 个候选话题',
    icon: 'target',
    dependencies: ['TREND_CRAWL'],
    needsTopicId: false,
    color: '#7c2bee',
  },
  {
    id: 'RESEARCH',
    label: '深度研究',
    description: '对选定话题进行深度搜索，提炼核心观点、关键数据和专家引用',
    icon: 'search',
    dependencies: ['TOPIC_SELECT'],
    needsTopicId: true,
    color: '#7c2bee',
  },
  {
    id: 'WRITE',
    label: '内容写作',
    description: '基于研究报告生成完整文章，包含标题、摘要、正文和配图占位符',
    icon: 'pen',
    dependencies: ['RESEARCH'],
    needsTopicId: true,
    color: '#7c2bee',
  },
  {
    id: 'GENERATE_IMAGES',
    label: '配图生成',
    description: '使用 MiniMax AI 为文章生成封面图和内文配图（非阻塞，失败不影响主流程）',
    icon: 'image',
    dependencies: ['WRITE'],
    needsTopicId: true,
    color: '#7c2bee',
  },
  {
    id: 'REVIEW',
    label: '质量审核',
    description: 'AI 审稿并评分（0-10），低于阈值自动重写，最多重试 2 次',
    icon: 'check',
    dependencies: ['GENERATE_IMAGES', 'WRITE'],
    needsTopicId: true,
    color: '#7c2bee',
  },
  {
    id: 'PUBLISH',
    label: '发布推送',
    description: '将审核通过的文章推送到微信公众号草稿箱，等待手动发布',
    icon: 'send',
    dependencies: ['REVIEW'],
    needsTopicId: true,
    color: '#7c2bee',
  },
  {
    id: 'FULL_PIPELINE',
    label: '完整流程',
    description: '自动执行热点采集 → 话题筛选 → 深度研究 → 写作 → 配图 → 审核 → 发布全链路',
    icon: 'zap',
    dependencies: [],
    needsTopicId: false,
    color: '#7c2bee',
  },
]

export const STEP_MAP = Object.fromEntries(
  PIPELINE_STEPS.map((s) => [s.id, s]),
) as Record<string, PipelineStepMeta>

/** 返回依赖链上所有步骤的 ID（含自己） */
export function getDependents(stepId: string): string[] {
  const step = STEP_MAP[stepId]
  if (!step) return [stepId]
  const deps = new Set<string>([stepId])
  for (const dep of step.dependencies) {
    for (const d of getDependents(dep)) deps.add(d)
  }
  return Array.from(deps)
}
