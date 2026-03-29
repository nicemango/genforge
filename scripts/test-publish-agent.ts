/**
 * PublishAgent 测试 - 使用 WriterAgent 的真实输出
 *
 * 用法: npx tsx scripts/test-publish-agent.ts
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

import { prisma } from "@/lib/prisma";
import { runPublishAgent } from "@/agents/publisher";

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
const summary = writerData.result.summary;

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
║         PublishAgent 测试 - 基于真实 WriterAgent 输出        ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`);

  log("来源", path.basename(writerFile), "blue");

  // Get account
  const account = await prisma.account.findFirst();
  if (!account) {
    console.error(`${C.red}No account found in database${C.r}`);
    process.exit(1);
  }
  log("账号", `${account.id} - ${account.name}`, "blue");

  const wechatConfig = JSON.parse(account.wechatConfig || "{}");
  log("WeChat AppID", wechatConfig.appId || "NOT SET", wechatConfig.appId ? "green" : "red");

  console.log(`\n${C.cyan}待发布内容：${C.r}`);
  console.log(`  ${C.br}标题：${C.r} ${title}`);
  console.log(`  ${C.br}字数：${C.r} ${writerData.result.wordCount}`);
  console.log(`  ${C.br}摘要：${C.r} ${summary}`);

  log("执行", "开始发布到微信草稿（约 1-2 分钟）...", "yellow");

  const startTime = Date.now();

  const result = await runPublishAgent(account.id, title, body, summary, {
    author: wechatConfig.author || "AI自动生成",
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
  PublishAgent 发布完成
  耗时: ${duration}s
${C.green}${C.br}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
`);

  console.log(`${C.cyan}发布结果：${C.r}`);
  console.log(`  ${C.br}Media ID：${C.r} ${C.yellow}${result.mediaId}${C.r}`);
  console.log(`  ${C.br}发布时间：${C.r} ${result.publishedAt}`);
  console.log(`  ${C.br}HTML长度：${C.r} ${result.convertedHtml.length} 字符`);

  // Save to file
  const outFile = path.join(outDir, `publish-output-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    runAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    source: path.basename(writerFile),
    title,
    summary,
    result,
  }, null, 2), "utf-8");
  console.log(`\n${C.cyan}完整输出已保存: ${outFile}${C.r}`);
  console.log(`\n${C.green}请前往微信公众平台 https://mp.weixin.qq.com 查看草稿${C.r}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(`${C.red}Error:${C.r}`, err.message);
    prisma.$disconnect();
    process.exit(1);
  });
