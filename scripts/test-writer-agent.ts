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

import {
  runWriterAgent,
  WRITER_PROMPT_VERSION,
  type WriterResult,
} from "@/agents/writer";
import { getAgentModelConfig } from "@/config/llm";
import { prisma } from "@/lib/prisma";
import type { TopicSuggestion } from "@/agents/topic";
import type { ResearchResult } from "@/agents/research";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

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

// CLI 参数解析
const args = process.argv.slice(2);
const topicIdIndex = args.indexOf("--topic-id");
const TOPIC_ID = topicIdIndex !== -1 ? args[topicIdIndex + 1] : null;

// 颜色输出
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
};

function log(
  title: string,
  content?: string,
  color: keyof typeof colors = "reset",
) {
  const c = colors[color] || colors.reset;
  if (content) {
    console.log(`${c}${colors.bright}[${title}]${colors.reset} ${content}`);
  } else {
    console.log(`\n${c}${colors.bright}━━ ${title} ━━${colors.reset}`);
  }
}

function logError(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    `${colors.red}${colors.bright}[${title}] ERROR${colors.reset} ${message}`,
  );
}

// 默认测试数据
const defaultTopic = {
  title: "为什么 AI 公司的估值逻辑正在被颠覆？",
  angle: "从数据垄断到技术平权，AI 创业公司的护城河正在消失",
  summary:
    "本文探讨 AI 公司估值逻辑的深层变化，揭示数据优势不等于技术壁垒的现实",
  heatScore: 8.5,
  tags: ["AI", "创业", "估值"],
  sources: [],
};

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
    "70% 的企业 AI 项目失败，原因是 PMF 错误而非技术问题",
    "开源模型正在快速追赶闭源模型，成本差距缩小 90%",
  ],
  sources: [
    {
      title: "Gartner AI Market Report 2024",
      url: "https://example.com/gartner",
      verified: true,
    },
    {
      title: "a16z AI State Report",
      url: "https://example.com/a16z",
      verified: true,
    },
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
};

function countChineseWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
  const englishWords = (text.match(/[a-zA-Z]+/g)?.length ?? 0) * 2;
  const digitCount = text.match(/\d/g)?.length ?? 0;
  return chineseChars + englishWords + Math.ceil(digitCount * 0.5);
}

function extractSummary(markdown: string): string {
  const withoutTitle = markdown.replace(/^#\s+.+$/m, "").trim();
  const firstParagraph = withoutTitle
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim())[0] ?? "";
  return firstParagraph.replace(/[#*`!\[\]()]/g, "").trim().slice(0, 200);
}

function assertWriterResult(result: WriterResult) {
  assert.equal(result.promptVersion, WRITER_PROMPT_VERSION, "promptVersion 不匹配");
  assert.ok(result.outline, "缺少 outline");
  assert.ok(Array.isArray(result.outline.titles), "outline.titles 必须是数组");
  assert.equal(result.outline.titles.length, 3, "outline.titles 必须恰好 3 个");
  assert.ok(result.outline.hook.trim().length > 0, "outline.hook 不能为空");
  assert.ok(result.outline.sections.length >= 3, "outline.sections 至少 3 个");
  assert.ok(result.outline.sections.length <= 5, "outline.sections 至多 5 个");
  assert.ok(result.outline.ending.trim().length > 0, "outline.ending 不能为空");

  assert.equal(result.draft.length, result.outline.sections.length, "draft 数量必须与 outline.sections 一致");
  assert.equal(result.rewrite.length, result.outline.sections.length, "rewrite 数量必须与 outline.sections 一致");

  result.outline.sections.forEach((section, index) => {
    assert.ok(section.title.trim().length > 0, `outline.sections[${index}].title 不能为空`);
    assert.ok(section.corePoint.trim().length > 0, `outline.sections[${index}].corePoint 不能为空`);
    assert.equal(result.draft[index]?.sectionTitle, section.title, `draft[${index}].sectionTitle 必须与 outline 对齐`);
    assert.equal(result.rewrite[index]?.sectionTitle, section.title, `rewrite[${index}].sectionTitle 必须与 outline 对齐`);
    assert.ok(result.draft[index]?.content.trim().length > 0, `draft[${index}].content 不能为空`);

    const rewriteSection = result.rewrite[index];
    assert.ok(rewriteSection.emotional.trim().length > 0, `rewrite[${index}].emotional 不能为空`);
    assert.ok(rewriteSection.rational.trim().length > 0, `rewrite[${index}].rational 不能为空`);
    assert.ok(rewriteSection.casual.trim().length > 0, `rewrite[${index}].casual 不能为空`);
    assert.ok(
      ["emotional", "rational", "casual"].includes(rewriteSection.selectedStyle),
      `rewrite[${index}].selectedStyle 非法: ${rewriteSection.selectedStyle}`,
    );
  });

  assert.ok(result.final.title.trim().length > 0, "final.title 不能为空");
  assert.ok(result.final.content.trim().length > 0, "final.content 不能为空");
  assert.equal(result.final.title, result.title, "final.title 必须与 title 一致");
  assert.equal(result.final.content, result.body, "final.content 必须与 body 一致");
  assert.ok(result.body.startsWith(`# ${result.title}`), "body 必须以 Markdown H1 标题开头");

  const derivedSummary = extractSummary(result.body);
  const derivedWordCount = countChineseWords(result.body);
  assert.equal(result.summary, derivedSummary, "summary 必须从 body 派生");
  assert.equal(result.wordCount, derivedWordCount, "wordCount 必须从 body 派生");

  assert.ok(result.scores.length >= 1, "scores 至少 1 轮");
  assert.ok(result.scores.length <= 3, "scores 最多 3 轮");

  result.scores.forEach((score, index) => {
    assert.equal(score.attempt, index + 1, `scores[${index}].attempt 必须连续递增`);
    assert.ok(Array.isArray(score.issues), `scores[${index}].issues 必须是数组`);
    assert.ok(Array.isArray(score.optimizations), `scores[${index}].optimizations 必须是数组`);
    assert.equal(typeof score.passed, "boolean", `scores[${index}].passed 必须是 boolean`);

    const metricsEntries = Object.entries(score.metrics);
    assert.equal(metricsEntries.length, 4, `scores[${index}].metrics 维度数量错误`);
    metricsEntries.forEach(([metric, value]) => {
      assert.equal(typeof value, "number", `scores[${index}].metrics.${metric} 必须是数字`);
      assert.ok(value >= 0 && value <= 10, `scores[${index}].metrics.${metric} 必须在 0-10 之间，实际 ${value}`);
    });
  });

  const lastScore = result.scores.at(-1);
  assert.ok(lastScore, "缺少最后一轮评分");
  assert.equal(lastScore.passed, true, "最后一轮评分必须通过");
  assert.ok(lastScore.metrics.engagement >= 8, `engagement 未达标: ${lastScore.metrics.engagement}`);
  assert.ok(lastScore.metrics.realism >= 8, `realism 未达标: ${lastScore.metrics.realism}`);
  assert.ok(lastScore.metrics.emotion >= 8, `emotion 未达标: ${lastScore.metrics.emotion}`);
  assert.ok(lastScore.metrics.value >= 8, `value 未达标: ${lastScore.metrics.value}`);
}

async function main() {
  loadLocalEnv();
  console.log(`
${colors.cyan}${colors.bright}
╔══════════════════════════════════════════════════════════╗
║              Content Center - Writer Agent 测试            ║
╚══════════════════════════════════════════════════════════╝
${colors.reset}`);

  const startTime = Date.now();

  try {
    // 1. 模型配置：从 LLM 配置读取
    let modelConfig;
    try {
      modelConfig = getAgentModelConfig("writer");
      log("配置", `模型: ${modelConfig.model}`, "blue");
    } catch {
      logError(
        "配置",
        "无法获取 writer 的模型配置，请检查 llm-providers.json 或环境变量",
      );
      throw new Error("请检查模型配置");
    }

    // 2. 输入数据：从数据库读取 Topic
    let topic: TopicSuggestion;
    let research: ResearchResult;

    if (TOPIC_ID) {
      // 指定了 Topic ID
      const dbTopic = await prisma.topic.findUnique({
        where: { id: TOPIC_ID },
      });
      if (!dbTopic) {
        throw new Error(`Topic not found: ${TOPIC_ID}`);
      }
      topic = {
        title: dbTopic.title,
        angle: dbTopic.angle,
        summary: dbTopic.summary,
        heatScore: dbTopic.heatScore,
        tags: JSON.parse(dbTopic.tags) as string[],
        sources: [],
      };
      research = defaultResearch; // 使用默认研究数据（真实场景需先运行 ResearchAgent）
      log("输入", `从数据库加载 Topic: ${topic.title}`, "yellow");
    } else {
      // 使用默认测试数据（当没有真实数据时）
      topic = defaultTopic;
      research = defaultResearch;
      log("输入", `使用默认测试数据（无真实 Topic）`, "yellow");
      log("输入", `话题: ${topic.title}`, "yellow");
      log("输入", `字数要求: 2000-2800 字`, "yellow");

      console.log(
        `\n${colors.dim}如需测试真实数据，请先运行 Pipeline 或指定 --topic-id${colors.reset}`,
      );
    }

    if (!TOPIC_ID) {
      console.log(`\n${colors.dim}研究资料预览：${colors.reset}`);
      console.log(research!.summary.slice(0, 300) + "...\n");
    }

    log("执行", "开始生成文章，可能需要 1-3 分钟...", "yellow");

    const result = await runWriterAgent(topic, research!, modelConfig, undefined, undefined, 0);
    assertWriterResult(result);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const lastScore = result.scores.at(-1);

    console.log(
      `\n${colors.green}${colors.bright}╔══════════════════════════════════════════╗${colors.reset}`,
    );
    console.log(
      `${colors.green}${colors.bright}║              生成完成！                      ║${colors.reset}`,
    );
    console.log(
      `${colors.green}${colors.bright}╚══════════════════════════════════════════╝${colors.reset}`,
    );

    log("统计", `耗时: ${duration}s`, "green");
    log("统计", `标题: ${result.title}`, "green");
    log(
      "统计",
      `字数: ${result.wordCount}`,
      result.wordCount >= 2000 && result.wordCount <= 2800 ? "green" : "red",
    );
    log("统计", `摘要: ${result.summary.slice(0, 80)}...`, "green");
    log("校验", `五阶段结构校验通过，评分轮次: ${result.scores.length}`, "green");
    if (lastScore) {
      log(
        "评分",
        `最终评分 engagement=${lastScore.metrics.engagement}, realism=${lastScore.metrics.realism}, emotion=${lastScore.metrics.emotion}, value=${lastScore.metrics.value}`,
        "green",
      );
    }

    console.log(`\n${colors.dim}━━ Outline 预览 ━━${colors.reset}`);
    console.log(JSON.stringify(result.outline, null, 2));

    console.log(`\n${colors.dim}━━ Final 正文预览 ━━${colors.reset}`);
    console.log(result.body.slice(0, 1500));
    console.log("\n...（正文过长已截断）\n");

    await prisma.$disconnect();
    return result;
  } catch (error) {
    logError("Writer Agent", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
