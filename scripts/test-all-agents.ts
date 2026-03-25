/**
 * 全量 Agent 测试脚本
 * 依次执行所有 agent，展示完整的 pipeline 流程
 * 用法: pnpm test:agents
 */

import { runTrendAgent } from '@/agents/trend'
import { runTopicAgent } from '@/agents/topic'
import { runResearchAgent } from '@/agents/research'
import { runWriterAgent } from '@/agents/writer'
import { runReviewAgent } from '@/agents/review'
import { prisma } from '@/lib/prisma'
import { loadModelConfig } from '@/lib/config'
import { Prisma } from '@prisma/client'

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
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

function logSection(name: string) {
  console.log(`\n${colors.cyan}${colors.bright}╔══════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.cyan}${colors.bright}║${colors.reset}  ${name.padEnd(38)}${colors.cyan}${colors.bright}║${colors.reset}`)
  console.log(`${colors.cyan}${colors.bright}╚══════════════════════════════════════════╝${colors.reset}`)
}

function logResult(success: boolean, message: string) {
  const icon = success ? '✅' : '❌'
  const color = success ? 'green' : 'red'
  log(`${icon} ${message}`, '', color)
}

// 获取或创建测试账号
async function getTestAccount() {
  let account = await prisma.account.findFirst({
    where: { name: 'Test Account' }
  })

  if (!account) {
    account = await prisma.account.create({
      data: {
        name: 'Test Account',
        modelConfig: JSON.stringify({
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: process.env.DEFAULT_AI_API_KEY,
        }),
        wechatConfig: JSON.stringify({
          appId: 'test-appid',
          appSecret: 'test-secret',
        }),
        writingStyle: JSON.stringify({
          tone: '犀利有观点，敢下判断，有温度也有锋芒',
          length: '2000-2800字',
          style: ['公众号深度爆款风格', '有数据有案例', '深度与可读性兼顾'],
        }),
        qualityConfig: JSON.stringify({
          minScore: 7.0,
          maxWriteRetries: 2,
        }),
      },
    })
    log('账号', '创建测试账号成功', 'green')
  } else {
    log('账号', '使用已有测试账号', 'blue')
  }

  return account
}

// 测试 1: Trend Agent
async function testTrendAgent() {
  logSection('1. Trend Agent - 趋势抓取')

  const startTime = Date.now()
  try {
    const result = await runTrendAgent()
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logResult(true, `抓取完成，耗时 ${duration}s`)
    log('统计', `总源数: ${result.stats.total}, 成功: ${result.stats.success}, 失败: ${result.stats.failed}, 获取: ${result.items.length} 条`)

    // 显示前3条
    console.log(`\n${colors.dim}前 3 条趋势：${colors.reset}`)
    result.items.slice(0, 3).forEach((item, i) => {
      console.log(`  ${i + 1}. [${colors.yellow}${item.source}${colors.reset}] ${item.title.slice(0, 60)}...`)
    })

    return result
  } catch (error) {
    logError('Trend Agent', error)
    throw error
  }
}

// 测试 2: Topic Agent
async function testTopicAgent(trendResult: Awaited<ReturnType<typeof runTrendAgent>>, account: { modelConfig: string | Prisma.JsonValue }) {
  logSection('2. Topic Agent - 选题筛选')

  const startTime = Date.now()
  try {
    const modelConfig = loadModelConfig(typeof account.modelConfig === 'string' ? account.modelConfig : account.modelConfig != null ? JSON.stringify(account.modelConfig) : account.modelConfig)
    const result = await runTopicAgent(trendResult.items, modelConfig, 3)
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logResult(true, `选题完成，耗时 ${duration}s`)
    log('统计', `生成 ${result.topics.length} 个选题`)

    // 显示所有选题
    result.topics.forEach((topic, i) => {
      console.log(`\n${colors.cyan}选题 ${i + 1}:${colors.reset}`)
      console.log(`  标题: ${topic.title}`)
      console.log(`  角度: ${topic.angle.slice(0, 80)}...`)
      console.log(`  热度: ${'🔥'.repeat(Math.ceil(topic.heatScore / 2))} (${topic.heatScore}/10)`)
      console.log(`  标签: ${topic.tags.join(', ')}`)
    })

    return result
  } catch (error) {
    logError('Topic Agent', error)
    throw error
  }
}

// 测试 3: Research Agent
async function testResearchAgent(topic: Awaited<ReturnType<typeof runTopicAgent>>['topics'][0], account: { modelConfig: string | Prisma.JsonValue }) {
  logSection('3. Research Agent - 深度研究')

  const startTime = Date.now()
  try {
    const modelConfig = loadModelConfig(typeof account.modelConfig === 'string' ? account.modelConfig : account.modelConfig != null ? JSON.stringify(account.modelConfig) : account.modelConfig)

    log('提示', 'Research Agent 需要调用搜索工具，可能需要 2-5 分钟...', 'yellow')

    const result = await runResearchAgent(topic, modelConfig)
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logResult(true, `研究完成，耗时 ${duration}s`)
    log('统计', `关键要点: ${result.keyPoints.length} 条, 来源: ${result.sources.length} 个`)

    // 显示前5个关键要点
    console.log(`\n${colors.dim}关键要点预览：${colors.reset}`)
    result.keyPoints.slice(0, 5).forEach((point, i) => {
      console.log(`  ${i + 1}. ${point.slice(0, 100)}...`)
    })

    // 显示研究摘要
    console.log(`\n${colors.dim}研究摘要：${colors.reset}`)
    console.log(result.summary.slice(0, 500) + '...')

    return result
  } catch (error) {
    logError('Research Agent', error)
    throw error
  }
}

// 测试 4: Writer Agent
async function testWriterAgent(
  topic: Awaited<ReturnType<typeof runTopicAgent>>['topics'][0],
  research: Awaited<ReturnType<typeof runResearchAgent>>,
  account: { modelConfig: string | Prisma.JsonValue, writingStyle?: string | Prisma.JsonValue | null }
) {
  logSection('4. Writer Agent - 文章生成')

  const startTime = Date.now()
  try {
    const modelConfig = loadModelConfig(typeof account.modelConfig === 'string' ? account.modelConfig : account.modelConfig != null ? JSON.stringify(account.modelConfig) : account.modelConfig)
    const writingStyle = account.writingStyle ? JSON.parse(account.writingStyle as string) : undefined

    log('提示', 'Writer Agent 正在生成文章，可能需要 1-3 分钟...', 'yellow')

    const result = await runWriterAgent(topic, research, modelConfig, writingStyle)
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logResult(true, `写作完成，耗时 ${duration}s`)
    log('统计', `标题: ${result.title.slice(0, 40)}..., 字数: ${result.wordCount}, 摘要: ${result.summary.slice(0, 60)}...`)

    // 显示文章开头
    console.log(`\n${colors.dim}文章开头预览：${colors.reset}`)
    console.log(result.body.slice(0, 800) + '\n...')

    return result
  } catch (error) {
    logError('Writer Agent', error)
    throw error
  }
}

// 测试 5: Review Agent
async function testReviewAgent(
  writerResult: Awaited<ReturnType<typeof runWriterAgent>>,
  account: { modelConfig: string | Prisma.JsonValue }
) {
  logSection('5. Review Agent - 内容审核')

  const startTime = Date.now()
  try {
    const modelConfig = loadModelConfig(typeof account.modelConfig === 'string' ? account.modelConfig : account.modelConfig != null ? JSON.stringify(account.modelConfig) : account.modelConfig)

    log('提示', 'Review Agent 正在审核文章，可能需要 1-2 分钟...', 'yellow')

    const result = await runReviewAgent(writerResult.title, writerResult.body, modelConfig)
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    const scoreColor = result.score >= 7.0 ? 'green' : result.score >= 5.0 ? 'yellow' : 'red'
    logResult(result.passed, `审核完成，耗时 ${duration}s，得分: ${result.score}/10`)

    log('维度评分', `观点深度: ${result.dimensionScores.perspective}, 结构: ${result.dimensionScores.structure}, 数据支撑: ${result.dimensionScores.dataSupport}, 流畅度: ${result.dimensionScores.fluency}`)

    // 显示问题列表
    if (result.issues.length > 0) {
      console.log(`\n${colors.dim}发现的问题：${colors.reset}`)
      result.issues.slice(0, 5).forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue.slice(0, 120)}...`)
      })
    }

    // 显示建议
    if (result.suggestions.length > 0) {
      console.log(`\n${colors.dim}改进建议：${colors.reset}`)
      result.suggestions.slice(0, 3).forEach((suggestion, i) => {
        console.log(`  ${i + 1}. ${suggestion.slice(0, 120)}...`)
      })
    }

    return result
  } catch (error) {
    logError('Review Agent', error)
    throw error
  }
}

// 主函数
async function main() {
  console.log(`
${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        Content Center - 全量 Agent 测试套件                 ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
${colors.reset}`)

  const startTime = Date.now()
  let successCount = 0
  let failCount = 0

  try {
    // 获取测试账号
    const account = await getTestAccount()
    log('配置', '测试账号准备就绪', 'blue')

    // 测试 1: Trend Agent
    try {
      const trendResult = await testTrendAgent()
      successCount++

      // 测试 2: Topic Agent
      const topicResult = await testTopicAgent(trendResult, account)
      successCount++

      // 选择第一个选题继续测试
      const selectedTopic = topicResult.topics[0]
      if (!selectedTopic) {
        throw new Error('没有生成可用选题')
      }

      // 测试 3: Research Agent (需要真实调用搜索工具)
      log('跳过', 'Research Agent 需要真实调用搜索工具，跳过（可手动取消注释测试）', 'yellow')
      // const researchResult = await testResearchAgent(selectedTopic, account)
      // successCount++

      // 使用模拟研究数据测试 Writer
      const mockResearch = {
        summary: '这是一个模拟的研究摘要，用于测试 Writer Agent。实际研究中会包含详细的数据、案例和专家观点。',
        keyPoints: [
          'AI市场规模预计在2025年达到1000亿美元',
          'OpenAI、Anthropic、Google是主要玩家',
          '中国AI企业也在快速崛起',
        ],
        sources: [
          { title: 'Gartner AI Report 2024', url: 'https://example.com/1', verified: true },
          { title: 'MIT Technology Review', url: 'https://example.com/2', verified: true },
        ],
        rawOutput: '完整的研究报告内容，包含详细的数据分析、案例研究和专家观点引用。',
      }

      // 测试 4: Writer Agent
      const writerResult = await testWriterAgent(selectedTopic, mockResearch as any, account)
      successCount++

      // 测试 5: Review Agent
      const reviewResult = await testReviewAgent(writerResult, account)
      successCount++

    } catch (error) {
      failCount++
      logError('Agent 测试', error)
    }

  } catch (error) {
    failCount++
    logError('测试初始化', error)
  } finally {
    await prisma.$disconnect()
  }

  // 测试总结
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log(`
${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════╗
║                      测试总结                             ║
╠══════════════════════════════════════════════════════════╣
║  总耗时: ${totalTime.padStart(8)}s                                     ║
║  成功: ${String(successCount).padStart(10)}                                  ║
║  失败: ${String(failCount).padStart(10)}                                  ║
╚══════════════════════════════════════════════════════════╝
${colors.reset}`)

  process.exit(failCount > 0 ? 1 : 0)
}

// 运行测试
main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
