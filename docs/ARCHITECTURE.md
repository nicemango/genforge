# Content Center 整体架构与机制

## 1. 项目概述

Content Center 是一个 AI 驱动的微信公众号内容自动化生产系统。通过多 Agent 管道自动完成：趋势爬取 → 选题筛选 → 深度研究 → 文章撰写 → 配图生成 → 内容审核 → 微信发布。

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS 4, TypeScript |
| 数据库 | SQLite via Prisma ORM |
| AI | Anthropic Claude / OpenAI via @anthropic-ai/sdk |
| 图像生成 | MiniMax API |
| 包管理 | pnpm |

## 3. 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Next.js App Router                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Dashboard   │  │  Topics      │  │  Contents             │  │
│  │  (page.tsx) │  │  (topics/)   │  │  (contents/)         │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                       │               │
│  ┌──────┴─────────────────┴───────────────────────┴───────────┐  │
│  │                     API Routes                              │  │
│  │  /api/pipeline/run   /api/pipeline/step   /api/accounts    │  │
│  └──────────────────────────┬─────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────┐
│                    Pipeline Layer (src/pipeline/)                │
│                              │                                   │
│  ┌──────────────────────────┴────────────────────────────────┐  │
│  │  runStep() / runFullPipeline()                            │  │
│  │  TaskRun 记录 · Workspace 检查点 · 断点恢复 · 质量门控    │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────┐
│                   Agent Layer (src/agents/)                     │
│                                                              │
│  TrendAgent → TopicAgent → ResearchAgent → WriterAgent       │
│       → ImageAgent → ReviewAgent → PublishAgent              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────┐
│                   AI Provider Layer (src/lib/providers/)       │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐     │
│  │ Anthropic  │  │ OpenAI     │  │ AIClient (Facade)   │     │
│  │ Provider   │  │ Provider   │  │ createAgentProvider │     │
│  └────────────┘  └────────────┘  └─────────────────────┘     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────┐
│                    Tools Layer (src/tools/)                    │
│                                                              │
│  fetch-rss.ts (工厂函数)  web-fetch.ts  web-search.ts         │
│  generate-image.ts                                           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────┐
│                 Data Layer (Prisma / SQLite)                  │
│                                                              │
│  Account · Topic · Content · TaskRun · ScheduledTask         │
│  QualityRecord                                               │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────┐
│                 Workspace Layer (workspaces/)                   │
│                                                              │
│  workspaces/{workspaceId}/  ·  run.json  ·  各步骤产物文件   │
│  断点恢复  ·  并行 Pipeline 支持  ·  中间产物可视化          │
└───────────────────────────────────────────────────────────────┘
```

## 4. 核心数据流

```
RSS Sources (200+ feeds)
    │
    ▼
TrendAgent (爬取) ────► TaskRun (TREND_CRAWL)
    │
    ▼
TopicAgent (LLM 筛选) ────► Topic 表 (PENDING)
    │
    ▼
ResearchAgent (深度研究) ────► TaskRun (RESEARCH)
    │
    ▼
WriterAgent (生成文章) ────► Content 表 (DRAFT)
    │
    ▼
ImageAgent (MiniMax 配图) ────► Content.images 更新
    │
    ▼
ReviewAgent (质量审核)
    │  ┌─ score >= 7.0 ──► Content (READY)
    └──┴─ score < 7.0 ──► 重试 WRITE (最多 2 次)
                              │
                              ▼
PublishAgent ────► 微信草稿箱 ────► Content (PUBLISHED)
```

## 5. Pipeline 机制详解

### 5.1 步骤类型 (TaskType)

| 步骤 | 说明 | 关键产物 |
|------|------|----------|
| `TREND_CRAWL` | 从 200+ RSS 源爬取最新内容 | `items[]` |
| `TOPIC_SELECT` | LLM 从趋势中选择最佳选题 | `Topic` 记录 |
| `RESEARCH` | 深度研究选定话题 | `researchSummary` |
| `WRITE` | 生成文章正文 | `Content` (DRAFT) |
| `GENERATE_IMAGES` | 调用 MiniMax 生成配图 | `Content.images` |
| `REVIEW` | 质量审核，评分 0-10 | `Content.status` |
| `PUBLISH` | 推送至微信草稿箱 | `Content.wechatMediaId` |
| `FULL_PIPELINE` | 串联上述所有步骤 | — |

### 5.2 Workspace 架构

每个 Pipeline Run 有独立的 Workspace 目录，用于存储中间产物、支持断点恢复和并行运行。

#### 5.2.1 目录结构

```
workspaces/
└── {workspaceId}/              # 每个 Pipeline Run 一个目录
    ├── run.json                 # 元信息（状态、时间、accountId、currentStep）
    ├── 01-trend/               # TrendAgent 输出
    │   └── items.json
    ├── 02-topic/               # TopicAgent 输出
    │   └── topics.json
    ├── 03-research/             # ResearchAgent 输出
    │   ├── summary.md
    │   ├── research-full.md
    │   └── output.json
    ├── 04-write/               # WriterAgent 输出（每次重试一个版本）
    │   ├── final.md
    │   └── output.json
    ├── 05-images/               # ImageAgent 输出
    │   └── output.json
    ├── 06-review/              # ReviewAgent 输出
    │   └── review.json
    ├── 07-publish/             # PublishAgent 输出
    └── output/                  # 最终产物
        └── article.md
```

#### 5.2.2 run.json 结构

```typescript
interface RunJson {
  id: string
  accountId: string
  status: 'running' | 'completed' | 'failed'
  currentStep: AgentType | null   // 当前执行到的步骤
  createdAt: string
  updatedAt: string
  checkpoint: {
    completedSteps: AgentType[]    // 已完成的步骤列表
    lastOutput: Record<string, unknown>  // 各步骤的最新输出
  }
}
```

#### 5.2.3 WorkspaceManager (`src/lib/workspace.ts`)

| 方法 | 说明 |
|------|------|
| `create(accountId, workspaceId?)` | 创建新 workspace 及目录结构 |
| `get(workspaceId)` | 获取 workspace 元信息 |
| `readPreviousOutput(workspaceId, step, filename)` | 读取前序步骤产物 |
| `writeOutput(workspaceId, step, filename, content)` | 写入步骤产物 |
| `checkpoint(workspaceId, step, output)` | 创建检查点，更新 run.json |
| `resume(workspaceId)` | 从检查点恢复，返回 currentStep 和 previousOutputs |
| `setStatus(workspaceId, status)` | 更新状态（completed/failed） |
| `list()` | 列出所有 workspace |
| `delete(workspaceId)` | 删除 workspace |

#### 5.2.4 断点恢复机制

```typescript
// FULL_PIPELINE 启动时检查是否有可恢复的 workspace
const workspace = workspaceManager.get(workspaceId)
if (workspace?.status === 'running' && workspace.currentStep) {
  const { currentStep, previousOutputs } = workspaceManager.resume(workspaceId)
  // 跳过已完成步骤，从 currentStep 继续执行
}
```

#### 5.2.5 PipelineInput 扩展

```typescript
interface PipelineInput {
  accountId: string
  topicCount?: number
  topicId?: string
  reviewFeedback?: string
  retriesLeft?: number
  workspaceId?: string  // 新增：指定 workspace ID，不提供则自动生成
}
```

#### 5.2.6 部署说明

| 部署方式 | Workspace 持久化 | 建议 |
|---------|------------------|------|
| Vercel/Netlify (serverless) | ❌ 不支持 | 需切换到数据库存储 |
| Railway/Render/EC2 | ✅ 支持 | 可用 workspaces/ 目录 |
| Docker | ✅ 支持（需挂载 volume） | 同上 |

> **注意**：`workspaces/` 目录为运行时产物，仅用于本地开发和服务器部署。若需支持 serverless，需将 WorkspaceManager 存储层切换为数据库。

### 5.3 质量门控 (Quality Gate)

- **评分维度**：观点深度 · 文章结构 · 数据支撑 · 流畅度（各 0-10 分）
- **总分**：四项平均 → 映射到 10 分制
- **通过阈值**：`minScore`（默认 7.0，可按账户配置）
- **重试机制**：默认最多 2 次写尝试；Review 失败时自动将审核反馈注入 Writer 重写
- **非阻塞步骤**：`GENERATE_IMAGES` 失败只打日志，不中断管道

### 5.4 幂等性

`FULL_PIPELINE` 启动前检查同一账户是否存在 `RUNNING` 状态的管道实例；若存在则抛出错误，避免重复执行。

### 5.5 TaskRun 记录

每次 `runStep` 调用都会在 `TaskRun` 表创建一条记录，包含：
- `input` / `output`（JSON 字符串）
- `status`（RUNNING / SUCCESS / FAILED / CANCELLED）
- `durationMs`（耗时毫秒）
- `error`（失败时错误信息）

## 6. AI Provider 抽象

### 6.1 接口定义 (`src/lib/providers/types.ts`)

```typescript
interface AIProvider {
  readonly name: string
  readonly defaultModel: string
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>
  chatWithTools(messages: Message[], tools: ToolDef[], options?: ChatOptions): Promise<ChatResponse>
}
```

### 6.2 ModelConfig 结构 (`src/lib/config.ts`)

```typescript
interface ModelConfig {
  defaultProviderType?: 'anthropic' | 'openai'
  defaultModel?: string
  apiKey?: string
  baseURL?: string
  overrides?: Record<string, string>           // per-agent model 覆盖
  agentProviders?: Record<string, ProviderConfig> // per-agent 完整配置
  minimaxApiKey?: string
}
```

### 6.3 Provider 解析

`createAgentProvider(agentName, modelConfig)` 根据以下优先级解析：
1. `modelConfig.agentProviders[agentName]` — 该 Agent 专属 Provider
2. `modelConfig.overrides[agentName]` — 仅模型名覆盖，使用默认 Provider 类型
3. `modelConfig.defaultModel` / `defaultProviderType` — 全局默认

## 7. WeChat 集成 (`src/lib/wechat.ts`)

### 7.1 核心 API

| 函数 | 说明 |
|------|------|
| `getAccessToken(accountId)` | 获取 access_token，带缓存（自动提前 5 分钟刷新） |
| `pushToDraft(accountId, article)` | 创建图文消息草稿 |
| `uploadImage(accountId, imageBase64)` | 上传图片为永久素材 |
| `uploadPlaceholderThumb(accountId, token)` | 若未配置封面图，从 picsum.photos 上传并缓存 |

### 7.2 Token 缓存机制

access_token 有效期 2 小时。实现提前 5 分钟（buffer）刷新，缓存于 `Account.wechatConfig.cachedToken` 和 `tokenExpiresAt`。

## 8. 数据库模型关系

```
Account (1) ─── (N) Topic
  │                    │
  │                    └── (1) Content (1) ─── (N) QualityRecord
  │
  ├── (N) TaskRun
  ├── (N) ScheduledTask
  └── (N) QualityRecord
```

### 8.1 关键字段

**Topic**
- `heatScore`：热度评分（LLM 评估）
- `status`：PENDING → IN_PROGRESS → DONE / SKIPPED
- `sources`：原始信息源 JSON

**Content**
- `status`：DRAFT → REVIEWING → READY → PUBLISHED / REJECTED
- `images`：JSON 数组 `[{alt, caption, base64}]`
- `reviewNotes`：JSON `{score, issues, suggestions}`

**QualityRecord**
- 审核分数追踪，用于质量趋势分析
- `writeAttempts`：通过所需写次数

## 9. API 路由概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/pipeline/run` | POST | 运行完整管道 |
| `/api/pipeline/step` | POST | 运行单个管道步骤 |
| `/api/accounts` | GET/POST | 账户 CRUD |
| `/api/accounts/[id]` | GET/PUT/DELETE | 单个账户操作 |
| `/api/topics` | GET/POST | 选题列表/创建 |
| `/api/contents` | GET | 内容列表 |
| `/api/contents/[id]` | GET/PUT | 内容详情/更新 |
| `/api/contents/[id]/publish` | POST | 手动发布 |
| `/api/schedules` | GET/POST | 定时任务 CRUD |
| `/api/cron` | GET/POST | Cron 触发器 |
| `/api/quality-records` | GET | 质量记录查询 |

## 10. 环境变量

```
DATABASE_URL="file:./dev.db"
DEFAULT_AI_API_KEY=          # Anthropic API key
DEFAULT_AI_BASE_URL=         # API 代理地址（可选）
DEFAULT_AI_MODEL=            # 默认模型（如 claude-sonnet-4-6）
DEFAULT_AI_PROVIDER_TYPE=    # anthropic | openai
CRON_SECRET=                  # Cron 端点认证密钥
MINIMAX_API_KEY=             # MiniMax 图像生成 API Key
```
