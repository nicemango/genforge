/**
 * ReviewAgent 测试 - 使用 WriterAgent 的真实输出
 *
 * 用法: npx tsx scripts/test-review-from-writer.ts
 */

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

loadLocalEnv();

import { runReviewAgent } from "@/agents/review";
import { getAgentModelConfig } from "@/config/llm";

// Load latest writer output
const outDir = path.resolve("./test-output");
const files = fs.readdirSync(outDir)
  .filter(f => f.startsWith("writer-output-") && f.endsWith(".json"))
  .sort((a, b) => fs.statSync(path.join(outDir, b)).mtime - fs.statSync(path.join(outDir, a)).mtime);

if (files.length === 0) {
  console.error("No writer output files found in test-output/");
  process.exit(1);
}

const writerFile = path.join(outDir, files[0]);
const writerData = JSON.parse(fs.readFileSync(writerFile, "utf-8"));

const title = writerData.result.title;
const body = writerData.result.body;

const C = {
  r: "\x1b[0m", br: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m",
};

function log(title: string, content?: string, color: keyof typeof C = "r") {
  const c = C[color];
  if (content !== undefined) {
    console.log(`${c}${C.br}[${title}]${C.r} ${content}`);
  } else {
    console.log(`\n${c}${C.br}━━ ${title} ━━${C.r}`);
  }
}

async function main() {
  console.log(`
${C.cyan}${C.br}
╔══════════════════════════════════════════════════════════════╗
║         ReviewAgent 测试 - 基于真实 WriterAgent 输出          ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`);

  const modelConfig = getAgentModelConfig("review");
  log("模型", `${modelConfig.model} (${modelConfig.provider})`, "blue");
  log("来源", path.basename(writerFile), "blue");

  console.log(`\n${C.cyan}待审核内容：${C.r}`);
  console.log(`  ${C.br}标题：${C.r} ${title}`);
  console.log(`  ${C.br}字数：${C.r} ${writerData.result.wordCount}`);
  console.log(`  ${C.br}正文长度：${C.r} ${body.length} 字符`);

  log("执行", "开始审核评分（约 1-2 分钟）...", "yellow");

  const startTime = Date.now();

  const result = await runReviewAgent(title, body, modelConfig, true);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
  ReviewAgent 审核完成
  耗时: ${duration}s
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
`);

  console.log(`${C.cyan}评分结果：${C.r}`);
  console.log(`  ${C.br}总得分：${C.r} ${C.yellow}${result.score}${C.r} / 10`);
  console.log(`  ${C.br}perspective（观点深度）：${C.r} ${C.yellow}${result.dimensionScores.perspective}${C.r}`);
  console.log(`  ${C.br}structure（文章结构）：${C.r} ${C.yellow}${result.dimensionScores.structure}${C.r}`);
  console.log(`  ${C.br}fluency（流畅度）：${C.r} ${C.yellow}${result.dimensionScores.fluency}${C.r}`);
  console.log(`  ${C.br}dataSupport（数据支撑）：${C.r} ${C.yellow}${result.dimensionScores.dataSupport}${C.r}`);
  console.log(`  ${C.br}通过质量门控：${C.r} ${result.passed ? C.green + "是" : C.red + "否"}${C.r}`);

  if (result.issues && result.issues.length > 0) {
    console.log(`\n${C.cyan}问题列表（${result.issues.length} 个）：${C.r}`);
    result.issues.forEach((issue: string, i: number) => {
      console.log(`  ${i + 1}. ${C.red}${issue}${C.r}`);
    });
  }

  if (result.suggestions && result.suggestions.length > 0) {
    console.log(`\n${C.cyan}优化建议（${result.suggestions.length} 条）：${C.r}`);
    result.suggestions.forEach((suggestion: string, i: number) => {
      console.log(`  ${i + 1}. ${C.green}${suggestion}${C.r}`);
    });
  }

  if (result.fixedBody) {
    console.log(`\n${C.cyan}修复后正文预览（前 500 字）：${C.r}`);
    console.log(result.fixedBody.slice(0, 500));
    console.log(`\n${C.dim}...（已截断）${C.r}`);
  }

  // Save to file
  const outFile = path.join(outDir, `review-output-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    runAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    source: path.basename(writerFile),
    title,
    result,
  }, null, 2), "utf-8");
  console.log(`\n${C.cyan}完整输出已保存: ${outFile}${C.r}`);
}

main().catch((err) => {
  console.error(`${C.red}Error:${C.r}`, err.message);
  process.exit(1);
});
