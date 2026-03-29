/**
 * Topic Agent V2 详细测试脚本 - 价值洼地策略
 *
 * 用法:
 *   npx tsx scripts/test-topic-detailed.ts                          # 从最新 trend JSON 加载数据并选题
 *   npx tsx scripts/test-topic-detailed.ts --count 3               # 生成 3 个选题
 *   npx tsx scripts/test-topic-detailed.ts --max-input 30           # 最多取 30 条趋势作为输入
 *   npx tsx scripts/test-topic-detailed.ts --from-file <path.json>  # 从指定文件加载趋势数据
 *   npx tsx scripts/test-topic-detailed.ts --fresh                  # 强制重新抓 RSS（跳过从文件加载）
 *
 * 环境变量:
 *   DEFAULT_AI_API_KEY   必填
 *   DEFAULT_AI_BASE_URL  可选
 *   DEFAULT_AI_MODEL     可选（默认 claude-sonnet-4-6）
 */

import { runTrendAgent } from "@/agents/trend";
import {
  runTopicAgent,
  type TopicSuggestionV2,
  type TopicAgentV2Result,
} from "@/agents/topic";
import { getAgentModelConfig } from "@/config/llm";
import { loadTopicConfig } from "@/lib/topic-config";
import * as fs from "fs";
import * as path from "path";

/**
 * 查找最新的 trend JSON 文件（默认行为：自动加载最新）
 */
function findLatestTrendFile(): string | null {
  const trendDir = path.resolve(process.cwd(), "output/trend-agent");
  if (!fs.existsSync(trendDir)) return null;

  const files = fs.readdirSync(trendDir)
    .filter((f) => f.startsWith("trend-") && f.endsWith(".json"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(trendDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files[0] ? path.join(trendDir, files[0].name) : null;
}

function loadLocalEnv() {
  const files = [".env.local", ".env"];
  for (const file of files) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;

    const content = fs.readFileSync(p, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const normalized = line.startsWith("export ")
        ? line.slice("export ".length).trim()
        : line;
      const idx = normalized.indexOf("=");
      if (idx <= 0) continue;

      const key = normalized.slice(0, idx).trim();
      if (!key) continue;
      if (process.env[key] != null) continue;

      let value = normalized.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const C = {
  r: "\x1b[0m",
  br: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(title: string, content?: string, color: keyof typeof C = "r") {
  const c = C[color];
  if (content !== undefined) {
    console.log(`${c}${C.br}[${title}]${C.r} ${content}`);
  } else {
    console.log(`\n${c}${C.br}━━ ${title} ━━${C.r}`);
  }
}

function logStep(n: number, title: string, desc?: string) {
  console.log(`\n${C.yellow}${C.br}步骤 ${n}: ${title}${C.r}`);
  if (desc) console.log(`${C.dim}${desc}${C.r}`);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): {
  count: number;
  maxInput: number;
  fromFile: string | null;
  fresh: boolean;
} {
  const args = process.argv.slice(2);
  let count = 5;
  let maxInput = 60;
  let fromFile: string | null = null;
  let fresh = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && args[i + 1]) {
      count = parseInt(args[++i], 10);
      if (isNaN(count) || count < 1) {
        console.error(`${C.red}--count 必须是正整数${C.r}`);
        process.exit(1);
      }
    } else if (args[i] === "--max-input" && args[i + 1]) {
      maxInput = parseInt(args[++i], 10);
      if (isNaN(maxInput) || maxInput < 1) {
        console.error(`${C.red}--max-input 必须是正整数${C.r}`);
        process.exit(1);
      }
    } else if (args[i] === "--from-file" && args[i + 1]) {
      fromFile = args[++i];
    } else if (args[i] === "--fresh") {
      fresh = true;
    }
  }

  return { count, maxInput, fromFile, fresh };
}

// ---------------------------------------------------------------------------
// Load trend items from a trend report JSON (produced by test-trend-detailed.ts)
// ---------------------------------------------------------------------------

interface TrendReportItem {
  title: string;
  link: string;
  pubDate: string;
  snippet: string;
  source: string;
}

interface TrendReport {
  trends: TrendReportItem[];
  totalArticles?: number;
  topic?: string;
}

function loadTrendFromFile(filePath: string): TrendReportItem[] {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`${C.red}文件不存在: ${resolved}${C.r}`);
    process.exit(1);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  } catch (err) {
    console.error(
      `${C.red}JSON 解析失败: ${err instanceof Error ? err.message : String(err)}${C.r}`,
    );
    process.exit(1);
  }
  const report = raw as TrendReport;
  if (!Array.isArray(report.trends)) {
    console.error(`${C.red}文件格式不正确，缺少 "trends" 数组${C.r}`);
    process.exit(1);
  }
  return report.trends;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

interface TopicReport {
  runAt: string;
  durationMs: number;
  inputItemCount: number;
  requestedCount: number;
  outputCount: number;
  strategy: string;
  topics: TopicSuggestionV2[];
}

// ---------------------------------------------------------------------------
// Score display helpers
// ---------------------------------------------------------------------------

function scoreBar(score: number, max: number = 10): string {
  const filled = Math.ceil(score / 2);
  const empty = 5 - filled;
  return C.yellow + "█".repeat(filled) + C.dim + "░".repeat(empty) + C.r;
}

function redSeaBadge(level: "LOW" | "MEDIUM" | "HIGH"): string {
  switch (level) {
    case "LOW":
      return C.green + "[蓝海]" + C.r;
    case "MEDIUM":
      return C.yellow + "[黄海]" + C.r;
    case "HIGH":
      return C.red + "[红海]" + C.r;
  }
}

function strategyBadge(strategy: string): string {
  switch (strategy) {
    case "VALUE_CREVASSE":
      return C.cyan + "[价值洼地]" + C.r;
    case "EARLY_SIGNAL":
      return C.blue + "[早期信号]" + C.r;
    case "CONTRARIAN":
      return C.magenta + "[反共识]" + C.r;
    default:
      return strategy;
  }
}

function timeBadge(time: "NOW" | "WEEKS" | "MONTHS"): string {
  switch (time) {
    case "NOW":
      return C.red + "马上" + C.r;
    case "WEEKS":
      return C.yellow + "2-4周" + C.r;
    case "MONTHS":
      return C.green + "更久" + C.r;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { count, maxInput, fromFile, fresh } = parseArgs();
  loadLocalEnv();

  // 默认行为：自动找最新 trend JSON 文件
  const resolvedFromFile = fresh
    ? null
    : (fromFile ?? findLatestTrendFile());

  console.log(`
${C.cyan}${C.br}
╔══════════════════════════════════════════════════════════════╗
║       Topic Agent V2 详细测试 - 价值洼地策略                 ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`);

  // ---- 步骤 0: 配置 ----
  logStep(0, "配置信息");

  let modelConfig;
  try {
    modelConfig = getAgentModelConfig("topic");
  } catch (err) {
    console.error(
      `${C.red}${err instanceof Error ? err.message : String(err)}${C.r}`,
    );
    process.exit(1);
  }

  log("模型", `${modelConfig.model} (${modelConfig.provider})`, "blue");
  log("策略", "价值洼地 (V2)", "cyan");

  const topicCfg = loadTopicConfig();
  log(
    "选题数量",
    `${count}  (config: ${topicCfg.agent.count}, env: TOPIC_COUNT)`,
    "blue",
  );
  log(
    "最大输入条数",
    `${maxInput}  (config: ${topicCfg.agent.maxInputItems}, env: TOPIC_MAX_INPUT_ITEMS)`,
    "blue",
  );
  log(
    "temperature",
    `${topicCfg.agent.temperature}  (env: TOPIC_TEMPERATURE)`,
    "blue",
  );
  log(
    "maxTokens",
    `${topicCfg.agent.maxTokens}  (env: TOPIC_MAX_TOKENS)`,
    "blue",
  );
  log("数据来源", resolvedFromFile ? `文件: ${path.basename(resolvedFromFile)}` : "强制抓取 RSS（--fresh）");

  // ---- 步骤 1: 获取趋势数据 ----
  logStep(1, resolvedFromFile ? "从文件加载趋势数据" : "运行 Trend Agent 抓取趋势");

  let trendItems: TrendReportItem[];

  if (resolvedFromFile) {
    trendItems = loadTrendFromFile(resolvedFromFile);
    log("加载完成", `${trendItems.length} 条趋势`, "green");
  } else {
    log("提示", "正在抓取 RSS 源，约需 15-30 秒...", "yellow");
    const trendStart = Date.now();
    let trendResult;
    try {
      trendResult = await runTrendAgent();
    } catch (err) {
      console.error(
        `${C.red}Trend Agent 失败: ${err instanceof Error ? err.message : String(err)}${C.r}`,
      );
      process.exit(1);
    }
    const trendDuration = ((Date.now() - trendStart) / 1000).toFixed(1);
    log(
      "抓取完成",
      `${trendResult.items.length} 条，耗时 ${trendDuration}s`,
      "green",
    );
    log(
      "源统计",
      `成功 ${trendResult.stats.success} / ${trendResult.stats.total}，失败 ${trendResult.stats.failed}`,
    );
    trendItems = trendResult.items;
  }

  if (trendItems.length === 0) {
    console.error(`${C.red}没有可用的趋势数据，终止${C.r}`);
    process.exit(1);
  }

  const inputItems = trendItems.slice(0, maxInput);
  log(
    "实际输入",
    `${inputItems.length} 条（共 ${trendItems.length} 条，取前 ${maxInput}）`,
  );

  // ---- 步骤 2: 运行 Topic Agent V2 ----
  logStep(
    2,
    "运行 Topic Agent V2 (价值洼地策略)",
    `调用 LLM 筛选 ${count} 个选题，约需 30-90 秒...`,
  );

  console.log(`${C.dim}策略说明:${C.r}`);
  console.log(
    `${C.dim}  - 不追逐热点（heatScore 9-10），寻找被低估的话题${C.r}`,
  );
  console.log(`${C.dim}  - 使用反共识策略生成差异化角度${C.r}`);
  console.log(`${C.dim}  - 优先选择蓝海话题（redSeaLevel: LOW）${C.r}`);

  const topicStart = Date.now();
  let topicResult: TopicAgentV2Result;
  try {
    topicResult = await runTopicAgent(
      inputItems as Parameters<typeof runTopicAgent>[0],
      modelConfig,
      { count, maxInputItems: maxInput },
    );
  } catch (err) {
    console.error(
      `${C.red}Topic Agent V2 失败: ${err instanceof Error ? err.message : String(err)}${C.r}`,
    );
    process.exit(1);
  }
  const topicDurationMs = Date.now() - topicStart;
  const topicDuration = (topicDurationMs / 1000).toFixed(1);

  log(
    "选题完成",
    `生成 ${topicResult.topics.length} 个，耗时 ${topicDuration}s`,
    "green",
  );
  log("选用策略", strategyBadge(topicResult.strategy), "cyan");

  // ---- 步骤 3: 展示选题 ----
  logStep(3, "选题结果详情", `共 ${topicResult.topics.length} 个`);

  topicResult.topics.forEach((topic, i) => {
    console.log(`
${C.cyan}${C.br}┌─ 选题 ${i + 1} / ${topicResult.topics.length} ${"─".repeat(45)}${C.r}
${C.br}标题:${C.r}  ${topic.title}
${C.br}角度:${C.r}  ${C.magenta}${topic.angle}${C.r}
${C.br}摘要:${C.r}  ${topic.summary}
`);

    // V2 新增字段展示
    console.log(`${C.br}━━ V2 洼地评分 ━━${C.r}`);
    console.log(
      `  ${C.br}价值洼地:${C.r}  ${scoreBar(topic.valueScore)} ${topic.valueScore}/10  ${C.dim}(越高越洼地)${C.r}`,
    );
    console.log(
      `  ${C.br}热度评分:${C.r}  ${scoreBar(topic.heatScore)} ${topic.heatScore}/10  ${C.dim}(供参考)${C.r}`,
    );
    console.log(`  ${C.br}红海程度:${C.r}  ${redSeaBadge(topic.redSeaLevel)}`);
    console.log(
      `  ${C.br}成为热点:${C.r}  ${timeBadge(topic.timeToMainstream)}`,
    );
    console.log(
      `  ${C.br}反共识策略:${C.r} ${C.dim}${topic.contrarianAngle || "未指定"}${C.r}`,
    );

    console.log(`
${C.br}标签:${C.r}  ${topic.tags.map((t) => `[${t}]`).join(" ")}
${C.br}来源:${C.r}`);
    topic.sources.forEach((s) => {
      console.log(`       ${C.dim}${s.source}${C.r} - ${s.title.slice(0, 60)}`);
      console.log(`       ${C.blue}${s.url}${C.r}`);
    });
    console.log(`${C.cyan}${C.br}└${"─".repeat(57)}${C.r}`);
  });

  // ---- 步骤 4: 价值洼地排行（V2 核心） ----
  logStep(4, "价值洼地排行", "按 valueScore 排序，越高越值得写");

  const sorted = [...topicResult.topics].sort(
    (a, b) => b.valueScore - a.valueScore,
  );
  sorted.forEach((topic, i) => {
    const medal =
      i === 0 ? `${C.green}★` : i === 1 ? `${C.yellow}◆` : `${C.dim}◇`;
    const redSea = redSeaBadge(topic.redSeaLevel);
    console.log(
      `  ${medal} ${i + 1}. ${C.br}[洼地${topic.valueScore}][热度${topic.heatScore}]${C.r} ${redSea} ${topic.title}`,
    );
    console.log(`     ${C.dim}角度: ${topic.angle.slice(0, 50)}...${C.r}`);
  });

  // ---- 步骤 5: 红海分析 ----
  logStep(5, "红海分析", "各选题的竞争程度");

  const lowCount = topicResult.topics.filter(
    (t) => t.redSeaLevel === "LOW",
  ).length;
  const medCount = topicResult.topics.filter(
    (t) => t.redSeaLevel === "MEDIUM",
  ).length;
  const highCount = topicResult.topics.filter(
    (t) => t.redSeaLevel === "HIGH",
  ).length;

  console.log(
    `  ${C.green}蓝海(LOW):${C.r}   ${lowCount} 个  ${C.dim}(建议优先)${C.r}`,
  );
  console.log(
    `  ${C.yellow}黄海(MEDIUM):${C.r} ${medCount} 个  ${C.dim}(谨慎选择)${C.r}`,
  );
  console.log(
    `  ${C.red}红海(HIGH):${C.r}   ${highCount} 个  ${C.dim}(建议放弃)${C.r}`,
  );

  if (highCount > 0) {
    console.log(
      `\n${C.red}警告: ${highCount} 个选题处于红海，建议淘汰并重新生成${C.r}`,
    );
  }

  // ---- 步骤 6: 保存报告 ----
  logStep(6, "保存报告");

  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.resolve(process.cwd(), "test-output");
  fs.mkdirSync(outDir, { recursive: true });

  const report: TopicReport = {
    runAt: new Date().toISOString(),
    durationMs: topicDurationMs,
    inputItemCount: inputItems.length,
    requestedCount: count,
    outputCount: topicResult.topics.length,
    strategy: topicResult.strategy,
    topics: topicResult.topics,
  };

  const jsonPath = path.join(outDir, `topic-${runId}.json`);
  const mdPath = path.join(outDir, `topic-${runId}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  const md = [
    `# Topic Agent V2 选题报告 - 价值洼地策略`,
    ``,
    `**运行时间**: ${report.runAt}`,
    `**耗时**: ${(report.durationMs / 1000).toFixed(1)}s`,
    `**选用策略**: ${report.strategy}`,
    `**输入条数**: ${report.inputItemCount}`,
    `**输出选题**: ${report.outputCount} 个`,
    ``,
    `## 红海分析`,
    ``,
    `- 蓝海(LOW): ${lowCount} 个`,
    `- 黄海(MEDIUM): ${medCount} 个`,
    `- 红海(HIGH): ${highCount} 个`,
    ``,
    `## 选题列表（按价值洼地排序）`,
    ...topicResult.topics
      .sort((a, b) => b.valueScore - a.valueScore)
      .map((topic, i) =>
        [
          ``,
          `### ${i + 1}. ${topic.title}`,
          ``,
          `**价值洼地**: ${topic.valueScore}/10 | **热度**: ${topic.heatScore}/10`,
          ``,
          `**红海程度**: ${topic.redSeaLevel} | **成为热点**: ${topic.timeToMainstream}`,
          ``,
          `**角度**: ${topic.angle}`,
          ``,
          `**反共识策略**: ${topic.contrarianAngle || "未指定"}`,
          ``,
          `**摘要**: ${topic.summary}`,
          ``,
          `**标签**: ${topic.tags.join(", ")}`,
          ``,
          `**来源**:`,
          ...topic.sources.map((s) => `- [${s.title}](${s.url}) — ${s.source}`),
        ].join("\n"),
      ),
  ].join("\n");

  fs.writeFileSync(mdPath, md, "utf-8");

  // ---- 总结 ----
  console.log(`
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
  Topic Agent V2 选题完成 (价值洼地策略)
  策略: ${strategyBadge(topicResult.strategy)}
  输入: ${inputItems.length} 条趋势
  输出: ${topicResult.topics.length} 个选题
  洼地分布: ${C.green}${lowCount}蓝${C.r} / ${C.yellow}${medCount}黄${C.r} / ${C.red}${highCount}红${C.r}
  耗时: ${topicDuration}s
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}

${C.cyan}JSON 详细报告: ${jsonPath}${C.r}
${C.cyan}Markdown 摘要: ${mdPath}${C.r}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
