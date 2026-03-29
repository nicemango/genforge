import * as path from "path";
import * as fs from "fs";
import { runReviewAgent } from "@/agents/review";
import { getAgentModelConfig } from "@/config/llm";

function loadLocalEnv() {
  const files = [".env.local", ".env"];
  for (const file of files) {
    const p = path.resolve(process.cwd(), file);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadLocalEnv();

const sampleArticle = {
  title: "500块的GPU写代码能打赢Claude Sonnet？开源项目ATLAS正在改写AI推理经济学",
  body: `在所有人都在讨论分布式GPU集群的时候，有人用90年代的IRC协议把AI Agent跑在了月费7美元的小鸡服务器上。

这个项目叫ATLAS，全称是"Adaptive Token-lookup System"。开发者是一个名叫Alex的独立程序员，他在Hacker News上分享了自己的项目，标题是"我用500块的二手显卡，超过了Claude Sonnet的编程能力"。

## 这不是标题党

你可能觉得这是吹牛，但ATLAS确实在HumanEval基准上拿下了87.3%的通过率，而Claude Sonnet的成绩是86.4%。差距不大，但在编程这个任务上，差0.9%就是能跑和不能跑的区别。

关键在于ATLAS的优化策略。它没有使用最新的Transformer架构，而是基于Llama 2 7B进行微调。具体的改进包括：

1. **token压缩**：将常用的编程模式压缩成更短的token，减少推理时的计算量
2. **检索增强**：在本地维护一个代码片段向量数据库，每次推理前先检索相关示例
3. **批处理优化**：把多个小任务合并成一个批次，用一张RTX 3060跑

成本核算：
- 硬件成本：500美元（二手RTX 3060 12GB）
- 电费：每月约7美元的VPS费用
- 训练成本：使用开源数据集，总计约200 GPU小时

对比Claude Sonnet：
- API费用：每1000 token约0.003美元
- 实际使用成本：每月约50-100美元
- 延迟：本地推理约200ms，API调用约500ms

## 为什么要用IRC协议？

Alex选择了IRC（Internet Relay Chat）作为Agent的通信协议。这个决定看似复古，实际上非常聪明：

IRC是无状态的协议，每次交互都是独立的请求-响应。这意味着：
- 可以在任何有网络的地方连接
- 不需要维护长连接
- 可以轻松扩展到多个并行的Agent实例

而且，IRC的协议规范极其简单，整个实现只有不到500行Python代码。

## 社区反应

这个项目在Hacker News上引发了激烈讨论。有意思的是，评论区分成了两派：

支持者认为这是"本地AI"的胜利，代表着AI从"云端"向"边缘"迁移的趋势。他们认为随着模型压缩技术的进步，未来会有更多任务可以在消费级硬件上完成。

质疑者则认为这只是特定benchmark上的胜利，真实场景下的表现可能完全不同。有人说："ATLAS在HumanEval上表现好，是因为这个测试集本身就是用英文编程语言写的。换成中文注释或者日文变量名的代码，效果可能大打折扣。"

## 我的观点

这场争论本身就很能说明问题。

当Claude和GPT-4统治云端AI的时候，ATLAS这样的项目让我们看到了另一种可能性。不追求最大最强，而是追求够用和便宜。这可能是AI落地的一条现实路径。

当然，Alex也承认自己的方案有局限性。如果你要做一个客服机器人，ATLAS可能不是最佳选择。但如果你是一个独立开发者，需要一个随时可用的编程助手，这个方案确实值得考虑。

下一步，Alex计划开源他的训练脚本和数据预处理流程。如果你对本地AI开发感兴趣，可以关注他的GitHub主页。

---

感谢阅读，希望对你有帮助。`
};

async function main() {
  console.log("Testing Review Agent with Team-based parallel evaluation...\n");

  const modelConfig = getAgentModelConfig("review");

  console.log(`Model: ${modelConfig.defaultModel}`);
  console.log(`Article length: ${sampleArticle.body.length} chars\n`);

  const startTime = Date.now();
  const result = await runReviewAgent(
    sampleArticle.title,
    sampleArticle.body,
    modelConfig,
    true
  );
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n=== Review Result ===");
  console.log(`Duration: ${duration}s`);
  console.log(`Score: ${result.score.toFixed(1)}/10`);
  console.log(`Passed: ${result.passed}`);
  console.log("\nDimension Scores:");
  console.log(`  Perspective (观点深度): ${result.dimensionScores.perspective}`);
  console.log(`  Structure (文章结构): ${result.dimensionScores.structure}`);
  console.log(`  Data Support (数据支撑): ${result.dimensionScores.dataSupport}`);
  console.log(`  Fluency (流畅度): ${result.dimensionScores.fluency}`);

  if (result.reasoning.length > 0) {
    console.log("\nReasoning:");
    result.reasoning.forEach((r, i) => console.log(`  ${i + 1}. ${r.slice(0, 200)}`));
  }

  if (result.issues.length > 0) {
    console.log(`\nIssues (${result.issues.length}):`);
    result.issues.forEach((issue, i) => console.log(`  ${i + 1}. ${issue.slice(0, 150)}`));
  }

  if (result.suggestions.length > 0) {
    console.log(`\nSuggestions (${result.suggestions.length}):`);
    result.suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s.slice(0, 150)}`));
  }

  if (result.fixedBody) {
    console.log(`\nFixed Body: ${result.fixedBody.length} chars`);
  }

  if (result.writerBrief) {
    console.log("\nWriter Brief:");
    console.log(`  Core Problem: ${result.writerBrief.coreProblem}`);
    console.log(`  Must Fix (${result.writerBrief.mustFix.length}):`);
    result.writerBrief.mustFix.forEach((m) => {
      console.log(`    [${m.priority}] ${m.location}: ${m.problem}`);
      console.log(`      Fix: ${m.fix.slice(0, 100)}...`);
    });
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
