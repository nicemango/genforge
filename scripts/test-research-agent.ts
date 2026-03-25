/**
 * Research Agent 详细测试脚本
 *
 * 用法:
 *   npx tsx scripts/test-research-agent.ts                          # 完整流程（Trend → Topic → Research）
 *   npx tsx scripts/test-research-agent.ts --from-file <path.json> # 从 topic 报告加载选题
 *
 * 环境变量:
 *   DEFAULT_AI_API_KEY   必填
 *   DEFAULT_AI_BASE_URL  可选
 *   DEFAULT_AI_MODEL     可选（默认 claude-sonnet-4-6）
 */

import { runTrendAgent } from '@/agents/trend'
import { runTopicAgent, type TopicSuggestion } from '@/agents/topic'
import { runResearchAgent } from '@/agents/research'
import { getDefaultModelConfig } from '@/lib/config'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const C = {
  r: '\x1b[0m',
  br: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

function log(title: string, content?: string, color: keyof typeof C = 'r') {
  const c = C[color]
  if (content !== undefined) {
    console.log(`${c}${C.br}[${title}]${C.r} ${content}`)
  } else {
    console.log(`\n${c}${C.br}━━ ${title} ━━${C.r}`)
  }
}

function logStep(n: number, title: string, desc?: string) {
  console.log(`\n${C.yellow}${C.br}步骤 ${n}: ${title}${C.r}`)
  if (desc) console.log(`${C.dim}${desc}${C.r}`)
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { topicIndex: number; fromFile: string | null } {
  const args = process.argv.slice(2)
  let topicIndex = 0
  let fromFile: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-file' && args[i + 1]) {
      fromFile = args[++i]
    } else if (args[i] === '--topic-index' && args[i + 1]) {
      topicIndex = parseInt(args[++i], 10)
      if (isNaN(topicIndex) || topicIndex < 0) {
        console.error(`${C.red}--topic-index 必须是正整数${C.r}`)
        process.exit(1)
      }
    }
  }

  return { topicIndex, fromFile }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopicReport {
  topics: TopicSuggestion[]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { topicIndex, fromFile } = parseArgs()

  console.log(`
${C.cyan}${C.br}
╔══════════════════════════════════════════════════════════════╗
║           Research Agent 详细测试 - 深度研究流程              ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`)

  // ---- 步骤 0: 配置 ----
  logStep(0, '配置信息')

  let modelConfig
  try {
    modelConfig = getDefaultModelConfig()
  } catch (err) {
    console.error(`${C.red}${err instanceof Error ? err.message : String(err)}${C.r}`)
    process.exit(1)
  }

  log('模型', `${modelConfig.model} (${modelConfig.provider})`, 'blue')
  log('选题来源', fromFile ? `文件: ${fromFile}` : '实时生成')
  log('选题索引', `${topicIndex}`)

  // ---- 步骤 1: 获取选题 ----
  let selectedTopic: TopicSuggestion

  if (fromFile) {
    const resolved = path.resolve(process.cwd(), fromFile)
    if (!fs.existsSync(resolved)) {
      console.error(`${C.red}文件不存在: ${resolved}${C.r}`)
      process.exit(1)
    }
    const report: TopicReport = JSON.parse(fs.readFileSync(resolved, 'utf-8'))
    if (!report.topics || report.topics.length === 0) {
      console.error(`${C.red}文件中没有选题${C.r}`)
      process.exit(1)
    }
    selectedTopic = report.topics[Math.min(topicIndex, report.topics.length - 1)]
    log('加载完成', `选题: ${selectedTopic.title}`, 'green')
  } else {
    // 完整流程：Trend → Topic → Research
    logStep(1, '运行 Trend Agent 抓取趋势', '约需 15-30 秒...')

    const trendStart = Date.now()
    let trendResult
    try {
      trendResult = await runTrendAgent()
    } catch (err) {
      console.error(`${C.red}Trend Agent 失败: ${err instanceof Error ? err.message : String(err)}${C.r}`)
      process.exit(1)
    }
    const trendDuration = ((Date.now() - trendStart) / 1000).toFixed(1)
    log('抓取完成', `${trendResult.items.length} 条，耗时 ${trendDuration}s`, 'green')

    if (trendResult.items.length === 0) {
      console.error(`${C.red}没有可用趋势数据，终止${C.r}`)
      process.exit(1)
    }

    logStep(2, '运行 Topic Agent 筛选选题', '约需 30-90 秒...')

    const topicStart = Date.now()
    let topicResult
    try {
      topicResult = await runTopicAgent(trendResult.items, modelConfig, { count: 3 })
    } catch (err) {
      console.error(`${C.red}Topic Agent 失败: ${err instanceof Error ? err.message : String(err)}${C.r}`)
      process.exit(1)
    }
    const topicDuration = ((Date.now() - topicStart) / 1000).toFixed(1)

    if (topicResult.topics.length === 0) {
      console.error(`${C.red}没有生成可用选题，终止${C.r}`)
      process.exit(1)
    }

    log('选题完成', `生成 ${topicResult.topics.length} 个，耗时 ${topicDuration}s`, 'green')

    // 选择指定索引的选题
    const idx = Math.min(topicIndex, topicResult.topics.length - 1)
    selectedTopic = topicResult.topics[idx]
    log('选中选题', `${idx}: ${selectedTopic.title}`, 'yellow')
  }

  // 显示选题详情
  console.log(`\n${C.cyan}选题详情：${C.r}`)
  console.log(`${C.br}标题:${C.r}  ${selectedTopic.title}`)
  console.log(`${C.br}角度:${C.r}  ${selectedTopic.angle}`)
  console.log(`${C.br}摘要:${C.r}  ${selectedTopic.summary.slice(0, 200)}...`)
  console.log(`${C.br}热度:${C.r}  ${selectedTopic.heatScore}/10`)
  console.log(`${C.br}标签:${C.r}  ${selectedTopic.tags.join(', ')}`)
  console.log(`${C.br}来源:${C.r}`)
  selectedTopic.sources.forEach((s) => {
    console.log(`       ${C.dim}${s.source}${C.r} - ${s.title.slice(0, 60)}`)
    console.log(`       ${C.blue}${s.url}${C.r}`)
  })

  // ---- 步骤 3: 运行 Research Agent ----
  logStep(3, '运行 Research Agent', '深度研究，需要搜索 + 抓取，约需 3-8 分钟...\n')
  log('提示', '此过程会执行 10+ 次搜索和 5-6 次网页抓取，请耐心等待...', 'yellow')

  const researchStart = Date.now()
  let researchResult
  try {
    researchResult = await runResearchAgent(selectedTopic, modelConfig)
  } catch (err) {
    console.error(`${C.red}Research Agent 失败: ${err instanceof Error ? err.message : String(err)}${C.r}`)
    process.exit(1)
  }
  const researchDuration = ((Date.now() - researchStart) / 1000).toFixed(1)

  log('研究完成', `耗时 ${researchDuration}s`, 'green')
  log('统计', `关键要点: ${researchResult.keyPoints.length} 条, 来源: ${researchResult.sources.length} 个`)

  // 显示来源验证状态
  console.log(`\n${C.cyan}来源验证状态：${C.r}`)
  researchResult.sources.forEach((s) => {
    const status = s.verified ? `${C.green}✓ 已验证${C.r}` : `${C.yellow}○ 待验证${C.r}`
    console.log(`  ${status} ${s.title.slice(0, 50)}`)
  })

  // 显示关键要点
  console.log(`\n${C.cyan}关键要点预览（前 10 条）：${C.r}`)
  researchResult.keyPoints.slice(0, 10).forEach((point, i) => {
    console.log(`  ${i + 1}. ${point.slice(0, 100)}${point.length > 100 ? '...' : ''}`)
  })

  // 显示研究摘要
  console.log(`\n${C.cyan}研究摘要：${C.r}`)
  console.log(researchResult.summary.slice(0, 800) + '...\n')

  // ---- 步骤 4: 保存报告 ----
  logStep(4, '保存报告')

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = path.resolve(process.cwd(), 'test-output')
  fs.mkdirSync(outDir, { recursive: true })

  const report = {
    runAt: new Date().toISOString(),
    durationMs: Date.now() - researchStart,
    topic: selectedTopic,
    research: researchResult,
  }

  const jsonPath = path.join(outDir, `research-${runId}.json`)
  const mdPath = path.join(outDir, `research-${runId}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8')

  const md = [
    `# Research Agent 研究报告`,
    ``,
    `**运行时间**: ${report.runAt}`,
    `**耗时**: ${(report.durationMs / 1000).toFixed(1)}s`,
    ``,
    `## 选题`,
    `**标题**: ${selectedTopic.title}`,
    `**角度**: ${selectedTopic.angle}`,
    `**摘要**: ${selectedTopic.summary}`,
    ``,
    `## 研究结果`,
    ``,
    `### 关键要点 (${researchResult.keyPoints.length} 条)`,
    ...researchResult.keyPoints.map((p, i) => `- ${i + 1}. ${p}`),
    ``,
    `### 来源 (${researchResult.sources.length} 个)`,
    ...researchResult.sources.map((s) => `- [${s.verified ? '✓' : '○'}] ${s.title} — ${s.url}`),
    ``,
    `### 原始输出`,
    `\`\`\`\n${researchResult.rawOutput.slice(0, 3000)}\n\`\`\`\``,
  ].join('\n')

  fs.writeFileSync(mdPath, md, 'utf-8')

  // ---- 总结 ----
  console.log(`
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
  Research Agent 研究完成
  选题: ${selectedTopic.title}
  耗时: ${researchDuration}s
  关键要点: ${researchResult.keyPoints.length} 条
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}

${C.cyan}JSON 详细报告: ${jsonPath}${C.r}
${C.cyan}Markdown 摘要: ${mdPath}${C.r}
`)

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
