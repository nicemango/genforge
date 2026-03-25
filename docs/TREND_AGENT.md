# TrendAgent 详细设计文档

## 0. 多话题支持

TrendAgent 支持切换话题，每个话题有独立的 RSS 源子集和关键词配置。

### 0.1 预设话题

| ID | 名称 | RSS 源 | 描述 |
|----|------|--------|------|
| `ai` | AI & 开发者 | 26 个（cn_tech + intl_dev + research + intl_tech + ai_project） | AI 模型、工具、项目更新、开发者社区热议 |
| `society` | 社会 | 5 个（cn_tech） | 社会热点、民生、舆情、公共事件 |
| `tech` | 科技 | 8 个（cn_tech + intl_tech） | 科技行业动态、产品发布、商业博弈 |

### 0.2 配置文件

`config/trend-agent.json`（所有参数可选）：

```json
{
  "topic": "ai",
  "maxArticlesPerSource": 20,
  "freshDays": 7,
  "outputDir": "output/trend-agent"
}
```

### 0.3 CLI 参数

```bash
npx tsx scripts/test-trend-detailed.ts                         # 使用配置文件
npx tsx scripts/test-trend-detailed.ts --topic society          # 切换话题
npx tsx scripts/test-trend-detailed.ts --topic ai --fresh-days 3  # 多参数
npx tsx scripts/test-trend-detailed.ts list                     # 列出所有话题
```

**配置优先级（从高到低）：** CLI > ENV > config file > 默认值

**CLI 参数：**
| 参数 | 短写 | 说明 |
|------|------|------|
| `--topic` | `-t` | 话题 ID（ai / society / tech） |
| `--fresh-days` | `-d` | 保留近 N 天文章 |
| `--max` | `-m` | 每源最多文章数 |
| `--output` | `-o` | 输出目录 |
| `list` | - | 列出所有话题 |

**环境变量：** `TREND_TOPIC` / `TREND_FRESH_DAYS` / `TREND_MAX` / `TREND_OUTPUT`

### 0.4 自定义话题

在 `src/lib/rss-sources.ts` 的 `TOPICS` 数组中添加新配置即可，无需修改代码。

## 1. 概述

TrendAgent 是 Content Center 多 Agent 流水线的第一步，负责从多个 RSS 源抓取趋势文章，经过滤、去重后输出给 TopicAgent 进行选题筛选。

**数据流：**
```
RSS Sources → TrendAgent → [TrendItem[]] → TopicAgent → ...
```

## 2. 接口定义

### 2.1 Types

```typescript
// src/agents/trend.ts

interface TrendItem {
  title: string       // 文章标题
  link: string        // 文章链接
  pubDate: string     // 发布时间（原始字符串）
  snippet: string     // 摘要（前 300 字符，HTML 已去除）
  source: string      // 来源名称（如 "36kr"、"Hacker News"）
}

interface TrendStats {
  total: number        // RSS 源总数
  success: number      // 成功抓取的源数量
  failed: number       // 失败源数量（含全部重试后仍失败的）
  timedOut: number     // 因超时失败的源数量
  topicFiltered: number // 关键词过滤丢弃的文章数
}

interface TrendResult {
  items: TrendItem[]   // 过滤后的趋势文章列表
  fetchedAt: string   // ISO 时间戳
  stats: TrendStats    // 统计信息
}
```

### 2.2 主入口

```typescript
// 默认配置：每源最多取 20 条，超时 10s，最多重试 3 次
async function runTrendAgent(): Promise<TrendResult>
```

## 3. 架构设计

### 3.1 执行流程

```
┌─────────────────────────────────────────────┐
│  1. 并发抓取所有 RSS 源                      │
│     Promise.allSettled(RSS_SOURCES)         │
│     每源独立 fetchWithRetry()                │
│     超时 10s，重试 3 次                     │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  2. URL 去重                                 │
│     deduplicateByUrl(items)                  │
│     按 link 小写去重                          │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  3. 7 天时效过滤                             │
│     filterRecentItems(items)                │
│     丢弃 pubDate < 7 天前的文章               │
│     无日期的文章保留                           │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  4. 主题关键词过滤                            │
│     filterByTopic(items)                    │
│     BLOCKED → 直接丢弃（优先）                │
│     ALLOWED → 必须含至少一个                  │
└──────────────┬──────────────────────────────┘
               │
               ▼
          TrendResult
```

### 3.2 话题参数

```typescript
async function runTrendAgent(topicId: string = 'ai'): Promise<TrendResult>
```

- `topicId` 不传默认为 `"ai"`
- 根据 `topicId` 从 `TOPICS` 获取话题配置
- `getSourcesForTopic()` 过滤出该话题使用的 RSS 源子集
- `getTopicFilter()` 组合 Universal BLOCKED + 话题自定义关键词

### 3.3 重试机制（fetchWithRetry）

- 单源超时或失败时，最多重试 3 次
- 每次重试间隔无等待（立即重试）
- 超时判断：原生 `AbortController`，超时时间 10s
- 任意一次成功即返回，结果合并到统一 items 列表

### 3.4 代理支持

由 `https-proxy-agent@7` 提供，通过环境变量注入：

```
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
```

实现位置 `src/tools/fetch-rss.ts`：
- `getProxyAgent()` 读取 env 并 memoize，避免每次请求重复创建 Agent 实例
- 支持 `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` 四种 env 变体
- fetch 调用时通过 `agent` 选项注入

### 3.5 RSS 解析

支持两种 XML 格式，由 `fast-xml-parser` 解析：

| 格式 | 检测方式 | 字段映射 |
|------|---------|---------|
| RSS 2.0 | `data['rss']` 或 `data['RSS']` | `item.title/link/pubDate/description` |
| Atom | `data['feed']` 或 `data['Feed']` | `entry.title/link/published/summary` |

- link 字段兼容多种格式：简单字符串、`{href, rel}` 对象数组、单一对象
- snippet 最多取前 300 字符
- HTML 标签和 HTML 实体已转义为纯文本

## 4. RSS 源配置

### 4.1 源列表（src/lib/rss-sources.ts）

**直连源（16个）：**
| 名称 | URL | 分类 |
|------|-----|------|
| 36kr | https://36kr.com/feed | cn_tech |
| 少数派 | https://sspai.com/feed | cn_tech |
| 爱范儿 | https://www.ifanr.com/feed | cn_tech |
| 钛媒体 | https://www.tmtpost.com/rss | cn_tech |
| 雷峰网 | https://www.leiphone.com/feed | cn_tech |
| Hacker News | https://hnrss.org/frontpage | intl_dev |
| Hacker News Best | https://hnrss.org/best | intl_dev |
| Lobsters | https://lobste.rs/rss | intl_dev |
| arXiv AI | https://rss.arxiv.org/rss/cs.AI | research |
| arXiv ML | https://rss.arxiv.org/rss/cs.LG | research |
| arXiv NLP | https://rss.arxiv.org/rss/cs.CL | research |
| TechCrunch | https://techcrunch.com/feed/ | intl_tech |
| The Verge | https://www.theverge.com/rss/index.xml | intl_tech |
| Wired | https://www.wired.com/feed/rss | intl_tech |
| Smashing Magazine | https://www.smashingmagazine.com/feed/ | intl_dev |

**代理源（11个）：**
| 名称 | URL | 分类 |
|------|-----|------|
| HuggingFace Blog | https://huggingface.co/blog/feed.xml | ai_project |
| OpenAI Blog | https://openai.com/blog/rss.xml | ai_project |
| DeepMind Blog | https://deepmind.google/blog/rss.xml | ai_project |
| Google AI Blog | https://blog.google/technology/ai/rss/ | ai_project |
| Mistral Blog | https://mistral.ai/blog/rss.xml | ai_project |
| Cohere Blog | https://cohere.com/blog/rss.xml | ai_project |
| AI21 Blog | https://www.ai21.com/blog/rss.xml | ai_project |
| LangChain Blog | https://blog.langchain.dev/feed/ | ai_project |
| LlamaIndex Blog | https://docs.llamaindex.ai/blog/rss.xml | ai_project |
| Ollama Blog | https://ollama.com/blog/rss.xml | ai_project |
| vLLM Blog | https://vllm.ai/blog/rss.xml | ai_project |

### 4.2 已知失效源（已移除）

| 源 | 原因 |
|----|------|
| Anthropic News | 无 RSS，路径 404 |
| Perplexity Blog | Cloudflare 保护 |
| CrewAI Blog | 无 RSS，路径 404 |
| GitHub Trending | Atom feed 返回 406 |
| React Blog | 无 RSS |
| Vue Blog | 无 RSS |
| Dev.to | XML 含大量实体引用，fast-xml-parser 解析超限 |

## 5. 关键词过滤

### 5.1 架构

关键词分两层：
- **Universal BLOCKED**（`UNIVERSAL_BLOCKED`）：所有话题共享（情感/娱乐噪声）
- **话题自定义**：每个话题独立的 ALLOWED + BLOCKED

最终过滤：`BLOCKED = Universal + topic.blockedKeywords`，`ALLOWED = topic.allowedKeywords`

### 5.2 各话题 ALLOWED 关键词

**AI 话题 ALLOWED_KEYWORDS：**
```typescript
// AI 工具 / 开源项目
'Cursor', 'Copilot', 'v0', 'Claude Code', 'Windsurf', 'Roo Code', 'Goose',
'LangChain', 'LlamaIndex', 'CrewAI', 'AutoGen', 'Dify', 'FastAPI',
'vLLM', 'Ollama', 'llama.cpp', 'Qwen', 'Kimi', '豆包', '通义', 'Moonshot',
'HuggingFace', 'Transformers', 'PEFT', 'LangGraph',
'Anthropic', 'OpenAI', 'DeepSeek', 'Mistral', 'Grok', 'Perplexity',
'Gemini', 'Claude', 'ChatGPT', 'GPT-', 'llama', 'Llama',

// AI 模型发布 / API 变化
'模型发布', 'API 更新', '降价', '涨价', '开源',
'model release', 'new model', 'API change',
'fine-tuning', 'fine tune', 'RLHF', 'SFT',

// 开发工具 / 平台
'GitHub', 'npm', 'pip install', 'PyPI', 'release', 'v1.',
'Star 破万', 'Trending', '开源项目', 'Open Source',
'VS Code', 'Neovim', 'JetBrains', 'Replit', 'Vercel', 'Cloudflare',

// AI 核心技术
'LLM', 'AGI', '机器学习', '深度学习', '神经网络', 'Transformer',
'RAG', '向量数据库', 'Embedding', '知识库', '检索增强',
'具身智能', 'Agent', '智能体', 'AI Agent', 'ReAct', 'Tool',
'多模态', '视觉模型', '语音识别', 'TTS', 'ASR',

// 开发者社区热议
'Hacker News', 'HN', 'Lobsters', 'Reddit', '讨论',
'vibe coding', 'Vibe Coding',

// AI 行业动态
'AI芯片', 'GPU', 'NPU', 'TPU', '算力', '英伟达', '昇腾',
'智算中心', '万卡集群',
```

**BLOCKED_KEYWORDS（直接丢弃）：**
```typescript
// 泛商业/财经噪声
'上市', 'IPO', '市值', '股价', '财报', '融资', '投资', '并购', '战略投资',
'独角兽', '估值', '商业化', '营收', '亏损',
'公募基金', '私募', '理财', '借贷',

// 情感/娱乐噪声
'情感', '分手', '复合', '恋爱', '脱单', '相亲',
'追星', '偶像', '粉丝', '演唱会', '明星八卦',
'彩票', '中奖', '双色', '大乐透', '开奖',
'星座', '运势', '塔罗', '占卜',
'征婚', '交友', '婚介',

// 传统行业
'房地产', '房价', '股市', '基金', '期货',
```

### 5.3 过滤优先级

1. **BLOCKED** > **ALLOWED**（BLOCKED 命中直接丢弃，不检查 ALLOWED）
2. ALLOWED 非空时必须命中至少一个
3. ALLOWED 为空时不做限制（只应用 BLOCKED）

### 5.4 关键词调整注意事项

- `'免费'` 过于宽泛（如"免费打印"），已被移除
- 大小写不敏感（统一转小写比较）
- 匹配范围：标题 + snippet 拼接后的文本

## 6. 测试方式

### 6.1 本地测试

```bash
# 使用 config/trend-agent.json 中的配置
npx tsx scripts/test-trend-detailed.ts

# CLI 参数覆盖配置文件
npx tsx scripts/test-trend-detailed.ts --topic society --fresh-days 3

# 列出所有话题
npx tsx scripts/test-trend-detailed.ts list

# 轻量验证（同样读取配置文件）
npx tsx scripts/test-agent.ts

# 全链路测试
npx tsx scripts/test-all-agents.ts
```

### 6.2 前置条件

- Clash Verge HTTP 代理已启动（端口 7897）
- `.env` 已配置 `HTTP_PROXY=http://127.0.0.1:7897`

### 6.3 输出文件

每次运行生成（文件名含话题 ID）：
- `output/trend-agent/trend-{topic}-{timestamp}.json` — 完整原始数据
- `output/trend-agent/trend-{topic}-{timestamp}.md` — Markdown 摘要

## 7. 已知问题与限制

| 问题 | 原因 | 现状 |
|------|------|------|
| HuggingFace/Mistral/LlamaIndex 间歇超时 | 代理高并发不稳定 | 间歇性，约 20% 失败率 |
| 关键词 `'免费'` 会漏进非 AI 文章 | 关键词过于宽泛 | 已移除 |
| Dev.to RSS 含大量 XML 实体引用导致解析超限 | fast-xml-parser entity expansion limit | 已改用 JSON API（需后续实现） |
| 36kr 抓取内容偏"大路货"（融资、宏观） | 关键词过滤仍不够精准 | 需持续优化关键词 |

## 8. 文章驱动研究模式（runArticleResearchAgent）

### 8.1 使用场景

当你看到一篇感兴趣的文章，想围绕它的主题抓取相关内容作为后续内容生产的素材时使用。

**与 `runTrendAgent` 的区别：**

| | `runTrendAgent` | `runArticleResearchAgent` |
|---|---|---|
| 触发方式 | 预设话题（ai / society / tech） | 用户提供的文章 |
| 关键词来源 | 静态配置（`rss-sources.ts`） | LLM 从文章动态提取 |
| RSS 源范围 | 话题对应的分类子集 | 默认全量（可覆盖） |
| AI 依赖 | 无 | 需要 ModelConfig |
| 返回内容 | `TrendResult` | `ArticleResearchResult`（含文章分析） |

### 8.2 接口定义

```typescript
// src/agents/trend.ts

interface ArticleResearchConfig {
  article: {
    url?: string   // 文章 URL（与 text 二选一）
    text?: string  // 直接传入文章正文（与 url 二选一）
  }
  modelConfig: ModelConfig         // AI 模型配置（必填）
  sources?: RssSource[]            // 要搜索的 RSS 源（默认全量）
  freshDays?: number               // 只保留近 N 天的文章（默认 7）
  maxArticlesPerSource?: number    // 每源最多抓取文章数（默认 20）
}

interface ArticleAnalysis {
  summary: string          // 文章核心内容摘要（2-3 句）
  keywords: string[]       // 提取的关键词（8-15 个，用于 RSS 过滤）
  entities: string[]       // 核心实体（公司、产品、人名、技术等）
  contentAngle: string     // 文章的叙述角度或核心观点
  suggestedTopics: string[] // 建议围绕哪些子话题继续研究（3-5 个）
}

interface ArticleResearchResult {
  articleAnalysis: ArticleAnalysis  // LLM 对原文的结构化分析
  relatedItems: TrendItem[]         // 从 RSS 抓取的相关文章
  fetchedAt: string                 // ISO 时间戳
  stats: TrendStats                 // 抓取统计（同 TrendResult.stats）
}
```

### 8.3 基本用法

**传入 URL：**

```typescript
import { runArticleResearchAgent } from "@/agents/trend"
import { getDefaultModelConfig } from "@/lib/config"

const result = await runArticleResearchAgent({
  article: { url: "https://example.com/some-article" },
  modelConfig: getDefaultModelConfig(),
})

// 查看文章分析
console.log(result.articleAnalysis.summary)
// => "这篇文章介绍了 DeepSeek-V3 的架构设计..."

console.log(result.articleAnalysis.keywords)
// => ["DeepSeek", "MoE", "混合专家", "推理成本", ...]

console.log(result.articleAnalysis.suggestedTopics)
// => ["MoE 架构对比", "国产大模型竞争格局", "推理效率优化"]

// 查看相关 RSS 文章
console.log(`找到 ${result.relatedItems.length} 篇相关文章`)
for (const item of result.relatedItems.slice(0, 5)) {
  console.log(`[${item.source}] ${item.title}`)
}
```

**直接传入文章文本（用户粘贴内容）：**

```typescript
const articleText = `
  DeepSeek-V3 发布，采用 MoE 架构，671B 参数，
  推理成本仅为 GPT-4 的十分之一...
`

const result = await runArticleResearchAgent({
  article: { text: articleText },
  modelConfig: getDefaultModelConfig(),
})
```

**指定特定 RSS 源范围（仅搜 AI 相关源）：**

```typescript
import { RSS_SOURCES } from "@/lib/rss-sources"

const aiSources = RSS_SOURCES.filter(
  (s) => ["ai_project", "intl_dev", "research"].includes(s.category)
)

const result = await runArticleResearchAgent({
  article: { url: "https://example.com/some-article" },
  modelConfig: getDefaultModelConfig(),
  sources: aiSources,
  freshDays: 3,               // 只看最近 3 天
  maxArticlesPerSource: 10,   // 每源最多 10 条
})
```

**使用账号自定义模型配置：**

```typescript
import { loadModelConfig } from "@/lib/config"
import { prisma } from "@/lib/db"

const account = await prisma.account.findUniqueOrThrow({ where: { id } })
const modelConfig = loadModelConfig(account.modelConfig)

const result = await runArticleResearchAgent({
  article: { url: "https://example.com/some-article" },
  modelConfig,
})
```

### 8.4 执行流程

```
输入: article.url 或 article.text
         │
         ▼
┌─────────────────────────────────────┐
│  Step 1: 获取文章内容                │
│  - 传 url → web-fetch 抓取正文      │
│    (最多 6000 字符，15s 超时)        │
│  - 传 text → 直接使用               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Step 2: LLM 结构化分析             │
│  - AIClient.chat()                  │
│  - temperature=0.3（稳定输出）       │
│  - 返回纯 JSON（不含 markdown）      │
│  - 提取 keywords + entities         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Step 3: 构建动态关键词              │
│  keywords ∪ entities（去重）        │
│  作为 ALLOWED_KEYWORDS 传入过滤器    │
│  不设 BLOCKED_KEYWORDS（不限制）     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Step 4: 并发抓取 RSS（全量源）      │
│  与 runTrendAgent 复用相同逻辑：     │
│  fetchWithRetry + deduplicateByUrl  │
│  + filterRecentItems + filterByTopic│
└──────────────┬──────────────────────┘
               │
               ▼
         ArticleResearchResult
```

### 8.5 错误处理

| 场景 | 行为 |
|------|------|
| `article.url` 和 `article.text` 均未传 | 抛出 `Error: article.url or article.text is required` |
| URL 抓取失败（网络、4xx/5xx） | 抛出 `Error: failed to fetch article from <url>: ...` |
| LLM 未返回有效 JSON | 抛出 `Error: LLM returned invalid JSON. Response preview: ...` |
| LLM 返回的 summary/keywords 为空 | 抛出 `Error: LLM analysis returned empty summary or keywords` |
| 单个 RSS 源抓取失败 | 静默跳过，计入 `stats.failed`，不影响整体 |

### 8.6 与 Pipeline 集成

目前 `runArticleResearchAgent` 是独立函数，可在 Pipeline 外单独调用。典型场景是在 Dashboard 或 API 层提供"文章分析"入口，将返回的 `relatedItems` 作为 `TopicAgent` 或 `ResearchAgent` 的补充素材传入。

```typescript
// 示例：将文章研究结果作为种子内容传给 TopicAgent
const research = await runArticleResearchAgent({ article: { url }, modelConfig })

// articleAnalysis 可直接附加到 ResearchAgent 的上下文
// relatedItems 可与 runTrendAgent 的结果合并后传给 TopicAgent
const trendItems = [
  ...trendResult.items,
  ...research.relatedItems,
]
```

---

## 9. 配置变更记录

| 日期 | 变更内容 |
|------|---------|
| 2026-03-25 | 初始实现：支持代理、重新设计 RSS 源、关键词重调、移除失效源 |
| 2026-03-25 | 移除 `免费` 关键词（太泛，漏进"免费打印"等非 AI 文章） |
| 2026-03-25 | 多话题支持：`runTrendAgent(topicId?)` 支持切换 ai / society / tech 三个话题，各有独立 RSS 源子集和关键词配置 |
| 2026-03-25 | 新增 `runArticleResearchAgent()`：文章驱动研究模式，LLM 分析文章动态提取关键词后抓取相关 RSS 内容 |
