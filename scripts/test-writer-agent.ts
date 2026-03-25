/**
 * WriterAgent 独立测试脚本
 *
 * 用法:
 *   npx tsx scripts/test-writer-agent.ts                    # 从数据库读取最新 Topic，使用环境变量模型配置
 *   npx tsx scripts/test-writer-agent.ts --topic-id xxx    # 指定 Topic ID
 *
 * 配置优先级：
 *   模型配置：ENV (DEFAULT_AI_API_KEY, DEFAULT_AI_MODEL) > 数据库 account.modelConfig
 *   输入数据：CLI --topic-id > 数据库最新 PENDING Topic
 */

import { runWriterAgent } from '@/agents/writer'
import { getDefaultModelConfig } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import type { TopicSuggestion } from '@/agents/topic'
import type { ResearchResult } from '@/agents/research'

// CLI 参数解析
const args = process.argv.slice(2)
const topicIdIndex = args.indexOf('--topic-id')
const TOPIC_ID = topicIdIndex !== -1 ? args[topicIdIndex + 1] : null

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

function log(title: string, content?: string, color: keyof typeof colors = 'reset') {
  const c = colors[color] || colors.reset
  if (content) {
    console.log(`${c}${colors.bright}[${title}]${colors.reset} ${content}`)
  } else {
    console.log(`\n${c}${colors.bright}━━ ${title} ━━${colors.reset}`)
  }
}

function logError(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.log(`${colors.red}${colors.bright}[${title}] ERROR${colors.reset} ${message}`)
}

// 默认测试数据
const defaultTopic = {
  title: '为什么 AI 公司的估值逻辑正在被颠覆？',
  angle: '从数据垄断到技术平权，AI 创业公司的护城河正在消失',
  summary: '本文探讨 AI 公司估值逻辑的深层变化，揭示数据优势不等于技术壁垒的现实',
  heatScore: 8.5,
  tags: ['AI', '创业', '估值'],
}

const defaultResearch = {
  summary: `AI 行业的估值逻辑正在经历根本性转变。

关键数据：
- 2024年全球 AI 市场规模达到 1840 亿美元（来源：Gartner 2024）
- OpenAI 最新一轮估值 1570 亿美元，但年营收仅 34 亿美元
- 企业 AI 项目失败率高达 70%，多数死于 PMF 错误
- Anthropic、Cohere 等创业公司正在用更少的钱做更多的事

核心观点：
AI 公司的估值不再单纯取决于技术领先性，而是取决于能否真正解决客户问题。
那些还在炫耀"我们有最大的模型"的 AI 公司，正在被市场教育。`,
  keyPoints: [
    'AI 创业公司的估值逻辑正在从"技术领先"转向"商业落地"',
    '70% 的企业 AI 项目失败，原因是 PMF 错误而非技术问题',
    '开源模型正在快速追赶闭源模型，成本差距缩小 90%',
  ],
  sources: [
    { title: 'Gartner AI Market Report 2024', url: 'https://example.com/gartner', verified: true },
    { title: 'a16z AI State Report', url: 'https://example.com/a16z', verified: true },
  ],
  rawOutput: `## 研究报告：AI 公司估值逻辑分析

### 市场规模与增长
根据 Gartner 2024 年报告，全球 AI 市场规模达到 1840 亿美元，年增长率 28%。但这个数字背后有一个有趣的现象：70% 的 AI 预算流向了 5 家公司。

### 创业公司生存现状
2024 年美国 AI 创业公司的融资额同比增长 40%，但存活率却下降了 15%。这说明资金正在向头部集中，中小创业公司的处境愈发艰难。

### 估值逻辑的转变
传统的 AI 公司估值逻辑是"技术领先 = 估值溢价"，但这种逻辑正在被颠覆。市场开始关注：
1. 收入质量和增长速度
2. 客户留存和复购
3. 单位经济模型是否健康

### 关键结论
AI 公司的护城河不再是技术本身，而是：
- 数据网络效应
- 客户关系和信任
- 垂直行业的深度积累`,
}

async function main() {
  console.log(`
${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════╗
║              Content Center - Writer Agent 测试            ║
╚══════════════════════════════════════════════════════════╝
${colors.reset}`)

  const startTime = Date.now()

  try {
    // 1. 模型配置：从环境变量读取
    let modelConfig: ReturnType<typeof getDefaultModelConfig>
    try {
      modelConfig = getDefaultModelConfig()
      log('配置', `模型: ${modelConfig.model}`, 'blue')
    } catch {
      logError('配置', '缺少 DEFAULT_AI_API_KEY 环境变量')
      throw new Error('请设置 DEFAULT_AI_API_KEY 环境变量')
    }

    // 2. 输入数据：从数据库读取 Topic
    let topic: TopicSuggestion
    let research: ResearchResult

    if (TOPIC_ID) {
      // 指定了 Topic ID
      const dbTopic = await prisma.topic.findUnique({ where: { id: TOPIC_ID } })
      if (!dbTopic) {
        throw new Error(`Topic not found: ${TOPIC_ID}`)
      }
      topic = {
        title: dbTopic.title,
        angle: dbTopic.angle,
        summary: dbTopic.summary,
        heatScore: dbTopic.heatScore,
        tags: JSON.parse(dbTopic.tags),
      }
      research = defaultResearch // 使用默认研究数据（真实场景需先运行 ResearchAgent）
      log('输入', `从数据库加载 Topic: ${topic.title}`, 'yellow')
    } else {
      // 使用默认测试数据（当没有真实数据时）
      topic = defaultTopic
      research = defaultResearch
      log('输入', `使用默认测试数据（无真实 Topic）`, 'yellow')
      log('输入', `话题: ${topic.title}`, 'yellow')
      log('输入', `字数要求: 2000-2800 字`, 'yellow')

      console.log(`\n${colors.dim}如需测试真实数据，请先运行 Pipeline 或指定 --topic-id${colors.reset}`)
    }

    if (!TOPIC_ID) {
      console.log(`\n${colors.dim}研究资料预览：${colors.reset}`)
      console.log(research!.summary.slice(0, 300) + '...\n')
    }

    log('执行', '开始生成文章，可能需要 1-3 分钟...', 'yellow')

    const result = await runWriterAgent(topic, research!, modelConfig)

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`\n${colors.green}${colors.bright}╔══════════════════════════════════════════╗${colors.reset}`)
    console.log(`${colors.green}${colors.bright}║              生成完成！                      ║${colors.reset}`)
    console.log(`${colors.green}${colors.bright}╚══════════════════════════════════════════╝${colors.reset}`)

    log('统计', `耗时: ${duration}s`, 'green')
    log('统计', `标题: ${result.title}`, 'green')
    log('统计', `字数: ${result.wordCount}`, result.wordCount >= 2000 && result.wordCount <= 2800 ? 'green' : 'red')
    log('统计', `摘要: ${result.summary.slice(0, 80)}...`, 'green')

    console.log(`\n${colors.dim}━━ 文章正文预览 ━━${colors.reset}`)
    console.log(result.body.slice(0, 1500))
    console.log('\n...（正文过长已截断）\n')

    await prisma.$disconnect()
    return result
  } catch (error) {
    logError('Writer Agent', error)
    await prisma.$disconnect()
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
