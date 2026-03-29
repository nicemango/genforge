# 核心模块与实现方案

本文档聚焦各核心模块的设计决策、实现细节和技术方案。

---

## 1. Agent 模块

所有 Agent 位于 `src/agents/`，遵循统一模式：
- 接收 `ModelConfig` + 相关输入参数
- 通过 `createAgentProvider(agentName, modelConfig)` 获取 AI Provider
- 调用 `provider.chat()` 或 `provider.chatWithTools()` 与 LLM 交互
- 返回结构化结果

### 1.1 TrendAgent (`trend.ts`)

**职责**：从 200+ RSS 源批量抓取最新内容

**实现**：
- 使用 `createFetchRssTool()` 工厂函数创建 RSS 抓取工具
- 默认从 `RSS_SOURCES` 常量读取所有源（分类：tech / business / ai / dev / startup 等）
- 并发抓取所有源，聚合、去重、排序

**RSS 源分类**：
| 分类 | 数量 | 来源示例 |
|------|------|----------|
| 国内科技 | ~30 | 36氪、虎嗅、钛媒体 |
| 国内商业财经 | ~40 | 第一财经、财经网、界面 |
| 国内 AI | ~15 | 新智元、AI科技大本营 |
| 开发者 | ~40 | CSDN、开源中国、掘金 |
| 创业投资 | ~15 | 创业邦、投中网 |
| 产品设计 | ~30 | 优设、站酷、Behance |
| 国际科技/AI | ~50 | Hacker News、TechCrunch |
| 科研学术 | ~20 | ArXiv、Nature、Science |
| 其他（游戏/汽车/医疗/教育等） | ~60 | — |

### 1.2 TopicAgent (`topic.ts`)

**职责**：从爬取的 trend items 中通过 LLM 筛选出最佳选题

**实现**：
- 构造包含 `topic.title` / `angle` / `summary` / `heatScore` / `tags` 的 `TopicSuggestion[]`
- 调用 LLM 进行多标签评分和筛选
- 每个选题创建一条 `Topic` 记录（status: PENDING）

**输出结构**：
```typescript
interface TopicSuggestion {
  title: string
  angle: string          // 写作角度/切入方向
  summary: string         // 选题摘要
  heatScore: number      // 热度评分 0-10
  tags: string[]
  sources: { title: string; url: string; source: string }[]
}
```

### 1.3 ResearchAgent (`research.ts`)

**职责**：对选定话题进行深度研究

**实现**：
- 接收 `TopicSuggestion`，带话题方向和原始信息源
- 使用 `web-fetch` 和 `web-search` 工具深入挖掘
- 综合多来源信息生成结构化研究报告

**输出结构**：
```typescript
interface ResearchResult {
  summary: string
  keyPoints: string[]
  sources: { title: string; url: string }[]
  rawOutput: string  // 完整 LLM 输出
}
```

### 1.4 WriterAgent (`writer.ts`)

**职责**：基于话题和研究资料生成微信公众号文章

**实现关键设计**：

#### 品牌人设
- 品牌名「科技猫」，定位：科技圈最敢说真话的朋友
- 绝对禁区：空洞开场白 / 假大空结尾 / 无来源数据 / 学术腔

#### 文章结构规范
| 部分 | 字数 | 要求 |
|------|------|------|
| 标题 | 20-30字 | 制造认知落差，含数字/对比/反常识 |
| Hook 开头 | 200-300字 | 反常识开场 / 具体场景 / 辛辣设问 |
| 数据部分 | 400-500字 | 2-3 个关键数据 + 1-2 案例 |
| 分析部分 | 1000-1200字 | 2-3 子章节，层层递进 |
| 结尾 | 150-200字 | 观点总结 + 具体行动 + 留白 |
| **合计** | **2000-2800字** | — |

#### 配图占位符
- 固定位置插入 `![描述](image:cover)` 和 `![描述](image:section-N)` 占位符
- 开篇 1 张 + 每章 1 张，全文 3-4 张

#### 重写机制
Review 失败后，Review 反馈以结构化 prompt 片段注入 Writer 重新生成。

#### 字数统计算法
```typescript
// 中文字符=1，英文单词=2，数字=0.5
chineseChars + englishWords * 2 + Math.floor(numbers / 2)
```

### 1.5 ImageAgent (`image.ts`)

**职责**：调用 MiniMax API 生成文章配图

**实现**：
- 输入：文章标题 + 正文
- 使用 `src/lib/minimax-image.ts` 中的 MiniMax 客户端
- 生成 3-4 张配图（含 alt 描述和 caption）
- 按正文中的 `![描述](image:cover)` / `![描述](image:section-N)` 占位符顺序回填最终图片 URL

**MiniMax API**：
- 模型：`image-01`
- 输出：base64 JPEG + alt + caption
- API Key 来源：`modelConfig.minimaxApiKey` 或 `process.env.MINIMAX_API_KEY`

### 1.6 ReviewAgent (`review.ts`)

**职责**：审核文章质量，评分并给出修改建议

#### 评分维度（4 项 × 10 分 = 40 分 → 10 分制）

| 维度 | 满分标准 | 主要扣分项 |
|------|----------|------------|
| 观点深度 | 观点鲜明有立场，不是理中客 | 空洞废话每处扣 2 分 |
| 文章结构 | Hook 吸引人 + 章节标题自带观点 + 结尾有行动建议 | 背景介绍式开头扣 5 分，废话结尾扣 10 分 |
| 数据支撑 | ≥5 处具体公司/产品/数字，有来源 | 无来源数据每个扣 2 分 |
| 流畅度 | 语句通顺，无语法/标点错误 | 每处语病/错别字扣 1 分（上限 5 分） |

#### 预检数据
在调用 LLM 审核前，预检测：
- 中文字数统计
- 配图占位符数量
- 检测到的公司/品牌名
- 检测到的数字/数据点

#### 输出结构
```typescript
interface ReviewResult {
  score: number
  passed: boolean
  dimensionScores: { perspective, structure, dataSupport, fluency }
  reasoning: string[]       // 每项扣分原因
  issues: string[]          // 具体问题，带段落位置
  suggestions: string[]     // 按优先级排序的可执行修改建议
  fixedBody?: string        // score < 7.0 时输出修复后正文
}
```

### 1.7 PublishAgent (`publisher.ts`)

**职责**：将 Ready 状态的内容推送到微信公众号草稿箱

**实现**：调用 `wechat.ts` 中的 `pushToDraft()` 函数

---

## 2. Pipeline 模块 (`src/pipeline/index.ts`)

### 2.1 入口函数

```typescript
// 运行完整管道
runFullPipeline(input: PipelineInput): Promise<PipelineOutput>

// 运行单个步骤
runStep(input: PipelineStepInput): Promise<PipelineOutput>
```

### 2.2 PipelineInput / PipelineStepInput 结构

```typescript
interface PipelineInput {
  accountId: string
  topicCount?: number        // TOPIC_SELECT 生成多少个选题
  topicId?: string           // 单步执行时指定 topic
  reviewFeedback?: string    // REVIEW → WRITE 重试时注入的审稿反馈
  retriesLeft?: number       // 内部字段
  workspaceId?: string       // Workspace ID，不提供则自动生成
}

interface PipelineStepInput extends PipelineInput {
  step: TaskType
  parentRunId?: string       // FULL_PIPELINE 下子步骤关联父 TaskRun
  onProgress?: (info: StepProgressInfo) => void
  writeAttempts?: number     // 传给 REVIEW 记录本次写作尝试次数
}
```

### 2.3 Workspace 检查点与恢复

`FULL_PIPELINE` 启动时检查 `workspaceId` 对应的 workspace 状态：

1. 若 workspace 存在且状态为 `running` → 调用 `workspaceManager.resume()` 从断点继续
2. 若 workspace 不存在或状态为 `completed/failed` → 创建新 workspace，从头开始
3. 每个步骤完成后调用 `workspaceManager.checkpoint()` 写入中间产物并更新 run.json
4. 步骤产物按类型写入对应目录（如 `03-research/summary.md`）

断点恢复时，已完成的步骤会被跳过，直接复用 workspace 中缓存的输出。

### 2.4 FULL_PIPELINE 执行流程

当前 `FULL_PIPELINE` 是“先全局步骤、再逐 topic 串行处理”的编排器：

```text
1. 幂等检查：同一 account 若已有 RUNNING 的 FULL_PIPELINE，则直接报错
2. 初始化或恢复 workspace
3. 执行全局步骤
   3.1 TREND_CRAWL
   3.2 TOPIC_SELECT
4. 从 workspace/topic step 输出中取出 topicIds
5. 按 topicIds 顺序逐个处理，每个 topic 执行：
   5.1 RESEARCH(topicId)
   5.2 WRITE(topicId)
   5.3 GENERATE_IMAGES(topicId)   // 非阻塞，失败仅记录 warning
   5.4 REVIEW(topicId)
       ├─ passed = true  → PUBLISH(topicId)
       └─ passed = false → buildReviewFeedback() 后重试 WRITE
6. 单个 topic 的 WRITE / REVIEW 最多执行 maxWriteRetries + 1 轮
7. 只要有一个 topic 成功发布，即返回第一个成功结果
8. 若所有 topic 均失败，则返回 failed，并附 failedTopics 详情
```

补充说明：
- 当前不是只处理 `topicIds[0]`，而是会遍历 `TOPIC_SELECT` 产出的所有 `topicIds`
- topic 之间当前是串行执行，不是并行执行
- `GENERATE_IMAGES` 是非阻塞步骤，不影响后续 REVIEW / PUBLISH
- REVIEW 失败后的重写，依赖 `buildReviewFeedback()` 生成结构化反馈再注入 Writer
- 最后一轮若仍未通过，但 Review 返回了 `fixedBody`，会将其回写到最后一篇内容中

### 2.5 质量配置（per Account）

```typescript
interface QualityConfig {
  minScore: number        // 通过阈值，默认 7.0
  maxWriteRetries: number  // 最大写重试次数，默认 2
}
// 存储于 Account.qualityConfig JSON 字段
```

---

## 3. Provider 模块 (`src/lib/providers/`)

### 3.1 核心接口

```typescript
interface AIProvider {
  name: string
  defaultModel: string
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>
  chatWithTools(messages: Message[], tools: ToolDef[], options?: ChatOptions): Promise<ChatResponse>
}

interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}
```

### 3.2 AnthropicProvider (`anthropic.ts`)

- 内部使用 `@anthropic-ai/sdk`
- 消息格式适配：将 `Message[]` 转换为 Anthropic 格式
- `chatWithTools`：处理 tool_use / tool_result 类型

### 3.3 OpenAIProvider (`openai.ts`)

- 内部使用 OpenAI SDK
- 将 `ContentBlock` 适配为 OpenAI 的 tool_calls 格式

### 3.4 AIClient 封装 (`client-wrapper.ts`)

```typescript
export class AIClient {
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>
  chatWithTools(messages: Message[], tools: ToolDef[], options?: ChatOptions): Promise<ChatResponse>
}
```

### 3.5 Provider 注册表 (`registry.ts`)

```typescript
export function createAgentProvider(
  agentName: string,
  config: ModelConfig
): AIProvider
// 解析优先级：agentProviders[agentName] > overrides[agentName] > defaults
```

---

## 4. Tools 模块 (`src/tools/`)

### 4.1 Tool 接口规范

```typescript
interface Tool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
  execute(params: Record<string, unknown>): Promise<unknown>
}
```

### 4.2 fetch-rss.ts

```typescript
createFetchRssTool(opts?: {
  defaultLimit?: number   // 每个源默认返回条数
  maxLimit?: number        // 每个源最大条数
}): Tool
```

**实现要点**：
- 并发抓取所有 RSS 源（Promise.allSettled）
- 解析 XML（使用原生 DOMParser 或 xml2js）
- 按 `pubDate` 排序
- 可选按分类/关键词过滤

### 4.3 web-fetch.ts

- 抓取指定 URL 的 HTML 内容
- 使用 Cheerio 解析，提取正文
- 处理反爬（User-Agent 设置）

### 4.4 web-search.ts

- 调用搜索 API 获取搜索结果
- 返回结构化搜索结果列表

### 4.5 generate-image.ts

- 调用 MiniMax 图像生成 API
- 输入：描述文本
- 输出：base64 图片数据

---

## 5. WeChat 模块 (`src/lib/wechat.ts`)

### 5.1 Token 管理

```typescript
async function getAccessToken(accountId: string): Promise<string> {
  // 1. 从 Account.wechatConfig 读取缓存
  // 2. 若缓存有效（tokenExpiresAt > now + 300），直接返回
  // 3. 否则调用微信 API 获取新 token
  // 4. 更新 Account.wechatConfig 缓存
}
```

### 5.2 推送到草稿箱

```typescript
async function pushToDraft(
  accountId: string,
  article: WechatArticle
): Promise<string> {
  // 1. 获取 access_token
  // 2. 处理封面图（thumb_media_id）：
  //    - 优先用 article.thumb_media_id
  //    - 其次用 Account.wechatConfig.defaultThumbMediaId
  //    - 最后调用 uploadPlaceholderThumb()
  // 3. 调用 /cgi-bin/draft/add 接口
  // 4. 返回 media_id
}
```

### 5.3 封面图自动上传

若账户未配置 `defaultThumbMediaId`，自动从 picsum.photos 下载 900x383 图片作为永久素材上传，结果缓存到 `wechatConfig`。

---

## 6. 数据库 Schema 要点

### 6.1 JSON 字段约定

以下字段以 JSON 字符串存储，解析逻辑分散在各模块：

| 字段 | 类型 | 解析位置 |
|------|------|----------|
| `Account.modelConfig` | JSON | `pipeline/index.ts` |
| `Account.writingStyle` | JSON | `pipeline/index.ts` |
| `Account.wechatConfig` | JSON | `wechat.ts` |
| `Account.qualityConfig` | JSON | `pipeline/index.ts` |
| `Topic.tags` | JSON string[] | `pipeline/index.ts` |
| `Topic.sources` | JSON string[] | `pipeline/index.ts` |
| `Content.images` | JSON string[] | `pipeline/index.ts` |
| `Content.reviewNotes` | JSON | `pipeline/index.ts` |
| `QualityRecord.issues` | JSON string[] | `pipeline/index.ts` |
| `QualityRecord.suggestions` | JSON string[] | `pipeline/index.ts` |

### 6.2 索引

```prisma
@@index([accountId, status])   // Topic, Content
@@index([accountId, taskType]) // TaskRun
@@index([accountId, createdAt]) // QualityRecord
```

---

## 7. 定时任务 (`src/lib/scheduler.ts`)

- 使用 `node-cron` 或 Next.js API Route 实现
- `ScheduledTask` 表存储定时配置：`cronExpr` + `taskType` + `config`
- `/api/cron` 端点接收 Cron 触发，验证 `CRON_SECRET` 后执行对应管道

---

## 8. 待优化方向

1. **多账号支持**：目前 FULL_PIPELINE 只处理第一个选题，可扩展为批量处理
2. **图片上传到微信**：当前图片以 base64 存在 DB，可改为上传至微信永久素材
3. **Review 修复**：ReviewAgent 的 `fixedBody` 目前在 score < 7.0 时生成但不一定被采用
4. **RSS 源管理**：目前 RSS_SOURCES 是常量，可改为数据库管理，支持增删启禁用
5. **监控告警**：TaskRun 失败时缺乏告警机制（Slack/邮件等）
