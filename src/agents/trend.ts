import { createFetchRssTool } from "@/tools/fetch-rss";
import { createFetchGitHubTrendingTool } from "@/tools/fetch-github-trending";
import { createFetchTwitterTool } from "@/tools/fetch-twitter";
import {
  DEFAULT_TOPIC,
  getTopicConfig,
  getSourcesForTopic,
  getTopicFilter,
  RSS_SOURCES,
  type RssSource,
} from "@/lib/rss-sources";
import { DEFAULT_GITHUB_SOURCES, type GitHubSource } from "@/lib/github-sources";
import { DEFAULT_TWITTER_SOURCES, type TwitterSource } from "@/lib/twitter-sources";
import { loadTrendConfig, type TrendAgentConfig } from "@/lib/trend-config";
import { AIClient } from "@/lib/providers/client-wrapper";
import { createWebFetchTool } from "@/tools/web-fetch";
import type { ModelConfig } from "@/lib/config";

/**
 * Trend Agent
 * 并发抓取多个 RSS 源，进行容错重试、去重、时间过滤与主题过滤，
 * 最终输出统一的数据结构与统计信息
 */

/**
 * 统一的趋势条目结构
 * 由各 RSS 源文章映射而来
 */
export interface TrendItem {
  title: string;
  link: string;
  pubDate: string;
  snippet: string;
  source: string;
}

/**
 * 抓取统计信息
 * - total: RSS 源总数
 * - success/failed/timedOut: 按源维度统计
 * - topicFiltered: 主题过滤被剔除的条目数（按文章维度）
 */
export interface TrendStats {
  total: number;
  success: number;
  failed: number;
  timedOut: number;
  topicFiltered: number;
}

/**
 * 代理最终返回结果
 * - items: 清洗后的文章列表
 * - fetchedAt: 抓取时间
 * - stats: 过程统计
 */
export interface TrendResult {
  items: TrendItem[];
  fetchedAt: string;
  stats: TrendStats;
}

/** 最大重试次数（包含首轮） */
const MAX_RETRIES = 3;

/**
 * Progress callback for real-time trend crawling updates.
 */
export type TrendProgressCallback = (info: {
  phase: string
  current: number
  total: number
  sourceName?: string
  latestItem?: string
  stats?: Partial<TrendStats>
}) => void

/**
 * 运行趋势代理主流程
 * 1. 根据配置获取话题 RSS 源子集与关键词配置
 * 2. 顺序抓取（提供实时进度）；无 onProgress 时退化为并发抓取
 * 3. 去重（按链接）、过滤近 N 天、按主题关键词过滤
 * 4. 返回结果与统计
 *
 * 配置优先级（从高到低）：
 *   1. 传入的 config 参数
 *   2. CLI 参数（--topic / --fresh-days 等）
 *   3. 环境变量（TREND_TOPIC / TREND_FRESH_DAYS 等）
 *   4. src/config/trend-agent.json
 *   5. 代码默认值
 */
export async function runTrendAgent(
  agentConfig?: Partial<TrendAgentConfig['agent']>,
  onProgress?: TrendProgressCallback,
): Promise<TrendResult> {
  const baseConfig = loadTrendConfig()
  const cfg = {
    agent: {
      ...baseConfig.agent,
      ...agentConfig,
    },
  }

  const topic = getTopicConfig(cfg.agent.topic)
  const sources = getSourcesForTopic(topic)
  const { ALLOWED_KEYWORDS, BLOCKED_KEYWORDS } = getTopicFilter(topic)

  const fetchTool = createFetchRssTool({
    defaultLimit: cfg.agent.maxArticlesPerSource,
    maxLimit: cfg.agent.maxArticlesPerSource + 10,
  })

  const stats: TrendStats = {
    total: sources.length,
    success: 0,
    failed: 0,
    timedOut: 0,
    topicFiltered: 0,
  }

  // Fetch RSS sources
  const results: PromiseSettledResult<FetchStatus>[] = []

  if (onProgress) {
    // Sequential with progress reporting
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      const r = await fetchWithRetry(fetchTool, source.url, source.name, 0)
      results.push({ status: 'fulfilled', value: r })
      if (r.status === 'success') stats.success++
      else if (r.status === 'timeout') stats.timedOut++
      else stats.failed++
      onProgress({
        phase: 'crawling',
        current: i + 1,
        total: sources.length,
        sourceName: source.name,
        latestItem: r.status === 'success' && r.items[0] ? r.items[0].title : undefined,
        stats: { ...stats },
      })
    }
  } else {
    // Parallel (fast, no progress)
    results.push(
      ...(await Promise.allSettled(
        sources.map(async (source) => {
          return fetchWithRetry(fetchTool, source.url, source.name, 0)
        }),
      )),
    )
  }

  const items: TrendItem[] = []
  for (const r of results) {
    if (r.status === "fulfilled") {
      const result = r.value
      if (result.status === "success") {
        // stats already updated inline for sequential path; only update here for parallel path
        if (!onProgress) stats.success++
        items.push(...result.items)
      } else if (result.status === "timeout") {
        if (!onProgress) stats.timedOut++
      } else {
        if (!onProgress) stats.failed++
      }
    } else {
      if (!onProgress) stats.failed++
    }
  }

  // Fetch GitHub trending (non-blocking - failures don't halt pipeline)
  const githubItems = await fetchGitHubTrending(DEFAULT_GITHUB_SOURCES)
  items.push(...githubItems)

  // Fetch Twitter tweets (non-blocking - failures don't halt pipeline)
  const twitterItems = await fetchTwitter(DEFAULT_TWITTER_SOURCES)
  items.push(...twitterItems)

  const deduplicated = deduplicateByUrl(items)
  const fresh = filterRecentItems(deduplicated, cfg.agent.freshDays)
  const { items: topicFilteredItems, filteredCount } = filterByTopic(
    fresh,
    ALLOWED_KEYWORDS,
    BLOCKED_KEYWORDS,
  )
  stats.topicFiltered = filteredCount

  return {
    items: topicFilteredItems,
    fetchedAt: new Date().toISOString(),
    stats,
  }
}

/**
 * Fetch GitHub trending repositories
 * Non-blocking: returns empty array on failure
 */
async function fetchGitHubTrending(sources: GitHubSource[]): Promise<TrendItem[]> {
  const tool = createFetchGitHubTrendingTool()
  const items: TrendItem[] = []

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const result = await tool.execute({
        sourceName: source.name,
        query: source.query,
        sort: source.sort ?? 'stars',
        language: source.language,
        daily: source.daily,
        limit: 20,
      })
      if (!result.success) {
        console.warn(`[TrendAgent] GitHub trending fetch failed for ${source.name}: ${result.error}`)
        return []
      }

      const data = JSON.parse(result.output) as {
        repos: Array<{
          name: string
          fullName: string
          description: string
          stars: number
          language: string | null
          url: string
        }>
      }

      return data.repos.map((repo) => ({
        title: `${repo.fullName} ⭐ ${repo.stars}`,
        link: repo.url,
        pubDate: new Date().toISOString(),
        snippet: `${repo.description || '(no description)'} | Language: ${repo.language ?? 'N/A'}`,
        source: `GitHub: ${source.name}`,
      })) as TrendItem[]
    }),
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      items.push(...r.value)
    }
  }

  return items
}

/**
 * Fetch tweets from Twitter accounts
 * Non-blocking: returns empty array on failure
 */
async function fetchTwitter(sources: TwitterSource[]): Promise<TrendItem[]> {
  const tool = createFetchTwitterTool()
  const items: TrendItem[] = []

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const result = await tool.execute({
        sourceName: source.name,
        handle: source.handle,
        minLikes: source.minLikes ?? 100,
        limit: 20,
      })
      if (!result.success) {
        console.warn(`[TrendAgent] Twitter fetch failed for @${source.handle}: ${result.error}`)
        return []
      }

      const data = JSON.parse(result.output) as {
        tweets: Array<{
          id: string
          text: string
          likes: number
          permalink: string
          createdAt: string
          isRetweet: boolean
          isReply: boolean
        }>
      }

      return data.tweets.map((tweet) => ({
        title: tweet.text.slice(0, 100) + (tweet.text.length > 100 ? '...' : ''),
        link: tweet.permalink,
        pubDate: tweet.createdAt,
        snippet: `${tweet.text} | ❤️ ${tweet.likes}${tweet.isRetweet ? ' | RT' : ''}${tweet.isReply ? ' | Reply' : ''}`,
        source: `Twitter: ${source.name}`,
      })) as TrendItem[]
    }),
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      items.push(...r.value)
    }
  }

  return items
}

type FetchStatus =
  | { status: "success"; items: TrendItem[] }
  | { status: "timeout" }
  | { status: "error"; error: string };

/**
 * 带重试与超时控制的抓取
 * - 当抓取失败或异常时，最多重试到 MAX_RETRIES
 * - 使用 AbortController 触发超时中断（底层需支持 signal）
 */
async function fetchWithRetry(
  fetchTool: ReturnType<typeof createFetchRssTool>,
  url: string,
  sourceName: string,
  attempt: number,
): Promise<FetchStatus> {
  try {
    const result = await fetchTool.execute({ url, limit: 20 });

    if (!result.success) {
      if (attempt < MAX_RETRIES - 1) {
        return fetchWithRetry(fetchTool, url, sourceName, attempt + 1);
      }
      console.warn(
        `[TrendAgent] Failed to fetch ${sourceName} after ${attempt + 1} attempts: ${result.error}`,
      );
      return { status: "error", error: result.error ?? "unknown error" };
    }

    const parsed = JSON.parse(result.output) as {
      feedTitle: string;
      articles: Array<{
        title: string;
        link: string;
        pubDate: string;
        snippet: string;
      }>;
    };

    const items: TrendItem[] = parsed.articles.map(
      (a): TrendItem => ({
        title: a.title,
        link: a.link,
        pubDate: a.pubDate,
        snippet: a.snippet?.trim() || a.title,
        source: sourceName,
      }),
    );

    return { status: "success", items };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (attempt < MAX_RETRIES - 1) {
        return fetchWithRetry(fetchTool, url, sourceName, attempt + 1);
      }
      console.warn(
        `[TrendAgent] Timeout fetching ${sourceName} after ${attempt + 1} attempts`,
      );
      return { status: "timeout" };
    }

    if (attempt < MAX_RETRIES - 1) {
      return fetchWithRetry(fetchTool, url, sourceName, attempt + 1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[TrendAgent] Error fetching ${sourceName} after ${attempt + 1} attempts: ${message}`,
    );
    return { status: "error", error: message };
  }
}

/**
 * 按链接去重
 * - 统一小写与去空格后比较
 * - 没有链接的条目不保留
 */
function deduplicateByUrl(items: TrendItem[]): TrendItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.link) return false;
    const normalized = item.link.toLowerCase().trim();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * 仅保留近 N 天的文章
 * - 若无发布时间则保留
 * - 可解析的时间戳需在窗口内
 */
function filterRecentItems(items: TrendItem[], days: number = 7): TrendItem[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return items.filter((item) => {
    if (!item.pubDate) return true // keep items without date
    const pubTime = new Date(item.pubDate).getTime()
    return !isNaN(pubTime) && pubTime >= cutoff
  })
}

// =============================================================================
// Article-driven Research Agent
// =============================================================================

/**
 * 文章驱动模式的输入配置
 * - article.url 与 article.text 二选一
 * - modelConfig 必填，调用方明确指定使用哪个 AI 提供商
 */
export interface ArticleResearchConfig {
  article: { url?: string; text?: string }
  modelConfig: ModelConfig
  /** 要搜索的 RSS 源，默认使用全量 RSS_SOURCES */
  sources?: RssSource[]
  /** 只保留近 N 天的文章，默认 7 */
  freshDays?: number
  /** 每源最多抓取文章数，默认 20 */
  maxArticlesPerSource?: number
}

/**
 * LLM 对文章的结构化分析结果
 */
export interface ArticleAnalysis {
  /** 文章核心内容摘要（2-3 句） */
  summary: string
  /** 提取的关键词，用于 RSS 相关内容过滤（8-15 个） */
  keywords: string[]
  /** 核心实体（公司、产品、人名、技术等） */
  entities: string[]
  /** 文章的叙述角度或核心观点 */
  contentAngle: string
  /** 建议围绕哪些子话题继续研究（3-5 个） */
  suggestedTopics: string[]
}

/**
 * 文章驱动代理的输出
 */
export interface ArticleResearchResult {
  articleAnalysis: ArticleAnalysis
  relatedItems: TrendItem[]
  fetchedAt: string
  stats: TrendStats
}

/**
 * 文章驱动的研究代理主流程
 * 1. 获取文章内容（URL 抓取或直接使用传入文本）
 * 2. LLM 分析文章，提取关键词与实体
 * 3. 以提取的关键词为 ALLOWED_KEYWORDS，在全量 RSS 源中抓取相关内容
 * 4. 返回「文章分析 + 相关素材 + 统计」
 */
export async function runArticleResearchAgent(
  config: ArticleResearchConfig,
): Promise<ArticleResearchResult> {
  const {
    article,
    modelConfig,
    sources = RSS_SOURCES,
    freshDays = 7,
    maxArticlesPerSource = 20,
  } = config

  const articleContent = await resolveArticleContent(article)
  const analysis = await analyzeArticle(articleContent, modelConfig)

  // 合并 keywords + entities 作为动态过滤条件
  const dynamicKeywords = [...new Set([...analysis.keywords, ...analysis.entities])]

  const fetchTool = createFetchRssTool({
    defaultLimit: maxArticlesPerSource,
    maxLimit: maxArticlesPerSource + 10,
  })

  const stats: TrendStats = {
    total: sources.length,
    success: 0,
    failed: 0,
    timedOut: 0,
    topicFiltered: 0,
  }

  const results = await Promise.allSettled(
    sources.map((source) => fetchWithRetry(fetchTool, source.url, source.name, 0)),
  )

  const items: TrendItem[] = []
  for (const r of results) {
    if (r.status === "fulfilled") {
      const result = r.value
      if (result.status === "success") {
        stats.success++
        items.push(...result.items)
      } else if (result.status === "timeout") {
        stats.timedOut++
      } else {
        stats.failed++
      }
    } else {
      stats.failed++
    }
  }

  const deduplicated = deduplicateByUrl(items)
  const fresh = filterRecentItems(deduplicated, freshDays)
  const { items: relatedItems, filteredCount } = filterByTopic(fresh, dynamicKeywords, [])
  stats.topicFiltered = filteredCount

  return {
    articleAnalysis: analysis,
    relatedItems,
    fetchedAt: new Date().toISOString(),
    stats,
  }
}

/**
 * 获取文章正文
 * - 传入 text 时直接返回
 * - 传入 url 时用 web-fetch 工具抓取（最多 6000 字符）
 */
async function resolveArticleContent(
  article: { url?: string; text?: string },
): Promise<string> {
  if (article.text) {
    return article.text
  }

  if (!article.url) {
    throw new Error("ArticleResearchAgent: article.url or article.text is required")
  }

  const webFetchTool = createWebFetchTool()
  const result = await webFetchTool.execute({ url: article.url, maxLength: 6000 })

  if (!result.success) {
    throw new Error(
      `ArticleResearchAgent: failed to fetch article from ${article.url}: ${result.error}`,
    )
  }

  return result.output
}

/**
 * 调用 LLM 对文章进行结构化分析
 * - 要求模型以纯 JSON 返回，不加 markdown fence
 * - 从响应文本中提取第一个完整的 JSON 对象
 */
async function analyzeArticle(content: string, modelConfig: ModelConfig): Promise<ArticleAnalysis> {
  const client = new AIClient(modelConfig, "article-research")

  const systemPrompt = `You are a content research analyst. Analyze the given article and extract structured information for follow-up research.
Respond with a valid JSON object in exactly this schema (no markdown fences, no extra text):
{
  "summary": "2-3 sentence summary of the article's core content",
  "keywords": ["keyword1", "keyword2"],
  "entities": ["entity1", "entity2"],
  "contentAngle": "the article's main narrative angle or key insight in one sentence",
  "suggestedTopics": ["topic1", "topic2"]
}
Rules:
- keywords: 8-15 terms suitable for RSS content filtering (mix Chinese and English if article is Chinese)
- entities: company names, product names, people, technologies mentioned
- suggestedTopics: 3-5 sub-topics worth researching further`

  const truncated = content.slice(0, 8000)
  const response = await client.chat(
    [{ role: "user", content: `Analyze this article:\n\n${truncated}` }],
    { systemPrompt, maxTokens: 1024, temperature: 0.3 },
  )

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")

  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `ArticleResearchAgent: LLM returned invalid JSON. Response preview: ${text.slice(0, 200)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch (err) {
    throw new Error(
      `ArticleResearchAgent: failed to parse LLM analysis JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const obj = parsed as Record<string, unknown>
  const summary = typeof obj.summary === "string" ? obj.summary : ""
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.filter((k): k is string => typeof k === "string")
    : []
  const entities = Array.isArray(obj.entities)
    ? obj.entities.filter((e): e is string => typeof e === "string")
    : []
  const contentAngle = typeof obj.contentAngle === "string" ? obj.contentAngle : ""
  const suggestedTopics = Array.isArray(obj.suggestedTopics)
    ? obj.suggestedTopics.filter((t): t is string => typeof t === "string")
    : []

  if (!summary || keywords.length === 0) {
    throw new Error(
      "ArticleResearchAgent: LLM analysis returned empty summary or keywords",
    )
  }

  return { summary, keywords, entities, contentAngle, suggestedTopics }
}

/**
 * 按主题关键词过滤文章
 * - BLOCKED_KEYWORDS: 标题或摘要含任一关键词则丢弃（优先级更高）
 * - ALLOWED_KEYWORDS: 非空时文章必须含至少一个
 */
function filterByTopic(
  items: TrendItem[],
  ALLOWED_KEYWORDS: string[],
  BLOCKED_KEYWORDS: string[],
): {
  items: TrendItem[];
  filteredCount: number;
} {
  const allowed = ALLOWED_KEYWORDS.length > 0;
  const blocked = BLOCKED_KEYWORDS.length > 0;

  if (!allowed && !blocked) {
    return { items, filteredCount: 0 };
  }

  let filteredCount = 0;
  const filtered = items.filter((item) => {
    const text = `${item.title} ${item.snippet}`.toLowerCase();

    if (blocked) {
      for (const kw of BLOCKED_KEYWORDS) {
        if (text.includes(kw.toLowerCase())) {
          filteredCount++;
          return false;
        }
      }
    }

    if (allowed) {
      const hasAllowed = ALLOWED_KEYWORDS.some((kw) =>
        text.includes(kw.toLowerCase()),
      );
      if (!hasAllowed) {
        filteredCount++;
        return false;
      }
    }

    return true;
  });

  return { items: filtered, filteredCount };
}
