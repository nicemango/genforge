import { z } from 'zod'
import type { Tool, ToolResult } from './types'
import type { GitHubSource } from '@/lib/github-sources'

const FetchGitHubTrendingParamsSchema = z.object({
  sourceName: z.string(),
  query: z.string(),
  sort: z.enum(['stars', 'updated', 'help-wanted-issues']).optional(),
  language: z.string().optional(),
  daily: z.boolean().optional(),
  /** 最大返回数量 */
  limit: z.number().int().positive().optional(),
  /** 请求超时（毫秒） */
  timeoutMs: z.number().int().positive().optional(),
})

interface GitHubRepo {
  name: string
  fullName: string
  description: string
  stars: number
  forks: number
  language: string | null
  url: string
  createdAt: string
  updatedAt: string
  topics: string[]
}

/**
 * 构建 GitHub Search API URL
 */
function buildSearchUrl(source: GitHubSource, limit: number): string {
  const baseUrl = 'https://api.github.com/search/repositories'

  // 构建查询参数
  const params = new URLSearchParams()
  params.set('q', source.query)
  params.set('sort', source.sort ?? 'stars')
  params.set('order', 'desc')
  params.set('per_page', String(Math.min(limit, 100)))

  // 添加语言筛选
  let query = source.query
  if (source.language) {
    query += ` language:${source.language}`
  }

  // 添加时间筛选（近24小时新晋项目）
  if (source.daily) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    query += ` created:>=${yesterday.toISOString().split('T')[0]}`
  }

  params.set('q', query)

  return `${baseUrl}?${params.toString()}`
}

export function createFetchGitHubTrendingTool(): Tool {
  const defaultLimit = 30
  const defaultTimeoutMs = 15_000

  return {
    name: 'fetch_github_trending',
    description:
      'Fetch trending GitHub repositories based on search queries. Returns repo name, description, stars, language, and URL.',
    parameters: {
      type: 'object',
      properties: {
        sourceName: {
          type: 'string',
          description: 'GitHub source name/identifier',
        },
        query: {
          type: 'string',
          description: 'GitHub search query (e.g., "created:>2024-01-01 stars:>100")',
        },
        sort: {
          type: 'string',
          description: 'Sort by: stars, updated, or help-wanted-issues',
          enum: ['stars', 'updated', 'help-wanted-issues'],
        },
        language: {
          type: 'string',
          description: 'Programming language filter (e.g., python, javascript)',
        },
        daily: {
          type: 'boolean',
          description: 'Whether to fetch daily trending (default: true)',
        },
        limit: {
          type: 'number',
          description: `Maximum number of repos to return (default: ${defaultLimit}, max: 100)`,
        },
        timeoutMs: {
          type: 'number',
          description: `Request timeout in milliseconds (default: ${defaultTimeoutMs})`,
        },
      },
      required: ['sourceName', 'query'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      // Build source object from flat params
      const source: GitHubSource = {
        name: String(params.sourceName || ''),
        query: String(params.query || ''),
        sort: params.sort as GitHubSource['sort'],
        language: params.language ? String(params.language) : undefined,
        daily: params.daily !== undefined ? Boolean(params.daily) : true,
      }

      if (!source.name || !source.query) {
        return {
          success: false,
          output: '',
          error: 'Missing required parameters: sourceName and query',
        }
      }

      const limit = params.limit ? Number(params.limit) : defaultLimit
      const timeoutMs = params.timeoutMs ? Number(params.timeoutMs) : defaultTimeoutMs
      const effectiveLimit = Math.min(limit, 100)

      const searchUrl = buildSearchUrl(source, effectiveLimit)

      let controller: AbortController
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      try {
        controller = new AbortController()
        timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        const response = await fetch(searchUrl, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Content-Center/1.0 GitHub Trending Fetcher',
            // GitHub API 未经认证每小时 60 次请求，足够抓取使用
            ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {}),
          },
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          if (response.status === 403) {
            return {
              success: false,
              output: '',
              error: `GitHub API rate limit exceeded. Consider setting GITHUB_TOKEN env var.`,
            }
          }
          return {
            success: false,
            output: '',
            error: `GitHub API returned HTTP ${response.status} for ${searchUrl}`,
          }
        }

        const data = (await response.json()) as {
          total_count: number
          items: Array<{
            name: string
            full_name: string
            description: string | null
            stargazers_count: number
            forks_count: number
            language: string | null
            html_url: string
            created_at: string
            updated_at: string
            topics: string[]
          }>
        }

        const repos: GitHubRepo[] = data.items.slice(0, effectiveLimit).map((item) => ({
          name: item.name,
          fullName: item.full_name,
          description: item.description ?? '(no description)',
          stars: item.stargazers_count,
          forks: item.forks_count,
          language: item.language,
          url: item.html_url,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          topics: item.topics ?? [],
        }))

        return {
          success: true,
          output: JSON.stringify(
            {
              feedTitle: `GitHub: ${source.name}`,
              repos,
              totalCount: data.total_count,
            },
            null,
            2,
          ),
        }
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof Error) {
          if (err.name === 'AbortError') {
            return { success: false, output: '', error: `Timeout after ${timeoutMs}ms fetching GitHub trending` }
          }
          return { success: false, output: '', error: `Failed to fetch GitHub trending: ${err.message}` }
        }
        return { success: false, output: '', error: `Failed to fetch GitHub trending: ${String(err)}` }
      }
    },
  }
}
