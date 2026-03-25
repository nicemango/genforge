# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Content Center is an AI-powered automated WeChat public account content production system. It uses a multi-agent pipeline to crawl trends, select topics, research, write articles, generate images, review, and publish content.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: React 19, Tailwind CSS 4, TypeScript
- **Database**: SQLite via Prisma ORM
- **AI**: Anthropic Claude via @anthropic-ai/sdk
- **Package Manager**: pnpm

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm start        # Start production server
pnpm db:migrate   # Run Prisma migrations
pnpm db:push      # Push schema changes to database
pnpm db:generate  # Generate Prisma client
pnpm db:studio    # Open Prisma Studio
```

## Architecture

### Data Flow
```
RSS Sources → TrendAgent (crawl) → TopicAgent (select) → ResearchAgent → WriterAgent → ImageAgent → ReviewAgent → PublishAgent
```

### Key Layers

**Pipeline** (`src/pipeline/index.ts`): Orchestrates the full content workflow. Each step is executed sequentially via `runStep()`. `FULL_PIPELINE` runs the entire chain; individual steps can be run via `step` parameter.

**Quality Gate**: `qualityConfig` (stored per Account, defaults `{minScore: 7.0, maxWriteRetries: 2}`) controls the review loop. REVIEW step scores content 0-10; if below `minScore`, WRITE is retried up to `maxWriteRetries` times with review feedback injected. GENERATE_IMAGES is non-blocking (failures are logged but don't halt pipeline.

**Idempotency**: FULL_PIPELINE checks for existing RUNNING pipelines on the same account before starting, throwing if one is found.

**WeChat Integration** (`src/lib/wechat.ts`): Full WeChat Official Account API integration:
- `getAccessToken()` - fetches and caches access tokens (auto-refreshes 5 min before expiry)
- `pushToDraft()` - creates a draft article via `cgi-bin/draft/add`
- `uploadImage()` - uploads images as WeChat permanent materials
- `uploadPlaceholderThumb()` - uploads cover image from picsum.photos if not configured; result cached in `wechatConfig.defaultThumbMediaId`

**Agents** (`src/agents/`): Each agent handles a specific pipeline stage:
- `trend.ts` - Crawls RSS feeds from multiple sources
- `topic.ts` - Uses LLM to select best topics from trends
- `research.ts` - Deep research on selected topic
- `writer.ts` - Generates article content
- `image.ts` - Generates article cover images via MiniMax
- `review.ts` - Reviews and scores content quality
- `publisher.ts` - Publishes to WeChat

**Tools** (`src/tools/`): Reusable tool implementations for agents:
- `fetch-rss.ts` - `createFetchRssTool(opts?)` factory returns a tool; `opts.defaultLimit` / `opts.maxLimit` control per-source item counts
- `web-fetch.ts` - Fetches and parses web page content
- `web-search.ts` - Web search capability
- `generate-image.ts` - MiniMax image generation tool
- Tool interface: `{ name: string, description: string, parameters: JSONSchema, execute(params) }`

**AI Layer** (`src/lib/providers/`): Provider abstraction with pluggable backends:
- `client-wrapper.ts` exports `AIClient` - unified interface with `chat()` and `chatWithTools()`
- `registry.ts` exports `createAgentProvider()` - resolves provider from `ProviderConfig`
- `anthropic.ts` / `openai.ts` - concrete provider implementations
- `types.ts` defines `AIProvider` interface: `{ name, defaultModel, chat(), chatWithTools() }`
- `src/lib/ai.ts` re-exports the public surface; actual implementation lives in `providers/`
- `ModelConfig` (from `src/lib/config.ts`) carries `apiKey`, `baseURL`, `defaultModel`, `defaultProviderType`, and per-agent model overrides

### Database Schema (Prisma)

- **Account**: User configuration with `modelConfig`, `writingStyle`, `wechatConfig` stored as JSON strings
- **Topic**: Selected topics with `heatScore`, `status` (PENDING/IN_PROGRESS/DONE/SKIPPED)
- **Content**: Generated articles with `status` (DRAFT/REVIEWING/READY/PUBLISHED/REJECTED)
- **TaskRun**: Pipeline execution history with `taskType`, `status`, `durationMs`
- **ScheduledTask**: Cron-based scheduled pipeline runs

### UI Structure

- `src/app/page.tsx` - Dashboard with stats, recent content, recent tasks
- `src/app/topics/page.tsx` - Topic list with heat scores
- `src/app/contents/page.tsx` - Content list with status
- `src/app/accounts/page.tsx` - Account configuration
- `src/app/tasks/page.tsx` - Manual task execution and scheduling

### Design System

UI follows "霓虹先锋" (Neon Pioneer) style defined in `globals.css`:
- Primary color: `#7c2bee` (purple)
- Fonts: Nunito, Quicksand
- Card hover effects with `translateY(-2px)` and shadow transitions
- Semantic status badges with rounded pill style

## Documentation

- `docs/ARCHITECTURE.md` - 系统整体架构、数据流、Pipeline 机制、AI Provider 抽象
- `docs/CORE_MODULES.md` - 各核心模块设计决策、实现细节、接口规范

## Environment Variables

```
DATABASE_URL="file:./dev.db"
DEFAULT_AI_API_KEY=         # Anthropic API key
DEFAULT_AI_BASE_URL=         # API base URL (optional)
DEFAULT_AI_MODEL=            # Default model (e.g., claude-sonnet-4-6)
CRON_SECRET=                 # Secret for cron endpoint authentication
MINIMAX_API_KEY=            # For image generation (optional)
```
