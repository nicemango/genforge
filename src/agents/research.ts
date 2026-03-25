import { createAgentProvider, type ModelConfig } from '@/lib/ai'
import { BaseAgent } from './base'
import { createWebFetchTool } from '@/tools/web-fetch'
import { createWebSearchTool } from '@/tools/web-search'
import { loadResearchConfig, getResearchModelConfig } from '@/lib/research-config'
import type { TopicSuggestion } from './topic'

export interface ResearchResult {
  summary: string
  keyPoints: string[]
  sources: Array<{ title: string; url: string; verified: boolean }>
  rawOutput: string
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

export async function runResearchAgent(
  topic: TopicSuggestion,
  modelConfig?: ModelConfig,
  agentConfig?: Partial<import('@/lib/research-config').ResearchAgentAgentConfig>,
): Promise<ResearchResult> {
  const cfg = loadResearchConfig()
  const resolvedModelConfig = modelConfig ?? getResearchModelConfig()

  const mergedAgentConfig = {
    ...cfg.agent,
    ...agentConfig,
  }

  const provider = createAgentProvider('research', resolvedModelConfig)

  const agent = new BaseAgent(provider, { maxSteps: mergedAgentConfig.maxSteps })
  const fetchTool = createWebFetchTool({ maxRetries: mergedAgentConfig.fetchRetry })
  const searchTool = createWebSearchTool({ maxRetries: mergedAgentConfig.searchRetry })
  agent.registerTool(fetchTool)
  agent.registerTool(searchTool)

  const knownSources = topic.sources
    .map((s) => '- ' + s.title + '：' + s.url)
    .join('\n')

  const task = [
    '请对以下话题进行深度研究，收集足够的资料用于写一篇 2000-2800 字的微信公众号文章。',
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
    '【第零阶段】研究规划：先在 <thinking> 中列出 6-8 个搜索维度和具体搜索词，确定优先级后再开始。',
    '',
    '【第一阶段】广度搜索：使用 web_search 执行至少 10-12 次搜索，强制覆盖：基础事实x2 + 市场规模数据x3 + 真实公司案例x3 + 专家/创始人引用x2 + 争议或反驳观点x2。',
    '',
    '【第二阶段】深度抓取：从搜索结果中选择 5-6 篇最相关的深度文章，使用 web_fetch 完整抓取，重点提取具体公司名、产品参数、融资数据、专家原话、争议论据。',
    '',
    '【第三阶段】查漏补缺：对照输出要求自检，数据不足的维度继续针对性补充搜索。',
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
    '- ## 核心论点（3-5条观点，带数据支撑）',
    '- ## 关键数据（至少8条，每条：数字+单位 -- 来源 -- URL）',
    '- ## 真实案例（至少3个，公司名+事件+结果数据+来源）',
    '- ## 专家与创始人观点（至少3条，人名+职位+原话+来源URL）',
    '- ## 争议与反驳（至少2条，对立观点+理由+数据）',
    '- ## 写作角度建议（2-3个角度，每个给出核心主张）',
    '- ## 数据来源清单（所有来源URL）',
    '',
    '输出前必须先做数据自检，不足则继续补充搜索。',
  ].join('\n')

  const result = await agent.run(task, {
    temperature: mergedAgentConfig.temperature,
    maxTokens: mergedAgentConfig.maxTokens,
    systemPrompt: RESEARCHER_PROMPT,
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
      if (trimmed.startsWith('## ') || trimmed.startsWith('===')) {
        currentSection = ''
        continue
      }
    }

    // 跳过表格行、分割线、引用块、子标题
    if (/^\|.*\|$/.test(trimmed) && trimmed.split('|').length > 3) continue
    if (/^[-=]+$/.test(trimmed)) continue
    if (trimmed.startsWith('> ')) continue
    if (trimmed.startsWith('### ')) continue

    // 从核心论点/关键数据/争议部分提取列表项
    if (currentSection === 'core' || currentSection === 'data' || currentSection === 'controversy') {
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
