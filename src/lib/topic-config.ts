/**
 * TopicAgent 配置加载器
 *
 * 优先级（从高到低）：
 *   1. 传入参数（函数调用时显式传入）
 *   2. 环境变量（TOPIC_* / ...）
 *   3. src/config/topic-agent.json
 *   4. 代码默认值
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ModelConfig } from './config'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface TopicAgentModelConfig {
  provider: 'anthropic' | 'openai'
  model: string
  apiKey: string
  baseURL: string
}

export interface TopicAgentAgentConfig {
  temperature: number
  maxTokens: number
  count: number
  maxInputItems: number
}

export interface TopicAgentConfig {
  model: TopicAgentModelConfig
  agent: TopicAgentAgentConfig
}

const CONFIG_FILE = path.resolve(process.cwd(), 'src', 'config', 'topic-agent.json')

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODEL: TopicAgentModelConfig = {
  provider: 'openai',
  model: 'Kimi-K2.5',
  apiKey: '',
  baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v1',
}

const DEFAULT_AGENT: TopicAgentAgentConfig = {
  temperature: 0.3,
  maxTokens: 6000,
  count: 5,
  maxInputItems: 60,
}

const DEFAULT_CONFIG: TopicAgentConfig = {
  model: DEFAULT_MODEL,
  agent: DEFAULT_AGENT,
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

interface FlatConfig {
  model?: Partial<TopicAgentModelConfig>
  agent?: Partial<TopicAgentAgentConfig>
}

function loadFileConfig(): FlatConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {}
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(content) as FlatConfig
  } catch {
    return {}
  }
}

function envOverrides(): FlatConfig {
  const partial: FlatConfig = {}

  // Model env overrides
  const modelPartial: Partial<TopicAgentModelConfig> = {}
  if (process.env.TOPIC_MODEL_PROVIDER) {
    modelPartial.provider = process.env.TOPIC_MODEL_PROVIDER as 'anthropic' | 'openai'
  }
  if (process.env.TOPIC_MODEL) {
    modelPartial.model = process.env.TOPIC_MODEL
  }
  if (process.env.TOPIC_MODEL_API_KEY) {
    modelPartial.apiKey = process.env.TOPIC_MODEL_API_KEY
  }
  if (process.env.TOPIC_MODEL_BASE_URL) {
    modelPartial.baseURL = process.env.TOPIC_MODEL_BASE_URL
  }
  if (Object.keys(modelPartial).length > 0) {
    partial.model = modelPartial
  }

  // Agent env overrides
  const agentPartial: Partial<TopicAgentAgentConfig> = {}
  if (process.env.TOPIC_TEMPERATURE)
    agentPartial.temperature = parseFloat(process.env.TOPIC_TEMPERATURE)
  if (process.env.TOPIC_MAX_TOKENS)
    agentPartial.maxTokens = parseInt(process.env.TOPIC_MAX_TOKENS, 10)
  if (process.env.TOPIC_COUNT)
    agentPartial.count = parseInt(process.env.TOPIC_COUNT, 10)
  if (process.env.TOPIC_MAX_INPUT_ITEMS)
    agentPartial.maxInputItems = parseInt(process.env.TOPIC_MAX_INPUT_ITEMS, 10)
  if (Object.keys(agentPartial).length > 0) {
    partial.agent = agentPartial
  }

  return partial
}

/**
 * 合并所有配置来源
 * ENV > FILE > DEFAULT
 */
export function loadTopicConfig(): TopicAgentConfig {
  const file = loadFileConfig()
  const env = envOverrides()

  const fileModel = file.model ?? {}
  const envModel = env.model ?? {}

  const fileAgent = file.agent ?? {}
  const envAgent = env.agent ?? {}

  return {
    model: {
      provider: envModel.provider ?? fileModel.provider ?? DEFAULT_MODEL.provider,
      model: envModel.model ?? fileModel.model ?? DEFAULT_MODEL.model,
      apiKey: envModel.apiKey ?? fileModel.apiKey ?? DEFAULT_MODEL.apiKey,
      baseURL: envModel.baseURL ?? fileModel.baseURL ?? DEFAULT_MODEL.baseURL,
    },
    agent: {
      temperature: envAgent.temperature ?? fileAgent.temperature ?? DEFAULT_AGENT.temperature,
      maxTokens: envAgent.maxTokens ?? fileAgent.maxTokens ?? DEFAULT_AGENT.maxTokens,
      count: envAgent.count ?? fileAgent.count ?? DEFAULT_AGENT.count,
      maxInputItems: envAgent.maxInputItems ?? fileAgent.maxInputItems ?? DEFAULT_AGENT.maxInputItems,
    },
  }
}

/**
 * 获取 TopicAgent 的完整 ModelConfig（用于 createAgentProvider）
 */
export function getTopicModelConfig(): ModelConfig {
  const config = loadTopicConfig()

  const apiKey = config.model.apiKey || process.env.TOPIC_MODEL_API_KEY || process.env.DEFAULT_AI_API_KEY || ''
  const baseURL = config.model.baseURL || process.env.TOPIC_MODEL_BASE_URL || process.env.DEFAULT_AI_BASE_URL || undefined

  return {
    provider: config.model.provider,
    model: config.model.model,
    apiKey,
    baseURL,
    defaultProviderType: config.model.provider,
  }
}
