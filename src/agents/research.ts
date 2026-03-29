import { createAgentProvider, type ModelConfig } from '@/lib/ai'
import { BaseAgent } from './base'
import { createWebFetchTool } from '@/tools/web-fetch'
import { createWebSearchTool } from '@/tools/web-search'
import { loadResearchConfig, getResearchModelConfig } from '@/lib/research-config'
import type { ChatResponse } from '@/lib/providers/types'
import type { TopicSuggestion } from './topic'

export interface ResearchResult {
  summary: string
  keyPoints: string[]
  sources: Array<{ title: string; url: string; verified: boolean }>
  rawOutput: string
}

function isConstrainedResearchModel(modelConfig?: ModelConfig): boolean {
  if (!modelConfig) return false
  const model = (modelConfig.defaultModel ?? modelConfig.model ?? '').toLowerCase()
  const baseURL = (modelConfig.baseURL ?? '').toLowerCase()
  return model.includes('minimax') || baseURL.includes('minimaxi.com')
}

const RESEARCHER_PROMPT = [
  '你是一位专业的 AI/科技领域研究员，负责为公众号文章进行深度资料收集和研究。',
  '',
  '## 【强制】第零阶段：研究规划',
  '',
  '在开始任何搜索之前，你必须先在 <thinking> 标签内完成研究规划：',
  '<thinking>',
  '1. 列出 6-8 个搜索维度，至少覆盖以下方向：',
  '   - 背景与基础事实',
  '   - 市场规模与增长数据',
  '   - 头部公司与产品案例',
  '   - 创始人/专家观点与访谈',
  '   - 市场争议与反对声音',
  '   - 趋势预测与未来展望',
  '2. 为每个维度设计 1-2 个具体的搜索词（中英文均可）',
  '3. 确定优先级顺序后再开始执行搜索',
  '</thinking>',
  '',
  '## 【强制】三阶段搜索执行流程',
  '',
  '【第一阶段：广度搜索 - 必须完成 10-12 次搜索】',
  '使用 web_search 工具执行至少 10 次搜索，强制覆盖以下维度：',
  '- 基础事实搜索 x2：话题定义、发展历程、当前状态',
  '- 市场规模数据 x3：行业报告、市场分析、融资投资数据（2025-2026）',
  '- 真实公司案例 x3：头部公司产品、具体参数、竞品对比',
  '- 专家/创始人引用 x2：专家访谈、创始人观点、行业领袖发言',
  '- 争议或反驳观点 x2：批评声音、风险分析、反面案例',
  '',
  '搜索词示例（根据规划阶段的设计执行）：',
  '1. "话题 + 定义 + 发展 + 2025 2026"',
  '2. "话题 + 最新进展 + 数据 + 2025 2026"',
  '3. "话题 + 行业报告 + 市场规模 + 2025"',
  '4. "话题 + 融资 + 投资 + 估值 + 2025 2026"',
  '5. "话题 + market size + growth + 2025"',
  '6. "话题 + 公司 + 产品 + 参数 + 2025"',
  '7. "话题 + 竞品 + 对比 + 2025"',
  '8. "话题 + 案例 + 落地应用 + 2025"',
  '9. "话题 + 创始人 + 观点 + 访谈 + 2025"',
  '10. "话题 + expert opinion + interview + 2025"',
  '11. "话题 + 争议 + 批评 + 风险 + 2025"',
  '12. "话题 + 中国 + 市场 + 应用 + 2025"',
  '',
  '【第二阶段：深度抓取 - 必须完成】',
  '从第一阶段搜索结果中选择最相关的 5-6 篇，使用 web_fetch 完整抓取：',
  '- 优先选择36氪、虎嗅、钛媒体、极客公园、第一财经、TechCrunch、The Verge 等高质量来源',
  '- 每篇抓取后提取：具体数据、公司信息、专家观点、争议论据',
  '',
  '【第三阶段：查漏补缺】',
  '完成前两阶段后，对照输出格式要求检查是否有维度数据不足，如有则针对性补充搜索。',
  '',
  '【数据收集最低要求 - 不满足则研究失败】',
  '- 至少 5 个不同公司的具体信息（公司名 + 产品名 + 关键参数/数据）',
  '- 至少 8 个带具体数字的数据点（融资额/市场规模/增长率/用户数等）',
  '- 至少 3 条可引用的专家/创始人原话（附来源链接）',
  '- 至少 2 条争议或反驳观点（附数据或论据支撑）',
  '',
  '## 【强制】数据溯源格式',
  '',
  '每个数据点必须严格按以下格式输出，否则视为无效：',
  '',
  '【已验证数据】数据内容 - [来源网站名] [URL] [已验证]',
  '【待验证数据】数据内容 - [来源网站名] [URL] [待验证]',
  '',
  '【溯源禁止】',
  '- 禁止"据报道""数据显示""据悉"等模糊表述（无来源）',
  '- 禁止"网络消息""知情人士透露"（无法验证）',
  '- 禁止只写"网络"或"公开资料"作为来源',
  '- 所有百分比/金额/用户数必须标注来源',
  '- 禁止捏造具体数字（无来源的数字一律禁止）',
  '',
  '## 【强制】数据质量过滤规则',
  '',
  '【必须淘汰的内容】',
  '- 无具体公司的泛泛而谈（如"AI发展迅速"）',
  '- 无具体数字的描述（如"市场份额很大"）',
  '- 无来源的推测（如"预计将大幅增长"但无数据）',
  '- "据知情人士透露"类无法验证的信息',
  '- 只提及公司名但无产品/参数/数据的条目',
  '',
  '【必须保留的内容】',
  '- 有具体公司名 + 具体产品名 + 具体参数',
  '- 有具体融资额/估值/市场规模（带亿/万/百分比）',
  '- 有具体用户数/增长率/时间节点',
  '- 有创始人/专家原话引用（附链接）',
  '',
  '## 【强制】最终输出格式（严格按此结构输出）',
  '',
  '请按以下 Markdown 结构组织最终报告，禁止自由发挥格式：',
  '',
  '## 核心论点',
  '（3-5条，每条一句话，必须是观点而非描述，带数据支撑）',
  '- [观点1]（数据：[具体数字] - [来源]）',
  '- [观点2]（数据：[具体数字] - [来源]）',
  '...',
  '',
  '## 关键数据',
  '（至少8条，每条格式如下）',
  '- [数字+单位] -- [来源机构/媒体] -- [URL]',
  '...',
  '',
  '## 真实案例',
  '（至少3个，格式如下）',
  '### 【公司/产品名】',
  '- 具体事件：[描述]',
  '- 结果数据：[具体数字]',
  '- 来源：[网站名] [URL]',
  '...',
  '',
  '## 专家与创始人观点',
  '（至少3条，格式如下）',
  '- [人名]（[职位/公司]）："原话引用" -- [来源URL]',
  '...',
  '',
  '## 争议与反驳',
  '（至少2条，格式如下）',
  '- 观点：[对立观点]',
  '  理由：[论据]',
  '  数据：[支撑数据] -- [来源]',
  '...',
  '',
  '## 写作角度建议',
  '（2-3个不同角度，每个角度给出一句话的"文章核心主张"）',
  '1. 角度：[角度名] -- 核心主张："[一句话]"',
  '2. 角度：[角度名] -- 核心主张："[一句话]"',
  '...',
  '',
  '## 数据来源清单',
  '1. [网站名] [URL] [已验证/待验证]',
  '2. [网站名] [URL] [已验证/待验证]',
  '...（所有使用过的来源）',
  '',
  '## 【强制】末尾自检',
  '',
  '在输出正式结构化内容前，你必须先做数量统计自检，输出如下一行：',
  '数据自检：关键数据X条（要求>=8）/ 真实案例X个（要求>=3）/ 专家观点X条（要求>=3）/ 争议X条（要求>=2）',
  '如果任何一项数量不足，你必须继续补充搜索，直到满足要求后再输出最终结构化内容。',
  '',
  '【重要】最终输出中不得包含任何无来源的数据。每一句带数据的句子都必须有对应的来源标注。',
].join('\n')

const RESEARCHER_PROMPT_CONSTRAINED = [
  '你是一位专业的 AI/科技领域研究员，负责为公众号文章提供够用、可追溯的研究资料。',
  '',
  '你的目标不是穷尽一切信息，而是在有限步骤内产出可写稿、可溯源的研究结果。',
  '',
  '## 执行流程',
  '1. 先快速规划 4-5 个搜索维度。',
  '2. 执行 5-6 次精准搜索，优先查：基础事实、行业数据、真实公司案例、专家观点、争议点。',
  '3. 从结果中抓取 3-4 篇最相关的文章进行深读。',
  '4. 资料足够就立即收束输出，不要为了凑数量继续搜索。',
  '',
  '## 最低交付要求',
  '- 至少 5 条带具体数字的数据点',
  '- 至少 2 个真实公司/产品案例',
  '- 至少 2 条专家或创始人观点',
  '- 至少 1 条争议或反驳观点',
  '- 所有数据都要带来源 URL',
  '',
  '## 输出结构',
  '## 核心论点',
  '## 关键数据',
  '## 对比数据',
  '## 真实案例',
  '## 专家与创始人观点',
  '## 争议与反驳',
  '## 写作角度建议',
  '## 数据来源清单',
].join('\n')

function extractRawText(response: ChatResponse): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
}

function buildConstrainedSearchQueries(topic: TopicSuggestion): string[] {
  const seedEntity = topic.sources[0]?.title?.replace(/[：:|｜].*$/, '').trim() ?? topic.title
  const category = inferResearchTopicCategory(topic)
  const aliases = buildTopicEntityAliases(topic)

  const commonQueries = [
    topic.title,
    `${seedEntity} 数据 用户 增长 2025 2026`,
    `${seedEntity} 采访 观点 智能体 2026`,
    `${topic.angle} 市场 数据 争议`,
    `${seedEntity} 竞品 对比 参数 评测 2025 2026`,
    `${seedEntity} benchmark MMLU TOPS 对比`,
    `${seedEntity} site:github.com OR site:arxiv.org OR site:openai.com`,
    `${seedEntity} 官方 博客 文档 发布 论文`,
  ]

  const categoryQueries: Record<ResearchTopicCategory, string[]> = {
    'voice-agent': [
      `${seedEntity} EVA benchmark site:huggingface.co OR site:huggingface.com OR site:servicenow.com`,
      `${seedEntity} speech benchmark latency wer evaluation 2025 2026`,
      `${aliases[0] ?? seedEntity} site:arxiv.org voice agent evaluation`,
      `${aliases[0] ?? seedEntity} site:github.com benchmark dataset`,
    ],
    robotics: [
      `${seedEntity} benchmark success rate deployment factory warehouse 2025 2026`,
      `${seedEntity} site:arxiv.org robot benchmark policy manipulation`,
      `${aliases[0] ?? seedEntity} site:github.com robot benchmark dataset`,
      `${aliases[0] ?? seedEntity} 官方 演示 部署 客户 案例`,
    ],
    'platform-policy': [
      `${seedEntity} terms privacy policy opt-out docs`,
      `${seedEntity} site:docs.github.com OR site:github.blog policy settings training`,
      `${aliases[0] ?? seedEntity} Hacker News discussion developer backlash`,
      `${aliases[0] ?? seedEntity} 官方 博客 文档 设置 页面`,
    ],
    chips: [
      `${seedEntity} TOPS perf watt rack x86 gpu benchmark 2025 2026`,
      `${seedEntity} site:arm.com OR site:nvidia.com OR site:developer.nvidia.com benchmark`,
      `${aliases[0] ?? seedEntity} site:arxiv.org inference throughput latency`,
      `${aliases[0] ?? seedEntity} 官方 博客 数据中心 性能 功耗`,
    ],
    'general-ai': [
      `${seedEntity} site:arxiv.org benchmark evaluation 2025 2026`,
      `${aliases[0] ?? seedEntity} site:github.com benchmark dataset`,
      `${aliases[0] ?? seedEntity} 官方 博客 文档 发布`,
    ],
  }

  return [...new Set([...commonQueries, ...categoryQueries[category]])]
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/g) ?? []
  return [...new Set(matches)]
}

function extractSourceName(title: string): string {
  const match = title.match(/(GitHub|OpenAI|微软|Meta|阿里|腾讯|Google|Arm|英伟达|Anthropic|苹果|小米)/i)
  return match?.[1] ?? (title.replace(/[：:，,].*$/, '').trim() || '案例')
}

type ResearchTopicCategory = 'voice-agent' | 'robotics' | 'platform-policy' | 'chips' | 'general-ai'

function inferResearchTopicCategory(topic: TopicSuggestion): ResearchTopicCategory {
  const text = `${topic.title} ${topic.angle} ${topic.summary} ${topic.tags.join(' ')} ${topic.sources.map((s) => s.title).join(' ')}`
  if (/语音|voice|audio|whisper|TTS|ASR|语音助手|语音agent/i.test(text)) return 'voice-agent'
  if (/机器人|robot|embodied|具身|机械臂|humanoid/i.test(text)) return 'robotics'
  if (/github|copilot|隐私|默认|协议|训练|repo|仓库|平台规则|权限/i.test(text)) return 'platform-policy'
  if (/arm|英伟达|nvidia|芯片|算力|tops|gpu|cpu|推理卡|数据中心/i.test(text)) return 'chips'
  return 'general-ai'
}

function buildTopicEntityAliases(topic: TopicSuggestion): string[] {
  const seeds = [
    topic.title,
    topic.angle,
    ...topic.tags,
    ...topic.sources.map((source) => source.title),
  ]

  const aliases = new Set<string>()
  for (const seed of seeds) {
    const cleaned = seed
      .replace(/[：:|｜].*$/, '')
      .replace(/["“”‘’「」]/g, '')
      .trim()
    if (!cleaned) continue
    const match = cleaned.match(/(GitHub|Copilot|OpenAI|Anthropic|Claude|Arm|NVIDIA|英伟达|Whisper|ElevenLabs|Gemini|ServiceNow|HuggingFace|EVA|机器人|语音Agent|语音助手)/ig)
    if (match) {
      for (const item of match) aliases.add(item.trim())
    }
    if (cleaned.length >= 2 && cleaned.length <= 32) aliases.add(cleaned)
  }

  return [...aliases].slice(0, 6)
}

function isTrustedEvidenceUrl(topic: TopicSuggestion, url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    const path = new URL(url).pathname.toLowerCase()
    const sourceHosts = topic.sources
      .map((source) => {
        try {
          return new URL(source.url).hostname.toLowerCase()
        } catch {
          return ''
        }
      })
      .filter(Boolean)

    const trustedHosts = new Set([
      ...sourceHosts,
      '36kr.com',
      'www.36kr.com',
      'leiphone.com',
      'www.leiphone.com',
      'ifanr.com',
      'www.ifanr.com',
      'github.com',
      'arxiv.org',
      'techcrunch.com',
      'www.techcrunch.com',
      'theverge.com',
      'www.theverge.com',
      'openai.com',
      'www.openai.com',
      'deepmind.google',
      'blog.google',
      'economist.com',
      'www.economist.com',
    ])

    if (hostname.includes('forum.') || path.includes('/thread/')) return false
    if ([...trustedHosts].some((trusted) => hostname === trusted || hostname.endsWith(`.${trusted}`))) return true
    return false
  } catch {
    return false
  }
}

function isSpecificEvidenceUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const path = parsed.pathname

    if (!hostname) return false
    if (!path || path === '/' || path === '') return false
    if (/^\/?(search|tag|tags|categories|category|feed|rss)\/?$/i.test(path)) return false
    if (/^\/?(index(\.html?)?)?$/i.test(path)) return false
    return true
  } catch {
    return false
  }
}

interface EvidenceFact {
  text: string
  url: string
  sourceTitle: string
  entity: string
  confidence: 'A' | 'B' | 'C'
}

interface SourceRecord {
  title: string
  url: string
  host: string
}

function hasApproximateLanguage(text: string): boolean {
  return /超过|超|近|约|约为|大约|左右|数月|数小时|数天|上百|上千|多家|数十|几十|几百|几千/.test(text)
}

function stripToolArtifacts(text: string): string {
  return text
    .replace(/<tool_code>[\s\S]*?<\/tool_code>/g, '')
    .replace(/^让我[^\n]*$/gm, '')
    .replace(/^## 第一步：[^\n]*$/gm, '')
    .replace(/^## 已知来源$/gm, '')
    .replace(/^\s+$/gm, '')
    .trim()
}

function splitEvidenceSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/[\n。！？!?]/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 18 && line.length <= 160)
}

function scoreEvidenceSentence(sentence: string): number {
  let score = 0
  if (/\d/.test(sentence)) score += 3
  if (/%|％|亿美元|亿元|万人|万家|百万|千万|亿|万|季度|同比|环比|年增|月活|用户|开发者|调用|成本|收入|融资|估值/.test(sentence)) score += 3
  if (/[A-Za-z]{2,}/.test(sentence)) score += 1
  if (/(GitHub|OpenAI|微软|Meta|Google|阿里|腾讯|字节|Anthropic|英伟达|苹果|小米|Copilot|Claude|GPT)/i.test(sentence)) score += 2
  if (/待补充|来源待补充|点击|责任编辑|相关阅读|本文来自|继续浏览|<meta|<img|<script|charset=|og:|weibo:|http-equiv|content=/.test(sentence)) score -= 8
  if (/\d/.test(sentence) && !hasApproximateLanguage(sentence)) score += 2
  return score
}

function buildEvidenceFacts(
  topic: TopicSuggestion,
  searchOutputs: string[],
  fetchedPages: string[],
): EvidenceFact[] {
  const sourceMap = new Map(topic.sources.map((source) => [source.url, source.title]))
  const facts: EvidenceFact[] = []
  const seen = new Set<string>()

  for (const block of [...fetchedPages, ...searchOutputs]) {
    const urlMatch = block.match(/https?:\/\/[^\s)]+/)
    const url = urlMatch?.[0]
    if (!url) continue
    if (!isTrustedEvidenceUrl(topic, url)) continue
    if (!isSpecificEvidenceUrl(url)) continue

    const sourceTitle = sourceMap.get(url) ?? topic.sources.find((source) => source.url === url)?.title ?? '搜索结果'
    const entity = extractSourceName(sourceTitle)
    const cleanedBlock = stripToolArtifacts(block)

    for (const sentence of splitEvidenceSentences(cleanedBlock)) {
      const normalized = sentence.replace(/^[-•]\s*/, '').trim()
      if (seen.has(normalized)) continue
      if (/[<>]/.test(normalized)) continue
      if (scoreEvidenceSentence(normalized) < 5) continue

      seen.add(normalized)
      facts.push({
        text: normalized,
        url,
        sourceTitle,
        entity,
        confidence: getEvidenceConfidence(url, normalized),
      })
    }
  }

  return facts.slice(0, 10)
}

function getHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function sourcePriority(host: string): number {
  if (!host) return 0
  if (/github\.com$|arxiv\.org$|openai\.com$|deepmind\.google$|blog\.google$|huggingface\.co$|huggingface\.com$|servicenow\.com$|developer\.nvidia\.com$|nvidia\.com$|arm\.com$/.test(host)) return 5
  if (/docs\.|developer\.|research\./.test(host)) return 4
  if (/ifanr\.com$|leiphone\.com$|36kr\.com$|techcrunch\.com$|theverge\.com$|economist\.com$/.test(host)) return 2
  return 1
}

function getEvidenceConfidence(url: string, text: string): 'A' | 'B' | 'C' {
  const host = getHost(url)
  if (!host) return 'C'
  if (/github\.com$|arxiv\.org$|openai\.com$|deepmind\.google$|blog\.google$|huggingface\.co$|huggingface\.com$|servicenow\.com$|developer\.nvidia\.com$|nvidia\.com$|arm\.com$/.test(host)) return 'A'
  if (/docs\.|developer\.|research\./.test(host)) return 'A'
  if (/ifanr\.com$|leiphone\.com$|36kr\.com$|techcrunch\.com$|theverge\.com$|economist\.com$/.test(host)) {
    return /\d/.test(text) && !hasApproximateLanguage(text) ? 'B' : 'C'
  }
  return 'C'
}

function buildSourceRecords(
  topic: TopicSuggestion,
  searchOutputs: string[],
  fetchedPages: string[],
): SourceRecord[] {
  const records = new Map<string, SourceRecord>()

  for (const source of topic.sources) {
    const host = getHost(source.url)
    if (!host) continue
    records.set(source.url, { title: source.title, url: source.url, host })
  }

  for (const block of [...searchOutputs, ...fetchedPages]) {
    const urls = extractUrls(block)
    const titleLine = block.split('\n').find((line) => /^###\s+/.test(line))?.replace(/^###\s+/, '').trim() ?? '搜索结果'

    for (const url of urls) {
      if (!isTrustedEvidenceUrl(topic, url)) continue
      if (!isSpecificEvidenceUrl(url)) continue
      const host = getHost(url)
      if (!host || records.has(url)) continue
      records.set(url, { title: titleLine, url, host })
    }
  }

  return [...records.values()]
    .sort((a, b) => sourcePriority(b.host) - sourcePriority(a.host))
}

function selectDiverseSourceRecords(records: SourceRecord[], maxCount: number): SourceRecord[] {
  const selected: SourceRecord[] = []
  const seenHosts = new Set<string>()

  for (const record of records) {
    if (!seenHosts.has(record.host)) {
      selected.push(record)
      seenHosts.add(record.host)
    }
    if (selected.length >= maxCount) return selected
  }

  for (const record of records) {
    if (selected.some((item) => item.url === record.url)) continue
    selected.push(record)
    if (selected.length >= maxCount) return selected
  }

  return selected
}

function buildKeyDataLines(facts: EvidenceFact[]): string[] {
  return facts
    .filter((fact) => fact.confidence !== 'C')
    .map((fact) => `- [${fact.confidence}] ${fact.text} -- ${fact.sourceTitle} -- ${fact.url}`)
}

function buildComparisonLines(facts: EvidenceFact[]): string[] {
  const ranked = facts
    .filter((fact) => fact.confidence !== 'C')
    .filter((fact) => /\d/.test(fact.text))
    .filter((fact) => /相比|对比|高于|低于|优于|落后|提升|下降|增长|vs|对照|接近|差距|制程|TOPS|MMLU|跑分|评测/i.test(fact.text))
    .sort((a, b) => scoreEvidenceSentence(b.text) - scoreEvidenceSentence(a.text))

  return [...new Set(ranked.map((fact) => `- [${fact.confidence}] ${fact.text} -- ${fact.sourceTitle} -- ${fact.url}`))].slice(0, 5)
}

function buildPreciseDataLines(facts: EvidenceFact[]): string[] {
  return facts
    .filter((fact) => fact.confidence !== 'C')
    .filter((fact) => /\d/.test(fact.text) && !hasApproximateLanguage(fact.text))
    .slice(0, 5)
    .map((fact) => `- [${fact.confidence}] ${fact.text} -- ${fact.sourceTitle} -- ${fact.url}`)
}

function buildCaseSection(facts: EvidenceFact[]): string {
  const grouped = new Map<string, EvidenceFact[]>()
  for (const fact of facts) {
    const bucket = grouped.get(fact.entity) ?? []
    bucket.push(fact)
    grouped.set(fact.entity, bucket)
  }

  return [...grouped.entries()]
    .slice(0, 3)
    .map(([entity, entries]) => {
      const primary = entries[0]
      const resultFact = entries.find((entry) => /\d/.test(entry.text)) ?? entries[0]
      return [
        `### 【${entity}】`,
        `- 具体事件：${primary?.text ?? primary?.sourceTitle ?? entity}`,
        `- 结果数据：${resultFact?.text ?? primary?.text ?? '来源已定位'}`,
        `- 来源：${primary?.sourceTitle ?? entity} ${primary?.url ?? ''}`,
      ].join('\n')
    })
    .join('\n\n')
}

function extractExpertLines(facts: EvidenceFact[]): string[] {
  return facts
    .filter((fact) => /表示|认为|称|指出|强调|说|提出/.test(fact.text))
    .slice(0, 3)
    .map((fact) => `- ${fact.entity}相关表述：${fact.text} -- ${fact.url}`)
}

function ensureConstrainedResearchOutput(
  topic: TopicSuggestion,
  rawOutput: string,
  facts: EvidenceFact[],
  sourceRecords: SourceRecord[],
): string {
  let output = stripToolArtifacts(rawOutput)
  const keyDataLines = buildKeyDataLines(facts)
  const comparisonLines = buildComparisonLines(facts)
  const preciseDataLines = buildPreciseDataLines(facts)
  const caseSection = buildCaseSection(facts)
  const expertLines = extractExpertLines(facts)

  if (!/##\s+核心论点/.test(output)) {
    output = [
      '## 核心论点',
      `- ${topic.angle}（数据：来源待补充 - ${topic.sources[0]?.title ?? '原始来源'}）`,
      '',
      output,
    ].join('\n')
  }

  if (!/##\s+关键数据/.test(output)) {
    output += `\n\n## 关键数据\n${keyDataLines.join('\n')}`
  }

  if (!/##\s+对比数据/.test(output) && comparisonLines.length > 0) {
    output += `\n\n## 对比数据\n${comparisonLines.join('\n')}`
  }

  if (!/##\s+真实案例/.test(output)) {
    output += `\n\n## 真实案例\n${caseSection}`
  }

  if (!/##\s+精确数据锚点/.test(output) && preciseDataLines.length > 0) {
    output += `\n\n## 精确数据锚点\n${preciseDataLines.join('\n')}`
  }

  if (!/##\s+专家与创始人观点/.test(output)) {
    output += `\n\n## 专家与创始人观点\n${expertLines.join('\n') || `- 待补充专家观点 -- ${topic.sources[0]?.url ?? ''}`}`
  }

  if (!/##\s+争议与反驳/.test(output)) {
    output += `\n\n## 争议与反驳\n- 观点：平台规则与开发者权益之间存在冲突\n  理由：默认授权会放大信息不对称\n  数据：待补充 -- ${topic.sources[0]?.title ?? '原始来源'}`
  }

  if (!/##\s+写作角度建议/.test(output)) {
    output += `\n\n## 写作角度建议\n1. 角度：平台规则变化 -- 核心主张："${topic.angle}"`
  }

  if (!/##\s+数据来源清单/.test(output)) {
    const sourceList = selectDiverseSourceRecords(sourceRecords, 6)
      .map((source, index) => `${index + 1}. ${source.title} ${source.url} [已定位:${source.host}]`)
      .join('\n')
    output += `\n\n## 数据来源清单\n${sourceList}`
  }

  const dataSectionMatch = output.match(/##\s+关键数据\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const currentDataLines = dataSectionMatch?.[1]?.split('\n').filter((line) => /^\s*-\s+/.test(line)) ?? []
  const goodDataLines = currentDataLines.filter(
    (line) => /\d/.test(line) && !/待补充|来源待补充|<meta|charset=|og:|weibo:|content=/.test(line),
  )
  if (goodDataLines.length < 5) {
    const extraData = keyDataLines
      .filter((line) => !goodDataLines.includes(line))
      .slice(0, 5 - goodDataLines.length)
      .join('\n')
    output = output.replace(
      /##\s+关键数据\s*\n([\s\S]*?)(?=\n##\s|$)/,
      () => `## 关键数据\n${[...goodDataLines, extraData].filter(Boolean).join('\n')}`.trimEnd(),
    )
  }

  if (preciseDataLines.length > 0) {
    output = output.replace(
      /##\s+精确数据锚点\s*\n([\s\S]*?)(?=\n##\s|$)/,
      () => `## 精确数据锚点\n${preciseDataLines.join('\n')}`.trimEnd(),
    )
  }

  if (comparisonLines.length > 0) {
    if (/##\s+对比数据/.test(output)) {
      output = output.replace(
        /##\s+对比数据\s*\n([\s\S]*?)(?=\n##\s|$)/,
        () => `## 对比数据\n${comparisonLines.join('\n')}`.trimEnd(),
      )
    } else {
      output += `\n\n## 对比数据\n${comparisonLines.join('\n')}`
    }
  }

  output = output.replace(/-\s*待补充关键数据[^\n]*/g, '').replace(/\n{3,}/g, '\n\n')

  const caseCount = (output.match(/###\s*【[^】]+】/g) ?? []).length
  if (caseCount < 2) {
    output = output.replace(
      /##\s+真实案例\s*\n([\s\S]*?)(?=\n##\s|$)/,
      () => `## 真实案例\n${caseSection}`.trimEnd(),
    )
  }

  return output.trim()
}

async function runConstrainedResearchAgent(
  topic: TopicSuggestion,
  provider: ReturnType<typeof createAgentProvider>,
  fetchTool: ReturnType<typeof createWebFetchTool>,
  searchTool: ReturnType<typeof createWebSearchTool>,
): Promise<ResearchResult> {
  const searchQueries = buildConstrainedSearchQueries(topic)
  const searchOutputs: string[] = []

  for (const query of searchQueries) {
    const result = await searchTool.execute({ query, maxResults: 3 })
    if (result.success && result.output) {
      searchOutputs.push(`### 搜索词: ${query}\n${result.output}`)
    }
  }

  const fetchedPages: string[] = []
  const candidateUrls = [
    ...topic.sources.map((source) => source.url),
    ...searchOutputs.flatMap(extractUrls),
  ]

  const prioritizedUrls = [...new Set(candidateUrls)]
    .filter((candidate) => isTrustedEvidenceUrl(topic, candidate))
    .filter((candidate) => isSpecificEvidenceUrl(candidate))
    .sort((a, b) => sourcePriority(getHost(b)) - sourcePriority(getHost(a)))

  const selectedUrls: string[] = []
  const seenHosts = new Set<string>()
  for (const url of prioritizedUrls) {
    const host = getHost(url)
    if (!host) continue
    if (!seenHosts.has(host) || selectedUrls.length < 3) {
      selectedUrls.push(url)
      seenHosts.add(host)
    }
    if (selectedUrls.length >= 6) break
  }

  for (const url of selectedUrls) {
    const result = await fetchTool.execute({ url, maxLength: 2500 })
    if (result.success && result.output) {
      fetchedPages.push(`### 抓取页面: ${url}\n${result.output}`)
    }
  }

  let facts = buildEvidenceFacts(topic, searchOutputs, fetchedPages)
  let sourceRecords = buildSourceRecords(topic, searchOutputs, fetchedPages)

  if (facts.filter((fact) => fact.confidence !== 'C' && /\d/.test(fact.text)).length < 5) {
    const category = inferResearchTopicCategory(topic)
    const aliases = buildTopicEntityAliases(topic)
    const fallbackQueriesByCategory: Record<ResearchTopicCategory, string[]> = {
      'voice-agent': [
        `${aliases[0] ?? topic.title} official benchmark docs`,
        `${aliases[0] ?? topic.title} site:huggingface.co evaluation benchmark`,
      ],
      robotics: [
        `${aliases[0] ?? topic.title} official deployment benchmark`,
        `${aliases[0] ?? topic.title} site:arxiv.org manipulation benchmark`,
      ],
      'platform-policy': [
        `${aliases[0] ?? topic.title} official docs privacy settings`,
        `${aliases[0] ?? topic.title} site:github.blog OR site:docs.github.com policy`,
      ],
      chips: [
        `${aliases[0] ?? topic.title} official perf watt benchmark`,
        `${aliases[0] ?? topic.title} site:arm.com OR site:nvidia.com datasheet performance`,
      ],
      'general-ai': [
        `${aliases[0] ?? topic.title} official benchmark docs`,
        `${aliases[0] ?? topic.title} site:arxiv.org benchmark evaluation`,
      ],
    }

    for (const query of fallbackQueriesByCategory[category]) {
      const result = await searchTool.execute({ query, maxResults: 3 })
      if (result.success && result.output) {
        searchOutputs.push(`### 补充搜索: ${query}\n${result.output}`)
      }
    }

    const extraUrls = [...new Set(searchOutputs.flatMap(extractUrls))]
      .filter((candidate) => isTrustedEvidenceUrl(topic, candidate))
      .filter((candidate) => isSpecificEvidenceUrl(candidate))
      .sort((a, b) => sourcePriority(getHost(b)) - sourcePriority(getHost(a)))
      .slice(0, 4)

    for (const url of extraUrls) {
      if (selectedUrls.includes(url)) continue
      const result = await fetchTool.execute({ url, maxLength: 3000 })
      if (result.success && result.output) {
        fetchedPages.push(`### 补充抓取: ${url}\n${result.output}`)
      }
    }

    facts = buildEvidenceFacts(topic, searchOutputs, fetchedPages)
    sourceRecords = buildSourceRecords(topic, searchOutputs, fetchedPages)
  }

  const evidenceBundle = [
    '## 已知来源',
    ...topic.sources.map((source) => `- ${source.title} -- ${source.url}`),
    '',
    '## 搜索结果',
    ...searchOutputs,
    '',
    '## 页面抓取',
    ...fetchedPages,
  ].join('\n')

  const response = await provider.chat(
    [
      {
        role: 'user',
        content: [
          `请基于以下证据包整理一份可写稿的研究结果。`,
          '',
          `标题：${topic.title}`,
          `角度：${topic.angle}`,
          `摘要：${topic.summary}`,
          '',
          '要求：',
          '- 输出必须包含：核心论点、关键数据、真实案例、专家与创始人观点、争议与反驳、写作角度建议、数据来源清单',
          '- 关键数据至少 4 条，每条必须是 "- 文本 -- 来源 -- URL" 格式',
          '- 如果证据包里有对比/提升/benchmark/竞品信息，必须单独整理成 "## 对比数据" 小节',
          '- 真实案例至少 2 个，每个案例必须用 "### 【公司/平台名】" 开头',
          '- 如果数据不完整，可以明确写“待补充（已定位来源）”，但不要捏造',
          '',
          evidenceBundle,
        ].join('\n'),
      },
    ],
    {
      temperature: 0.2,
      maxTokens: 8000,
      systemPrompt: RESEARCHER_PROMPT_CONSTRAINED,
    },
  )

  const rawOutput = ensureConstrainedResearchOutput(topic, extractRawText(response), facts, sourceRecords)
  const verifiedSources = verifySources(rawOutput, topic.sources)

  return {
    summary: rawOutput.slice(0, 2000),
    keyPoints: extractKeyPoints(rawOutput),
    sources: verifiedSources,
    rawOutput,
  }
}

export async function runResearchAgent(
  topic: TopicSuggestion,
  modelConfig?: ModelConfig,
  agentConfig?: Partial<import('@/lib/research-config').ResearchAgentAgentConfig>,
): Promise<ResearchResult> {
  const cfg = loadResearchConfig()
  const resolvedModelConfig = modelConfig ?? getResearchModelConfig()
  const constrainedModel = isConstrainedResearchModel(resolvedModelConfig)

  const mergedAgentConfig = {
    ...cfg.agent,
    ...agentConfig,
    ...(constrainedModel
      ? {
          maxSteps: Math.min(agentConfig?.maxSteps ?? cfg.agent.maxSteps, 36),
          maxTokens: Math.min(agentConfig?.maxTokens ?? cfg.agent.maxTokens, 12000),
          searchRetry: Math.min(agentConfig?.searchRetry ?? cfg.agent.searchRetry, 2),
          fetchRetry: Math.min(agentConfig?.fetchRetry ?? cfg.agent.fetchRetry, 2),
        }
      : {}),
  }

  const provider = createAgentProvider('research', resolvedModelConfig)
  const fetchTool = createWebFetchTool({ maxRetries: mergedAgentConfig.fetchRetry })
  const searchTool = createWebSearchTool({ maxRetries: mergedAgentConfig.searchRetry })

  if (constrainedModel) {
    return runConstrainedResearchAgent(topic, provider, fetchTool, searchTool)
  }

  const agent = new BaseAgent(provider, { maxSteps: mergedAgentConfig.maxSteps })
  agent.registerTool(fetchTool)
  agent.registerTool(searchTool)

  const knownSources = topic.sources
    .map((s) => '- ' + s.title + '：' + s.url)
    .join('\n')

  const task = [
    constrainedModel
      ? '请对以下话题进行轻量但可写的深度研究，优先收集关键事实、数字、案例和争议，确保在有限步骤内收束。'
      : '请对以下话题进行深度研究，收集足够的资料用于写一篇 2000-2800 字的微信公众号文章。',
    '',
    '## 话题',
    '标题：' + topic.title,
    '角度：' + topic.angle,
    '摘要：' + topic.summary,
    '',
    '## 已知来源（必须访问并提取数据）',
    knownSources,
    '',
    '## 研究执行要求',
    '',
    constrainedModel
      ? '【第零阶段】研究规划：先在 <thinking> 中列出 4-5 个搜索维度和具体搜索词，优先抓最关键的信息。'
      : '【第零阶段】研究规划：先在 <thinking> 中列出 6-8 个搜索维度和具体搜索词，确定优先级后再开始。',
    '',
    constrainedModel
      ? '【第一阶段】广度搜索：使用 web_search 执行 5-6 次精准搜索，至少覆盖基础事实、行业数据、真实案例、专家观点、争议点。'
      : '【第一阶段】广度搜索：使用 web_search 执行至少 10-12 次搜索，强制覆盖：基础事实x2 + 市场规模数据x3 + 真实公司案例x3 + 专家/创始人引用x2 + 争议或反驳观点x2。',
    '',
    constrainedModel
      ? '【第二阶段】深度抓取：从搜索结果中选择 3-4 篇最相关的深度文章，使用 web_fetch 抓取，重点提取公司名、数据、观点和争议。'
      : '【第二阶段】深度抓取：从搜索结果中选择 5-6 篇最相关的深度文章，使用 web_fetch 完整抓取，重点提取具体公司名、产品参数、融资数据、专家原话、争议论据。',
    '',
    constrainedModel
      ? '【第三阶段】查漏补缺：如果关键数字、案例、观点、争议任一缺失，再做 1-2 次补充搜索，否则直接输出。'
      : '【第三阶段】查漏补缺：对照输出要求自检，数据不足的维度继续针对性补充搜索。',
    '',
    '## 数据质量要求',
    '',
    '【禁止输出】',
    '- 无具体公司名的泛泛而谈',
    '- 无具体数字的描述（如"大幅增长"需改为"增长47%"）',
    '- 无来源的"据报道""据悉"',
    '- 无法验证的"知情人士透露"',
    '',
    '【必须输出】',
    '- 具体公司名 + 产品名 + 关键参数',
    '- 具体融资额/估值/市场规模（单位：亿/万/美元）',
    '- 具体时间节点（年份/季度）',
    '- 专家/创始人原话（附来源链接）',
    '',
    '## 输出格式要求',
    '',
    '严格按 system prompt 中的 Markdown 结构输出，包含以下必要章节：',
    constrainedModel
      ? '- ## 核心论点（3条以内，观点必须明确）'
      : '- ## 核心论点（3-5条观点，带数据支撑）',
    constrainedModel
      ? '- ## 关键数据（至少5条，每条：数字+单位 -- 来源 -- URL）'
      : '- ## 关键数据（至少8条，每条：数字+单位 -- 来源 -- URL）',
    '- ## 对比数据（优先收集竞品对比、增速对比、benchmark 对比、参数提升对比）',
    constrainedModel
      ? '- ## 真实案例（至少2个，公司名+事件+结果数据+来源）'
      : '- ## 真实案例（至少3个，公司名+事件+结果数据+来源）',
    constrainedModel
      ? '- ## 专家与创始人观点（至少2条，人名+职位+原话+来源URL）'
      : '- ## 专家与创始人观点（至少3条，人名+职位+原话+来源URL）',
    constrainedModel
      ? '- ## 争议与反驳（至少1条，对立观点+理由+数据）'
      : '- ## 争议与反驳（至少2条，对立观点+理由+数据）',
    '- ## 写作角度建议（2-3个角度，每个给出核心主张）',
    '- ## 数据来源清单（所有来源URL）',
    '',
    '输出前必须先做数据自检，不足则继续补充搜索。',
  ].join('\n')

  const result = await agent.run(task, {
    temperature: mergedAgentConfig.temperature,
    maxTokens: mergedAgentConfig.maxTokens,
    systemPrompt: constrainedModel ? RESEARCHER_PROMPT_CONSTRAINED : RESEARCHER_PROMPT,
  })

  const verifiedSources = verifySources(result.output, topic.sources)

  return {
    summary: result.output.slice(0, 2000),
    keyPoints: extractKeyPoints(result.output),
    sources: verifiedSources,
    rawOutput: result.output,
  }
}

function extractKeyPoints(text: string): string[] {
  const lines = text.split('\n')
  const points: string[] = []
  let currentSection = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 检测 Markdown ## section headers (新格式) 和 === headers (兼容旧格式)
    if (trimmed.startsWith('## ') || trimmed.startsWith('===')) {
      if (trimmed.includes('核心论点') || trimmed.includes('核心发现')) {
        currentSection = 'core'
        continue
      }
      if (trimmed.includes('关键数据')) {
        currentSection = 'data'
        continue
      }
      if (trimmed.includes('对比数据') || trimmed.includes('对比') || trimmed.includes('benchmark')) {
        currentSection = 'compare'
        continue
      }
      if (trimmed.includes('真实案例') || trimmed.includes('公司') || trimmed.includes('产品')) {
        currentSection = 'cases'
        continue
      }
      if (trimmed.includes('专家') || trimmed.includes('观点')) {
        currentSection = 'experts'
        continue
      }
      if (trimmed.includes('争议') || trimmed.includes('反驳')) {
        currentSection = 'controversy'
        continue
      }
      // 其他 section（写作角度、来源清单、自检等）不提取
      currentSection = ''
      continue
    }

    // 跳过表格行、分割线、引用块、子标题
    if (/^\|.*\|$/.test(trimmed) && trimmed.split('|').length > 3) continue
    if (/^[-=]+$/.test(trimmed)) continue
    if (trimmed.startsWith('> ')) continue
    if (trimmed.startsWith('### ')) continue

    // 从核心论点/关键数据/争议部分提取列表项
    if (currentSection === 'core' || currentSection === 'data' || currentSection === 'compare' || currentSection === 'controversy') {
      // List items with separator: supports ` -- `, ` - `, `——`, `—` as delimiters
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const content = trimmed.slice(2).trim()
        // Try splitting on common separators (longest match first)
        const sepMatch = content.match(/^(.+?)\s+(?:--|——|—)\s+/)
        if (sepMatch && sepMatch[1].length > 5) {
          points.push(sepMatch[1].trim())
          continue
        }
        // Fallback: old format with ` - [source] [url]`
        const oldSepMatch = content.match(/^(.+?)\s+-\s+\[/)
        if (oldSepMatch && oldSepMatch[1].length > 5) {
          points.push(oldSepMatch[1].trim())
          continue
        }
      }
    }

    // 从案例部分提取结果数据
    if (currentSection === 'cases') {
      const dataMatch = trimmed.match(/^[-*]\s*(?:结果数据|关键数据|数据|产品|参数)[:：]\s*(.+)/i)
      if (dataMatch && dataMatch[1].length > 5) {
        points.push(dataMatch[1].trim())
        continue
      }
    }

    // 通用列表格式提取
    if (currentSection && currentSection !== '') {
      const listPatterns = [
        /^[-*\u2022\u25E6]\s*/,
        /^\d+[.、:：]\s*/,
      ]
      for (const pattern of listPatterns) {
        if (pattern.test(trimmed)) {
          const point = trimmed.replace(pattern, '').trim()
          if (point.length > 10 && point.length < 400) {
            points.push(point)
          }
          break
        }
      }
    }

    if (points.length >= 20) break
  }

  return points
}

function verifySources(
  output: string,
  originalSources: TopicSuggestion['sources']
): Array<{ title: string; url: string; verified: boolean }> {
  const urlPattern = /https?:\/\/[^\s\u3000\u2018\u2019\u201c\u201d（）\)\]]+/gi
  const foundUrls = new Set<string>(output.match(urlPattern) ?? [])

  // 提取所有标题作为上下文验证
  const titleSet = new Set(
    originalSources.map(s => s.title.toLowerCase())
  )

  // 检查数据来源清单部分是否存在至少3个URL
  const sourceListMatch = output.match(/(?:=== 数据来源清单 ===|## 数据来源清单)([\s\S]*?)(?:===|##|$)/i)
  let sourceCount = 0
  if (sourceListMatch) {
    const sourceUrls = sourceListMatch[1].match(urlPattern) ?? []
    sourceCount = sourceUrls.length
  }

  return originalSources.map((s) => {
    // URL在正文中被引用
    const urlFound = foundUrls.has(s.url)
    // 来源清单中有足够的URL
    const sourceListValid = sourceCount >= 3
    // 至少需要URL匹配或标题匹配（避免误判）
    const contextMatch = urlFound || s.title.toLowerCase().includes(output.slice(0, 500).toLowerCase())

    return {
      title: s.title,
      url: s.url,
      verified: urlFound && sourceListValid,
    }
  })
}
