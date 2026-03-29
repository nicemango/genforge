/**
 * TopicAgent 配置加载器
 *
 * 优先级（从高到低）：
 *   1. 传入参数（函数调用时显式传入）
 *   2. 环境变量（TOPIC_*）
 *   3. src/config/topic-agent.json
 *   4. 代码默认值
 *
 * 模型配置统一由 @/config/llm 管理
 */

import * as fs from 'fs'
import * as path from 'path'
import { getAgentProvider } from '@/config/llm'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface TopicAgentAgentConfig {
  temperature: number
  maxTokens: number
  count: number
  maxInputItems: number
}

export interface TopicAgentConfig {
  agent: TopicAgentAgentConfig
}

const CONFIG_FILE = path.resolve(process.cwd(), 'src', 'config', 'topic-agent.json')

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_AGENT: TopicAgentAgentConfig = {
  temperature: 0.4,
  maxTokens: 8000,
  count: 5,
  maxInputItems: 60,
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

interface FileConfig {
  provider?: string
  agent?: Partial<TopicAgentAgentConfig>
}

function loadFileConfig(): FileConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {}
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(content) as FileConfig
  } catch {
    return {}
  }
}

function envOverrides(): Partial<TopicAgentAgentConfig> {
  const partial: Partial<TopicAgentAgentConfig> = {}

  if (process.env.TOPIC_TEMPERATURE)
    partial.temperature = parseFloat(process.env.TOPIC_TEMPERATURE)
  if (process.env.TOPIC_MAX_TOKENS)
    partial.maxTokens = parseInt(process.env.TOPIC_MAX_TOKENS, 10)
  if (process.env.TOPIC_COUNT)
    partial.count = parseInt(process.env.TOPIC_COUNT, 10)
  if (process.env.TOPIC_MAX_INPUT_ITEMS)
    partial.maxInputItems = parseInt(process.env.TOPIC_MAX_INPUT_ITEMS, 10)

  return partial
}

/**
 * 加载 TopicAgent 配置
 * 模型配置从 @/config/llm 统一获取
 */
export function loadTopicConfig(): TopicAgentConfig {
  const file = loadFileConfig()
  const env = envOverrides()

  const fileAgent = file.agent ?? {}

  return {
    agent: {
      temperature: env.temperature ?? fileAgent.temperature ?? DEFAULT_AGENT.temperature,
      maxTokens: env.maxTokens ?? fileAgent.maxTokens ?? DEFAULT_AGENT.maxTokens,
      count: env.count ?? fileAgent.count ?? DEFAULT_AGENT.count,
      maxInputItems: env.maxInputItems ?? fileAgent.maxInputItems ?? DEFAULT_AGENT.maxInputItems,
    },
  }
}

/**
 * 获取 TopicAgent 的 ModelConfig（从统一配置获取）
 */
export function getTopicModelConfig() {
  return getAgentProvider('topic')
}

/**
 * 获取 TopicAgent 的 provider 名称
 */
export function getTopicProviderName(): string {
  const file = loadFileConfig()
  return file.provider ?? 'topic'
}
