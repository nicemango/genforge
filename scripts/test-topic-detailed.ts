/**
 * Topic Agent 详细测试脚本
 *
 * 用法:
 *   npx tsx scripts/test-topic-detailed.ts                          # 先抓 RSS，再选题（默认 5 个）
 *   npx tsx scripts/test-topic-detailed.ts --count 3               # 生成 3 个选题
 *   npx tsx scripts/test-topic-detailed.ts --max-input 30          # 最多取 30 条趋势作为输入
 *   npx tsx scripts/test-topic-detailed.ts --from-file <path.json> # 从 trend 测试的 JSON 报告加载趋势数据
 *
 * 环境变量:
 *   DEFAULT_AI_API_KEY   必填
 *   DEFAULT_AI_BASE_URL  可选
 *   DEFAULT_AI_MODEL     可选（默认 claude-sonnet-4-6）
 */

import { runTrendAgent } from '@/agents/trend'
import { runTopicAgent, type TopicSuggestion } from '@/agents/topic'
import { getDefaultModelConfig } from '@/lib/config'
import { loadTopicConfig } from '@/lib/topic-config'
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

function parseArgs(): { count: number; maxInput: number; fromFile: string | null } {
  const args = process.argv.slice(2)
  let count = 5
  let maxInput = 60
  let fromFile: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[++i], 10)
      if (isNaN(count) || count < 1) {
        console.error(`${C.red}--count 必须是正整数${C.r}`)
        process.exit(1)
      }
    } else if (args[i] === '--max-input' && args[i + 1]) {
      maxInput = parseInt(args[++i], 10)
      if (isNaN(maxInput) || maxInput < 1) {
        console.error(`${C.red}--max-input 必须是正整数${C.r}`)
        process.exit(1)
      }
    } else if (args[i] === '--from-file' && args[i + 1]) {
      fromFile = args[++i]
    }
  }

  return { count, maxInput, fromFile }
}

// ---------------------------------------------------------------------------
// Load trend items from a trend report JSON (produced by test-trend-detailed.ts)
// ---------------------------------------------------------------------------

interface TrendReportItem {
  title: string
  link: string
  pubDate: string
  snippet: string
  source: string
}

interface TrendReport {
  trends: TrendReportItem[]
  totalArticles?: number
  topic?: string
}

function loadTrendFromFile(filePath: string): TrendReportItem[] {
  const resolved = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(resolved)) {
    console.error(`${C.red}文件不存在: ${resolved}${C.r}`)
    process.exit(1)
  }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'))
  } catch (err) {
    console.error(`${C.red}JSON 解析失败: ${err instanceof Error ? err.message : String(err)}${C.r}`)
    process.exit(1)
  }
  const report = raw as TrendReport
  if (!Array.isArray(report.trends)) {
    console.error(`${C.red}文件格式不正确，缺少 "trends" 数组${C.r}`)
    process.exit(1)
  }
  return report.trends
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

interface TopicReport {
  runAt: string
  durationMs: number
  inputItemCount: number
  requestedCount: number
  outputCount: number
  topics: TopicSuggestion[]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { count, maxInput, fromFile } = parseArgs()

  console.log(`
${C.cyan}${C.br}
╔══════════════════════════════════════════════════════════════╗
║           Topic Agent 详细测试 - 选题筛选流程                 ║
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

  const topicCfg = loadTopicConfig()
  log('选题数量', `${count}  (config: ${topicCfg.count}, env: TOPIC_COUNT)`, 'blue')
  log('最大输入条数', `${maxInput}  (config: ${topicCfg.maxInputItems}, env: TOPIC_MAX_INPUT_ITEMS)`, 'blue')
  log('temperature', `${topicCfg.temperature}  (env: TOPIC_TEMPERATURE)`, 'blue')
  log('maxTokens', `${topicCfg.maxTokens}  (env: TOPIC_MAX_TOKENS)`, 'blue')
  log('数据来源', fromFile ? `文件: ${fromFile}` : '实时抓取 RSS')

  // ---- 步骤 1: 获取趋势数据 ----
  logStep(1, fromFile ? '从文件加载趋势数据' : '运行 Trend Agent 抓取趋势')

  let trendItems: TrendReportItem[]

  if (fromFile) {
    trendItems = loadTrendFromFile(fromFile)
    log('加载完成', `${trendItems.length} 条趋势`, 'green')
  } else {
    log('提示', '正在抓取 RSS 源，约需 15-30 秒...', 'yellow')
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
    log('源统计', `成功 ${trendResult.stats.success} / ${trendResult.stats.total}，失败 ${trendResult.stats.failed}`)
    trendItems = trendResult.items
  }

  if (trendItems.length === 0) {
    console.error(`${C.red}没有可用的趋势数据，终止${C.r}`)
    process.exit(1)
  }

  const inputItems = trendItems.slice(0, maxInput)
  log('实际输入', `${inputItems.length} 条（共 ${trendItems.length} 条，取前 ${maxInput}）`)

  // ---- 步骤 2: 运行 Topic Agent ----
  logStep(2, '运行 Topic Agent', `调用 LLM 筛选 ${count} 个选题，约需 30-90 秒...`)

  const topicStart = Date.now()
  let topicResult
  try {
    topicResult = await runTopicAgent(inputItems as Parameters<typeof runTopicAgent>[0], modelConfig, { count, maxInputItems: maxInput })
  } catch (err) {
    console.error(`${C.red}Topic Agent 失败: ${err instanceof Error ? err.message : String(err)}${C.r}`)
    process.exit(1)
  }
  const topicDurationMs = Date.now() - topicStart
  const topicDuration = (topicDurationMs / 1000).toFixed(1)

  log('选题完成', `生成 ${topicResult.topics.length} 个，耗时 ${topicDuration}s`, 'green')

  // ---- 步骤 3: 展示选题 ----
  logStep(3, '选题结果详情', `共 ${topicResult.topics.length} 个`)

  topicResult.topics.forEach((topic, i) => {
    const heatBar = '█'.repeat(Math.ceil(topic.heatScore / 2)) + '░'.repeat(5 - Math.ceil(topic.heatScore / 2))
    console.log(`
${C.cyan}${C.br}┌─ 选题 ${i + 1} / ${topicResult.topics.length} ${'─'.repeat(50)}${C.r}
${C.br}标题:${C.r}  ${topic.title}
${C.br}角度:${C.r}  ${topic.angle}
${C.br}摘要:${C.r}  ${topic.summary}
${C.br}热度:${C.r}  ${C.yellow}${heatBar}${C.r} ${topic.heatScore}/10
${C.br}标签:${C.r}  ${topic.tags.map((t) => `[${t}]`).join(' ')}
${C.br}来源:${C.r}`)
    topic.sources.forEach((s) => {
      console.log(`       ${C.dim}${s.source}${C.r} - ${s.title.slice(0, 60)}`)
      console.log(`       ${C.blue}${s.url}${C.r}`)
    })
    console.log(`${C.cyan}${C.br}└${'─'.repeat(57)}${C.r}`)
  })

  // ---- 步骤 4: 热度排行 ----
  logStep(4, '热度排行')
  const sorted = [...topicResult.topics].sort((a, b) => b.heatScore - a.heatScore)
  sorted.forEach((topic, i) => {
    const medal = i === 0 ? `${C.yellow}▶${C.r}` : i === 1 ? `${C.dim}▶${C.r}` : `${C.dim} ${C.r}`
    console.log(`  ${medal} ${i + 1}. [${topic.heatScore}/10] ${topic.title}`)
  })

  // ---- 步骤 5: 保存报告 ----
  logStep(5, '保存报告')

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = path.resolve(process.cwd(), 'test-output')
  fs.mkdirSync(outDir, { recursive: true })

  const report: TopicReport = {
    runAt: new Date().toISOString(),
    durationMs: topicDurationMs,
    inputItemCount: inputItems.length,
    requestedCount: count,
    outputCount: topicResult.topics.length,
    topics: topicResult.topics,
  }

  const jsonPath = path.join(outDir, `topic-${runId}.json`)
  const mdPath = path.join(outDir, `topic-${runId}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8')

  const md = [
    `# Topic Agent 选题报告`,
    ``,
    `**运行时间**: ${report.runAt}`,
    `**耗时**: ${(report.durationMs / 1000).toFixed(1)}s`,
    `**输入条数**: ${report.inputItemCount}`,
    `**输出选题**: ${report.outputCount} 个`,
    ``,
    `## 选题列表`,
    ...topicResult.topics.map(
      (topic, i) => [
        ``,
        `### ${i + 1}. ${topic.title}`,
        ``,
        `**热度**: ${topic.heatScore}/10`,
        ``,
        `**角度**: ${topic.angle}`,
        ``,
        `**摘要**: ${topic.summary}`,
        ``,
        `**标签**: ${topic.tags.join(', ')}`,
        ``,
        `**来源**:`,
        ...topic.sources.map((s) => `- [${s.title}](${s.url}) — ${s.source}`),
      ].join('\n'),
    ),
  ].join('\n')

  fs.writeFileSync(mdPath, md, 'utf-8')

  // ---- 总结 ----
  console.log(`
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
  Topic Agent 选题完成
  输入: ${inputItems.length} 条趋势
  输出: ${topicResult.topics.length} 个选题
  耗时: ${topicDuration}s
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}

${C.cyan}JSON 详细报告: ${jsonPath}${C.r}
${C.cyan}Markdown 摘要: ${mdPath}${C.r}
`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
