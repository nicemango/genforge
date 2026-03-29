/**
 * GitHub Trending 信源配置
 *
 * 使用 GitHub Search API 抓取 trending 仓库
 * API: https://docs.github.com/en/rest/search
 */

export interface GitHubSource {
  /** 显示名称 */
  name: string
  /** GitHub Search 查询语句 */
  query: string
  /** 排序方式: stars | updated | help-wanted-issues */
  sort?: 'stars' | 'updated' | 'help-wanted-issues'
  /** 语言筛选 (e.g. "Python", "TypeScript", empty for all) */
  language?: string
  /** 是否仅显示今日新晋项目 */
  daily?: boolean
}

// ---------------------------------------------------------------------------
// 预设 GitHub 信源
// ---------------------------------------------------------------------------

export const GITHUB_SOURCES: GitHubSource[] = [
  {
    name: 'GitHub Trending (全语言)',
    query: 'stars:>100',
    sort: 'stars',
    daily: false,
  },
  {
    name: 'GitHub Trending AI/ML',
    query: 'stars:>500 topic: machine-learning OR topic: artificial-intelligence OR topic: deep-learning',
    sort: 'stars',
    language: undefined,
    daily: false,
  },
  {
    name: 'GitHub Trending Python',
    query: 'stars:>300',
    sort: 'stars',
    language: 'Python',
    daily: false,
  },
  {
    name: 'GitHub Trending TypeScript',
    query: 'stars:>300',
    sort: 'stars',
    language: 'TypeScript',
    daily: false,
  },
  {
    name: 'GitHub Trending Rust',
    query: 'stars:>100',
    sort: 'stars',
    language: 'Rust',
    daily: false,
  },
]

/** 默认每日抓取的信源（高优先级） */
export const DEFAULT_GITHUB_SOURCES: GitHubSource[] = [
  GITHUB_SOURCES[0], // 全语言
  GITHUB_SOURCES[1], // AI/ML
]
