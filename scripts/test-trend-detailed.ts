/**
 * Trend Agent 详细测试脚本
 *
 * 用法:
 *   npx tsx scripts/test-trend-detailed.ts                    # 使用配置文件 config/trend-agent.json
 *   npx tsx scripts/test-trend-detailed.ts --topic society   # CLI 参数覆盖配置文件
 *   npx tsx scripts/test-trend-detailed.ts --topic ai --fresh-days 3
 *   npx tsx scripts/test-trend-detailed.ts list                # 列出所有可用话题
 *
 * 配置优先级：CLI > ENV > config/trend-agent.json > 代码默认值
 */

import { createFetchRssTool } from '@/tools/fetch-rss'
import {
  TOPICS,
  DEFAULT_TOPIC,
  getTopicConfig,
  getSourcesForTopic,
  getTopicFilter,
} from '@/lib/rss-sources'
import { loadTrendConfig } from '@/lib/trend-config'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceResult {
  name: string
  url: string
  category: string
  success: boolean
  articleCount: number
  error?: string
  articles: Array<{
    title: string
    link: string
    pubDate: string
    snippet: string
  }>
}

interface RunReport {
  runAt: string
  topic: string
  config: {
    topic: string
    maxArticlesPerSource: number
    freshDays: number
    outputDir: string
  }
  totalSources: number
  successCount: number
  failedCount: number
  totalArticles: number
  durationMs: number
  sources: SourceResult[]
  trends: Array<{
    title: string
    link: string
    pubDate: string
    snippet: string
    source: string
  }>
}

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
}

function log(title: string, content?: string, color: keyof typeof C = 'r') {
  const c = C[color]
  if (content) {
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
// Deduplicate & filter
// ---------------------------------------------------------------------------

function deduplicate<T extends { link: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item.link) return true
    const k = item.link.toLowerCase().trim()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function filterRecent<T extends { pubDate: string }>(items: T[], days: number): T[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return items.filter((item) => {
    if (!item.pubDate) return true
    const t = new Date(item.pubDate).getTime()
    return !isNaN(t) && t >= cutoff
  })
}

function filterByTopic<T extends { title: string; snippet: string }>(
  items: T[],
  ALLOWED_KEYWORDS: string[],
  BLOCKED_KEYWORDS: string[],
): { items: T[]; filteredCount: number } {
  const allowed = ALLOWED_KEYWORDS.length > 0
  const blocked = BLOCKED_KEYWORDS.length > 0
  if (!allowed && !blocked) return { items, filteredCount: 0 }

  let filteredCount = 0
  const filtered = items.filter((item) => {
    const text = `${item.title} ${item.snippet}`.toLowerCase()
    for (const kw of BLOCKED_KEYWORDS) {
      if (text.includes(kw.toLowerCase())) { filteredCount++; return false }
    }
    if (allowed) {
      const hasAllowed = ALLOWED_KEYWORDS.some((kw: string) => text.includes(kw.toLowerCase()))
      if (!hasAllowed) { filteredCount++; return false }
    }
    return true
  })
  return { items: filtered, filteredCount }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // ---- 列出话题 ----
  if (process.argv.includes('list')) {
    console.log(`\n${C.cyan}${C.br}可用话题：${C.r}`)
    for (const t of TOPICS) {
      console.log(`  ${C.green}${t.id.padEnd(12)}${C.r} ${t.name}  - ${t.description}`)
    }
    console.log()
    return
  }

  // ---- 加载配置（优先级：CLI > ENV > config file > default） ----
  const cfg = loadTrendConfig()

  // 验证话题
  let topic
  try {
    topic = getTopicConfig(cfg.topic)
  } catch (err) {
    const available = TOPICS.map((t) => t.id).join(', ')
    console.error(`${C.red}未知话题 "${cfg.topic}"，可用话题: ${available}${C.r}`)
    process.exit(1)
  }

  const sources = getSourcesForTopic(topic)
  const { ALLOWED_KEYWORDS, BLOCKED_KEYWORDS } = getTopicFilter(topic)

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = path.resolve(process.cwd(), cfg.outputDir)
  fs.mkdirSync(outDir, { recursive: true })

  console.log(`
${C.cyan}${C.br}
╔══════════════════════════════════════════════════════════════╗
║           Trend Agent 详细测试 - RSS 趋势抓取流程             ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`)

  logStep(0, '配置信息')
  log('话题', `${topic.name} (${topic.id})`, 'blue')
  log('RSS 源', `${sources.length} 个（${topic.sourceCategories?.join(', ') ?? '全部'}）`)
  log('每源文章数', `${cfg.maxArticlesPerSource}`)
  log('保留天数', `${cfg.freshDays} 天`)
  log('输出目录', outDir)

  // ---- 并发抓取每个源 ----
  logStep(1, '并发抓取所有 RSS 源', `每源 timeout=15s，重试=3次`)

  const fetchTool = createFetchRssTool({
    defaultLimit: cfg.maxArticlesPerSource,
    maxLimit: cfg.maxArticlesPerSource + 10,
  })
  const startTime = Date.now()

  const rawResults = await Promise.allSettled(
    sources.map(async (source): Promise<SourceResult> => {
      let lastError = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetchTool.execute({ url: source.url, limit: cfg.maxArticlesPerSource })
        if (res.success) {
          const parsed = JSON.parse(res.output) as {
            feedTitle: string
            articles: Array<{ title: string; link: string; pubDate: string; snippet: string }>
          }
          return {
            name: source.name,
            url: source.url,
            category: source.category,
            success: true,
            articleCount: parsed.articles.length,
            articles: parsed.articles,
          }
        }
        lastError = res.error ?? 'unknown'
      }
      return {
        name: source.name,
        url: source.url,
        category: source.category,
        success: false,
        articleCount: 0,
        error: lastError,
        articles: [],
      }
    }),
  )

  const durationMs = Date.now() - startTime

  const sourceResults: SourceResult[] = rawResults.map((r, i) => {
    if (r.status === 'rejected') {
      return {
        name: sources[i].name,
        url: sources[i].url,
        category: sources[i].category,
        success: false,
        articleCount: 0,
        error: String(r.reason),
        articles: [],
      }
    }
    return r.value
  })

  const successResults = sourceResults.filter((s) => s.success)
  const failedResults = sourceResults.filter((s) => !s.success)

  // ---- 统计 ----
  logStep(2, '抓取统计')
  log('总耗时', `${(durationMs / 1000).toFixed(1)} 秒`)
  log('成功源', `${successResults.length} / ${sourceResults.length}`, 'green')
  if (failedResults.length > 0) {
    log('失败源', `${failedResults.length}`, 'yellow')
  } else {
    log('失败源', `0`, 'green')
  }

  // ---- 每个源的状态 ----
  logStep(3, '各源抓取状态')
  sourceResults.forEach((s) => {
    if (s.success) {
      console.log(`  ${C.green}✅${C.r}  ${C.br}${s.name}${C.r}  ${C.dim}(${s.category})${C.r}  →  ${s.articleCount} 条`)
    } else {
      console.log(`  ${C.red}❌${C.r}  ${C.br}${s.name}${C.r}  ${C.dim}(${s.category})${C.r}  →  ${C.red}${s.error?.slice(0, 60)}${C.r}`)
    }
  })

  // ---- 汇总所有文章 -> 去重 -> 过滤 ----
  logStep(4, '数据处理', `合并 → URL去重 → ${cfg.freshDays}天过滤 → 主题关键词过滤`)

  type ArticleWithSource = { title: string; link: string; pubDate: string; snippet: string; source: string }
  const allArticles: ArticleWithSource[] = sourceResults.flatMap((s) =>
    s.articles.map((a) => ({ ...a, source: s.name })),
  )

  const deduplicated = deduplicate(allArticles)
  const recent = filterRecent(deduplicated, cfg.freshDays)
  const { items: fresh, filteredCount: topicFilteredCount } = filterByTopic(
    recent,
    ALLOWED_KEYWORDS,
    BLOCKED_KEYWORDS,
  )

  log('去重前', `${allArticles.length} 条`)
  log('URL去重后', `${deduplicated.length} 条`)
  log(`${cfg.freshDays}天内过滤后`, `${recent.length} 条`)
  log('主题过滤后', `${fresh.length} 条（丢弃 ${topicFilteredCount} 条）`, topicFilteredCount > 0 ? 'yellow' : 'green')

  // ---- 生成文件 ----
  const report: RunReport = {
    runAt: new Date().toISOString(),
    topic: topic.id,
    config: {
      topic: cfg.topic,
      maxArticlesPerSource: cfg.maxArticlesPerSource,
      freshDays: cfg.freshDays,
      outputDir: cfg.outputDir,
    },
    totalSources: sourceResults.length,
    successCount: successResults.length,
    failedCount: failedResults.length,
    totalArticles: fresh.length,
    durationMs,
    sources: sourceResults,
    trends: fresh,
  }

  const jsonPath = path.join(outDir, `trend-${topic.id}-${runId}.json`)
  const mdPath = path.join(outDir, `trend-${topic.id}-${runId}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8')

  // 生成 Markdown 摘要
  const md = [
    `# Trend Agent 抓取报告`,
    ``,
    `**话题**: ${topic.name} (${topic.id})`,
    `**运行时间**: ${report.runAt}`,
    `**总耗时**: ${(report.durationMs / 1000).toFixed(1)}s`,
    `**RSS 源**: ${report.successCount}/${report.totalSources} 成功`,
    ``,
    `## 成功源 (${successResults.length})`,
    ...successResults.map(
      (s) => `- **${s.name}** (${s.category}): ${s.articleCount} 条`,
    ),
    ``,
    `## 失败源 (${failedResults.length})`,
    ...failedResults.map((s) => `- **${s.name}** (${s.category}): ${s.error}`),
    ``,
    `## 趋势文章 (${fresh.length} 条)`,
    ...fresh.map(
      (t, i) =>
        `${i + 1}. [${t.title}](${t.link})\n   - 来源: ${t.source} | 时间: ${t.pubDate}\n   - ${t.snippet.slice(0, 100)}...`,
    ),
  ].join('\n')

  fs.writeFileSync(mdPath, md, 'utf-8')

  // ---- 趋势文章列表（控制台）----
  logStep(5, '趋势文章列表', `共 ${fresh.length} 条（显示前 20 条）`)
  console.log()

  fresh.slice(0, 20).forEach((item, i) => {
    console.log(`  ${C.cyan}[${i + 1}]${C.br} ${item.title.slice(0, 80)}${C.r}`)
    console.log(`      ${C.yellow}来源:${C.r} ${item.source}  ${C.yellow}时间:${C.r} ${item.pubDate}`)
    console.log(`      ${C.dim}${item.snippet.slice(0, 100)}...${C.r}`)
    console.log(`      ${C.dim}链接:${C.r} ${item.link}${C.r}`)
    console.log()
  })

  if (fresh.length > 20) {
    console.log(`  ${C.dim}... 还有 ${fresh.length - 20} 条，请查看 JSON 文件${C.r}`)
  }

  // ---- 总结 ----
  console.log(`
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
  ✅ Trend Agent 抓取完成
  话题: ${topic.name}
  成功: ${successResults.length}/${sourceResults.length} 源
  文章: ${fresh.length} 条（去重+过滤后）
  耗时: ${(durationMs / 1000).toFixed(1)}s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}

${C.cyan}📄 JSON 详细报告: ${jsonPath}${C.r}
${C.cyan}📄 Markdown 摘要: ${mdPath}${C.r}
`)
}

main().catch(console.error)
