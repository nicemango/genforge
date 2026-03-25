export interface RssSource {
  name: string
  url: string
  category: string
  /** 是否需要代理才能访问 */
  needsProxy?: boolean
}

// ---------------------------------------------------------------------------
// Universal blocked keywords — apply to ALL topics
// ---------------------------------------------------------------------------
const UNIVERSAL_BLOCKED = [
  // 情感/娱乐噪声
  '情感', '分手', '复合', '恋爱', '脱单', '相亲',
  '追星', '偶像', '粉丝', '演唱会', '明星八卦',
  '彩票', '中奖', '双色', '大乐透', '开奖',
  '星座', '运势', '塔罗', '占卜',
  '征婚', '交友', '婚介',
] as string[]

// ---------------------------------------------------------------------------
// Topic Configurations
// ---------------------------------------------------------------------------

export interface TopicConfig {
  /** 话题 ID，传递给 runTrendAgent(topicId) */
  id: string
  /** 显示名称 */
  name: string
  /** 话题描述 */
  description: string
  /** 使用该话题的 RSS 源分类（留空表示全部） */
  sourceCategories?: string[]
  /** 额外 ALLOWED 关键词（与 Universal 合并后生效） */
  allowedKeywords: string[]
  /** 额外 BLOCKED 关键词（追加到 Universal 后生效） */
  blockedKeywords: string[]
}

/**
 * 预设话题列表
 *
 * 话题选择逻辑：
 * - sourceCategories 非空时，只抓指定分类的源；为空时抓全部源
 * - ALLOWED_KEYWORDS = Universal_BLOCKED 外的自定义 allowed + topic-specific
 * - BLOCKED_KEYWORDS = UNIVERSAL_BLOCKED + topic-specific blocked
 */
export const TOPICS: TopicConfig[] = [
  // ========== AI / 开发者 ==========
  {
    id: 'ai',
    name: 'AI & 开发者',
    description: 'AI 模型、工具、项目更新、开发者社区热议',
    sourceCategories: [
      'cn_tech',    // 中文科技媒体
      'intl_dev',   // HN / Lobsters / Smashing
      'research',    // arXiv
      'intl_tech',  // TechCrunch / Verge / Wired
      'ai_project', // AI 公司博客
    ],
    allowedKeywords: [
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
    ],
    blockedKeywords: [
      // 泛商业/财经噪声
      '上市', 'IPO', '市值', '股价', '财报', '融资', '投资', '并购', '战略投资',
      '独角兽', '估值', '商业化', '营收', '亏损',
      '公募基金', '私募', '理财', '借贷',
      // 传统行业
      '房地产', '房价', '股市', '基金', '期货',
    ],
  },

  // ========== 社会 ==========
  {
    id: 'society',
    name: '社会',
    description: '社会热点、民生、舆情、公共事件',
    sourceCategories: ['cn_tech'], // 36kr / 钛媒体等也报道社会话题
    allowedKeywords: [
      // 社会热点
      '社会', '民生', '舆情', '热搜', '热点', '事件',
      '政策', '监管', '法规', '法律', '判决', '案件',
      '教育', '医疗', '就业', '住房', '养老', '社保',
      '人口', '生育', '老龄化', '三孩',
      '食品安全', '药品安全', '生产安全',
      '环境', '污染', '环保', '碳中和',
      '灾害', '地震', '洪水', '火灾', '事故',
      '犯罪', '诈骗', '盗窃', '暴力', '未成年人',
      '劳动', '裁员', '工资', '拖欠', '维权',
      '公共', '公益', '慈善', '捐款',
      '突发', '爆炸', '坍塌', '踩踏',
    ],
    blockedKeywords: [
      // 娱乐噪声
      '演唱会', '明星八卦', '追星', '粉丝', '偶像',
      '彩票', '双色', '大乐透', '开奖',
      '星座', '运势', '塔罗', '占卜',
      // 情感噪声
      '情感', '分手', '复合', '恋爱', '脱单', '相亲', '征婚',
    ],
  },

  // ========== 科技 ==========
  {
    id: 'tech',
    name: '科技',
    description: '科技行业动态、产品发布、商业博弈',
    sourceCategories: ['cn_tech', 'intl_tech'],
    allowedKeywords: [
      // 科技公司
      '苹果', 'Apple', 'iPhone', 'iOS', 'Mac',
      '谷歌', 'Google', 'Android',
      '微软', 'Microsoft', 'Windows', 'Azure',
      '亚马逊', 'AWS', 'Meta', 'Facebook', 'Instagram',
      '特斯拉', 'Tesla', 'SpaceX', '马斯克',
      '华为', '小米', 'OPPO', 'vivo', '荣耀', '一加',
      '阿里', '腾讯', '字节', '百度', '京东', '美团', '拼多多',
      // 产品发布
      '发布会', '发布', '新品', '旗舰', '发布',
      '芯片', '处理器', 'CPU', 'GPU', '屏幕', '摄像头',
      '系统', '更新', '升级', '版本',
      '降价', '涨价', '免费', '收费',
      // 科技行业
      '互联网', '电商', '直播', '短视频', '元宇宙',
      '自动驾驶', '智能驾驶', '新能源汽车', '电动车',
      '5G', '6G', '通信', '网络', '运营商',
      '云计算', '数据中心', '服务器', '芯片制造', '半导体',
      'IPO', '上市', '融资', '并购', '独角兽',
      '财报', '营收', '市值', '股价',
    ],
    blockedKeywords: [
      // 情感/娱乐噪声
      '情感', '分手', '复合', '恋爱', '脱单', '相亲',
      '追星', '偶像', '粉丝', '演唱会', '明星八卦',
      '彩票', '中奖', '双色', '大乐透', '开奖',
      '星座', '运势', '塔罗', '占卜',
      '征婚', '交友', '婚介',
      // 传统行业
      '房地产', '房价', '基金', '期货',
    ],
  },
]

/** 默认话题 ID */
export const DEFAULT_TOPIC = 'ai'

/** 获取话题配置，不存在则抛错 */
export function getTopicConfig(topicId: string): TopicConfig {
  const topic = TOPICS.find((t) => t.id === topicId)
  if (!topic) {
    const available = TOPICS.map((t) => t.id).join(', ')
    throw new Error(`Unknown topic "${topicId}". Available: ${available}`)
  }
  return topic
}

// ---------------------------------------------------------------------------
// RSS 源列表
// ---------------------------------------------------------------------------
export const RSS_SOURCES: RssSource[] = [
  // ========== 中文科技媒体（直连） ==========
  {
    name: '36kr',
    url: 'https://36kr.com/feed',
    category: 'cn_tech',
  },
  {
    name: '少数派',
    url: 'https://sspai.com/feed',
    category: 'cn_tech',
  },
  {
    name: '爱范儿',
    url: 'https://www.ifanr.com/feed',
    category: 'cn_tech',
  },
  {
    name: '钛媒体',
    url: 'https://www.tmtpost.com/rss',
    category: 'cn_tech',
  },
  {
    name: '雷峰网',
    url: 'https://www.leiphone.com/feed',
    category: 'cn_tech',
  },

  // ========== 国际开发者社区（直连） ==========
  {
    name: 'Hacker News',
    url: 'https://hnrss.org/frontpage',
    category: 'intl_dev',
  },
  {
    name: 'Hacker News Best',
    url: 'https://hnrss.org/best',
    category: 'intl_dev',
  },
  {
    name: 'Lobsters',
    url: 'https://lobste.rs/rss',
    category: 'intl_dev',
  },

  // ========== 学术研究（直连） ==========
  {
    name: 'arXiv AI',
    url: 'https://rss.arxiv.org/rss/cs.AI',
    category: 'research',
  },
  {
    name: 'arXiv ML',
    url: 'https://rss.arxiv.org/rss/cs.LG',
    category: 'research',
  },
  {
    name: 'arXiv NLP',
    url: 'https://rss.arxiv.org/rss/cs.CL',
    category: 'research',
  },

  // ========== 国际科技媒体（直连） ==========
  {
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    category: 'intl_tech',
  },
  {
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'intl_tech',
  },
  {
    name: 'Wired',
    url: 'https://www.wired.com/feed/rss',
    category: 'intl_tech',
  },

  // ========== AI 项目博客（需代理） ==========
  {
    name: 'HuggingFace Blog',
    url: 'https://huggingface.co/blog/feed.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'OpenAI Blog',
    url: 'https://openai.com/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'DeepMind Blog',
    url: 'https://deepmind.google/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'Google AI Blog',
    url: 'https://blog.google/technology/ai/rss/',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'Mistral Blog',
    url: 'https://mistral.ai/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'Cohere Blog',
    url: 'https://cohere.com/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'AI21 Blog',
    url: 'https://www.ai21.com/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'LangChain Blog',
    url: 'https://blog.langchain.dev/feed/',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'LlamaIndex Blog',
    url: 'https://docs.llamaindex.ai/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'Ollama Blog',
    url: 'https://ollama.com/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },
  {
    name: 'vLLM Blog',
    url: 'https://vllm.ai/blog/rss.xml',
    category: 'ai_project',
    needsProxy: true,
  },

  // ========== 前端/开发社区（需代理） ==========
  {
    name: 'Smashing Magazine',
    url: 'https://www.smashingmagazine.com/feed/',
    category: 'intl_dev',
    needsProxy: true,
  },
]

// ---------------------------------------------------------------------------
// 内部使用：根据话题配置获取有效的 RSS 源
// ---------------------------------------------------------------------------
export function getSourcesForTopic(topic: TopicConfig): RssSource[] {
  if (!topic.sourceCategories || topic.sourceCategories.length === 0) {
    return RSS_SOURCES
  }
  return RSS_SOURCES.filter((s) => topic.sourceCategories!.includes(s.category))
}

// ---------------------------------------------------------------------------
// 内部使用：构建话题最终的关键词过滤配置
// ---------------------------------------------------------------------------
export interface TopicFilter {
  ALLOWED_KEYWORDS: string[]
  BLOCKED_KEYWORDS: string[]
}

export function getTopicFilter(topic: TopicConfig): TopicFilter {
  return {
    ALLOWED_KEYWORDS: topic.allowedKeywords,
    BLOCKED_KEYWORDS: [...UNIVERSAL_BLOCKED, ...topic.blockedKeywords],
  }
}
