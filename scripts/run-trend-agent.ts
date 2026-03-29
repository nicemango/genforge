import { runTrendAgent } from "@/agents/trend";

async function main() {
  console.log("[TrendAgent] 开始抓取趋势内容...\n");

  const result = await runTrendAgent(undefined, (info) => {
    process.stdout.write(
      `\r[${info.current}/${info.total}] ${info.sourceName || "..."} ${info.latestItem ? `→ ${info.latestItem.slice(0, 50)}` : ""}`
    );
  });

  console.log("\n\n========== 抓取结果 ==========\n");
  console.log(`抓取时间: ${result.fetchedAt}`);
  console.log(`统计: 成功 ${result.stats.success} / 失败 ${result.stats.failed} / 超时 ${result.stats.timedOut} / 主题过滤 ${result.stats.topicFiltered}`);
  console.log(`最终有效条目: ${result.items.length}\n`);

  if (result.items.length > 0) {
    console.log("--- 最新 10 条 ---\n");
    result.items.slice(0, 10).forEach((item, i) => {
      console.log(`${i + 1}. [${item.source}]`);
      console.log(`   标题: ${item.title}`);
      console.log(`   链接: ${item.link}`);
      console.log(`   摘要: ${item.snippet?.slice(0, 80)}...`);
      console.log();
    });
  }
}

main().catch((err) => {
  console.error("\n\n[TrendAgent] 运行失败:", err);
  process.exit(1);
});
