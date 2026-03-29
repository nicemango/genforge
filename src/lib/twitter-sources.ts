/**
 * Twitter/X 信源配置
 *
 * 支持两种抓取方式：
 * 1. Nitter (免费公共实例) - RSS-like 格式
 * 2. twitter-api.io (需要 API Key) - 更可靠
 */

export interface TwitterSource {
  /** 显示名称 */
  name: string
  /** Twitter handle (不含 @) */
  handle: string
  /** 权重：影响在 TopicAgent 筛选时的优先级 */
  weight: number
  /** 最低点赞数阈值：只有超过此值的推文才会进入候选池 */
  minLikes?: number
}

// ---------------------------------------------------------------------------
// 预设 Twitter 信源
// ---------------------------------------------------------------------------

export const TWITTER_SOURCES: TwitterSource[] = [
  // AI/科技圈英文账号
  { name: 'Sam Altman', handle: 'sama', weight: 10, minLikes: 100 },
  { name: 'Yann LeCun', handle: 'ylecun', weight: 10, minLikes: 100 },
  { name: 'Jeremy Howard', handle: 'jeremyphoward', weight: 9, minLikes: 50 },
  { name: 'Andrew Ng', handle: 'AndrewYNg', weight: 9, minLikes: 100 },
  { name: 'Jim Fan', handle: 'DrJimFan', weight: 9, minLikes: 50 },
  { name: 'Andrej Karpathy', handle: 'karpathy', weight: 10, minLikes: 200 },
  { name: 'Emil Ledezma', handle: 'uledezma', weight: 8, minLikes: 30 },

  // 中文科技圈
  { name: '陈皓', handle: 'haoel', weight: 9, minLikes: 50 },
  { name: '阮一峰', handle: 'ruanyf', weight: 8, minLikes: 50 },
  { name: '云风', handle: 'cloudwu', weight: 8, minLikes: 30 },
  { name: '淘漆', handle: 'taosay', weight: 7, minLikes: 30 },
]

/** 默认抓取的账号（高权重） */
export const DEFAULT_TWITTER_SOURCES = TWITTER_SOURCES.filter((s) => s.weight >= 9)

// ---------------------------------------------------------------------------
// Nitter 实例列表（按优先级排序）
// ---------------------------------------------------------------------------

export const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.lcc.party',
  'https://nitter.1d4.us',
  'https://nitter.kavin.rocks',
]

/**
 * 获取当前可用的 Nitter 实例
 * 按顺序尝试，返回第一个可用的
 */
export function getNitterInstance(): string {
  // 可通过环境变量覆盖
  if (process.env.NITTER_INSTANCE) {
    return process.env.NITTER_INSTANCE
  }
  return NITTER_INSTANCES[0]
}
