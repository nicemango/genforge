/**
 * 完整 Pipeline 测试脚本
 * 用法: npx tsx scripts/run-full-pipeline.ts
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

// Enable new writer team architecture
process.env.WRITER_TEAM_ENABLED = 'true';

const C = {
  r: "\x1b[0m", br: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m",
};

async function main() {
  console.log(`
${C.cyan}${C.br}
╔══════════════════════════════════════════════════════════════╗
║            完整 Pipeline 测试 (Trend→Topic→Research→     ║
║            Write→Review→Publish)                          ║
╚══════════════════════════════════════════════════════════════╝${C.r}
`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Get account
    const account = await prisma.account.findFirst({ where: { isActive: true } });
    if (!account) {
      console.error(`${C.red}No active account found${C.r}`);
      process.exit(1);
    }
    console.log(`${C.blue}[账号]${C.r} ${account.name} (${account.id})`);

    // Import pipeline
    const { runFullPipeline } = await import("@/pipeline");

    console.log(`\n${C.yellow}[执行]${C.r} 开始完整流程...\n`);

    const startTime = Date.now();

    const result = await runFullPipeline({
      accountId: account.id,
      topicCount: 1,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (result.status === "failed") {
      console.error(`\n${C.red}${C.br} Pipeline 失败${C.r}`);
      console.error(`  Error: ${result.error}`);
      process.exit(1);
    }

    console.log(`
${C.green}${C.br}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Pipeline 完成
 耗时: ${duration}s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}
`);

    const output = result.output as Record<string, unknown>;
    if (output.topicId) console.log(`${C.blue}[Topic]${C.r} ${output.topicId}`);
    if (output.contentId) console.log(`${C.blue}[Content]${C.r} ${output.contentId}`);
    if (output.mediaId) console.log(`${C.blue}[Media ID]${C.r} ${output.mediaId}`);
    if (output.score !== undefined) console.log(`${C.blue}[评分]${C.r} ${output.score}/10`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${C.red}Error:${C.r}`, err.message);
  process.exit(1);
});
