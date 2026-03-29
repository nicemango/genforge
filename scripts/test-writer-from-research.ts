/**
 * WriterAgent 测试 - 使用 ResearchAgent 的真实输出
 *
 * 用法: npx tsx scripts/test-writer-from-research.ts
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

import { runWriterAgent } from "@/agents/writer";
import { getAgentModelConfig } from "@/config/llm";

// Load latest research JSON
const outDir = path.resolve("./test-output");
const files = fs.readdirSync(outDir)
  .filter(f => f.startsWith("research-") && f.endsWith(".json"))
  .sort((a, b) => fs.statSync(path.join(outDir, b)).mtime - fs.statSync(path.join(outDir, a)).mtime);

if (files.length === 0) {
  console.error("No research JSON files found in test-output/");
  process.exit(1);
}

const researchFile = path.join(outDir, files[0]);
const researchData = JSON.parse(fs.readFileSync(researchFile, "utf-8"));

const topic = researchData.topic;
const research = {
  summary: researchData.research.summary || "",
  keyPoints: researchData.research.keyPoints || [],
  sources: researchData.research.sources || [],
  rawOutput: researchData.research.rawOutput || "",
};

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
║         WriterAgent 测试 - 基于真实 ResearchAgent 输出       ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`);

  const modelConfig = getAgentModelConfig("writer");
  log("模型", `${modelConfig.model} (${modelConfig.provider})`, "blue");
  log("来源", path.basename(researchFile), "blue");

  console.log(`\n${C.cyan}选题：${C.r}`);
  console.log(`  ${C.br}标题：${C.r} ${topic.title}`);
  console.log(`  ${C.br}角度：${C.r} ${topic.angle}`);
  console.log(`  ${C.br}标签：${C.r} ${(topic.tags || []).join(", ")}`);
  console.log(`  ${C.br}热度：${C.r} ${topic.heatScore}/10`);
  console.log(`  ${C.br}来源：${C.r} ${(topic.sources || []).length} 个`);

  console.log(`\n${C.cyan}研究资料：${C.r}`);
  console.log(`  ${C.br}摘要：${C.r} ${(research.summary || "").slice(0, 150)}...`);
  console.log(`  ${C.br}要点：${C.r} ${research.keyPoints.length} 条`);
  console.log(`  ${C.br}来源：${C.r} ${research.sources.length} 个（含 ${research.sources.filter((s: any) => s.verified).length} 个已验证）`);

  log("执行", "开始生成文章（约 2-5 分钟）...", "yellow");

  const startTime = Date.now();

  const result = await runWriterAgent(topic, research, modelConfig, undefined, undefined, 0);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const lastScore = result.scores.at(-1);

  console.log(`
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
  文章生成完成
  耗时: ${duration}s
  标题: ${result.title}
  字数: ${result.wordCount}
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
`);

  if (lastScore) {
    console.log(`${C.cyan}最终评分（0-10）：${C.r}`);
    console.log(`  engagement: ${C.yellow}${lastScore.metrics.engagement}${C.r}`);
    console.log(`  realism:    ${C.yellow}${lastScore.metrics.realism}${C.r}`);
    console.log(`  emotion:    ${C.yellow}${lastScore.metrics.emotion}${C.r}`);
    console.log(`  value:     ${C.yellow}${lastScore.metrics.value}${C.r}`);
    console.log(`  通过:       ${lastScore.passed ? C.green + "是" : C.red + "否"}${C.r}`);
  }

  console.log(`\n${C.cyan}━━ Outline ━━${C.r}`);
  console.log(`${C.br}Hook:${C.r} ${result.outline.hook.slice(0, 100)}...`);
  result.outline.sections.forEach((s: any, i: number) => {
    console.log(`  ${i + 1}. ${C.br}${s.title}${C.r}`);
    console.log(`     ${C.dim}${s.corePoint.slice(0, 80)}...${C.r}`);
  });
  console.log(`${C.br}Ending:${C.r} ${result.outline.ending.slice(0, 100)}...`);

  console.log(`\n${C.cyan}━━ 正文预览（前 800 字）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}`);
  console.log(result.body.slice(0, 800));
  console.log(`\n${C.dim}...（正文 ${result.body.length} 字符，已截断）${C.r}`);

  // Save to file
  const outFile = path.join(outDir, `writer-output-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    runAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    topic,
    research: { summary: research.summary, keyPoints: research.keyPoints, sources: research.sources },
    result,
  }, null, 2), "utf-8");
  console.log(`\n${C.cyan}完整输出已保存: ${outFile}${C.r}`);
}

main().catch((err) => {
  console.error(`${C.red}Error:${C.r}`, err.message);
  process.exit(1);
});
