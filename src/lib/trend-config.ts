/**
 * TrendAgent 配置加载器
 *
 * 优先级（从高到低）：
 *   1. CLI 参数（process.argv）
 *   2. 环境变量（TREND_* / ...）
 *   3. src/config/trend-agent.json
 *   4. 代码默认值
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ModelConfig } from './config'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface TrendAgentModelConfig {
  provider: 'anthropic' | 'openai'
  model: string
  apiKey: string
  baseURL: string
}

export interface TrendAgentAgentConfig {
  topic: string
  maxArticlesPerSource: number
  freshDays: number
  outputDir: string
}

export interface TrendAgentConfig {
  model: TrendAgentModelConfig
  agent: TrendAgentAgentConfig
}

const CONFIG_FILE = path.resolve(process.cwd(), 'src', 'config', 'trend-agent.json')

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODEL: TrendAgentModelConfig = {
  provider: 'openai',
  model: 'Kimi-K2.5',
  apiKey: '',
  baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v1',
}

const DEFAULT_AGENT: TrendAgentAgentConfig = {
  topic: 'ai',
  maxArticlesPerSource: 20,
  freshDays: 7,
  outputDir: 'output/trend-agent',
}

const DEFAULT_CONFIG: TrendAgentConfig = {
  model: DEFAULT_MODEL,
  agent: DEFAULT_AGENT,
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

interface FlatConfig {
  model?: Partial<TrendAgentModelConfig>
  agent?: Partial<TrendAgentAgentConfig>
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

function parseCliArgs(): FlatConfig {
  const argv = process.argv.slice(2)
  const partial: FlatConfig = {}
  const agentPartial: Partial<TrendAgentAgentConfig> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]

    switch (arg) {
      case '--topic':
      case '-t':
        if (next != null && !next.startsWith('-')) {
          agentPartial.topic = next
          i++
        }
        break
      case '--fresh-days':
      case '-d':
        if (next != null && !next.startsWith('-')) {
          agentPartial.freshDays = parseInt(next, 10)
          i++
        }
        break
      case '--max':
      case '-m':
        if (next != null && !next.startsWith('-')) {
          agentPartial.maxArticlesPerSource = parseInt(next, 10)
          i++
        }
        break
      case '--output':
      case '-o':
        if (next != null && !next.startsWith('-')) {
          agentPartial.outputDir = next
          i++
        }
        break
      case '--topic-only':
        if (argv[i + 1]) {
          agentPartial.topic = argv[i + 1]
        }
        break
    }
  }

  if (Object.keys(agentPartial).length > 0) {
    partial.agent = agentPartial
  }

  return partial
}

function envOverrides(): FlatConfig {
  const partial: FlatConfig = {}

  // Model env overrides
  const modelPartial: Partial<TrendAgentModelConfig> = {}
  if (process.env.TREND_MODEL_PROVIDER) {
    modelPartial.provider = process.env.TREND_MODEL_PROVIDER as 'anthropic' | 'openai'
  }
  if (process.env.TREND_MODEL) {
    modelPartial.model = process.env.TREND_MODEL
  }
  if (process.env.TREND_MODEL_API_KEY) {
    modelPartial.apiKey = process.env.TREND_MODEL_API_KEY
  }
  if (process.env.TREND_MODEL_BASE_URL) {
    modelPartial.baseURL = process.env.TREND_MODEL_BASE_URL
  }
  if (Object.keys(modelPartial).length > 0) {
    partial.model = modelPartial
  }

  // Agent env overrides
  const agentPartial: Partial<TrendAgentAgentConfig> = {}
  if (process.env.TREND_TOPIC) agentPartial.topic = process.env.TREND_TOPIC
  if (process.env.TREND_FRESH_DAYS) agentPartial.freshDays = parseInt(process.env.TREND_FRESH_DAYS, 10)
  if (process.env.TREND_MAX) agentPartial.maxArticlesPerSource = parseInt(process.env.TREND_MAX, 10)
  if (process.env.TREND_OUTPUT) agentPartial.outputDir = process.env.TREND_OUTPUT
  if (Object.keys(agentPartial).length > 0) {
    partial.agent = agentPartial
  }

  return partial
}

/**
 * 合并所有配置来源
 * CLI > ENV > FILE > DEFAULT
 */
export function loadTrendConfig(): TrendAgentConfig {
  const file = loadFileConfig()
  const cli = parseCliArgs()
  const env = envOverrides()

  const fileModel = file.model ?? {}
  const cliModel = cli.model ?? {}
  const envModel = env.model ?? {}

  const fileAgent = file.agent ?? {}
  const cliAgent = cli.agent ?? {}
  const envAgent = env.agent ?? {}

  return {
    model: {
      provider: envModel.provider ?? cliModel.provider ?? fileModel.provider ?? DEFAULT_MODEL.provider,
      model: envModel.model ?? cliModel.model ?? fileModel.model ?? DEFAULT_MODEL.model,
      apiKey: envModel.apiKey ?? cliModel.apiKey ?? fileModel.apiKey ?? DEFAULT_MODEL.apiKey,
      baseURL: envModel.baseURL ?? cliModel.baseURL ?? fileModel.baseURL ?? DEFAULT_MODEL.baseURL,
    },
    agent: {
      topic: envAgent.topic ?? cliAgent.topic ?? fileAgent.topic ?? DEFAULT_AGENT.topic,
      maxArticlesPerSource: envAgent.maxArticlesPerSource ?? cliAgent.maxArticlesPerSource ?? fileAgent.maxArticlesPerSource ?? DEFAULT_AGENT.maxArticlesPerSource,
      freshDays: envAgent.freshDays ?? cliAgent.freshDays ?? fileAgent.freshDays ?? DEFAULT_AGENT.freshDays,
      outputDir: envAgent.outputDir ?? cliAgent.outputDir ?? fileAgent.outputDir ?? DEFAULT_AGENT.outputDir,
    },
  }
}

/**
 * 获取 TrendAgent 的完整 ModelConfig（用于 createAgentProvider）
 */
export function getTrendModelConfig(): ModelConfig {
  const config = loadTrendConfig()

  const apiKey = config.model.apiKey || process.env.TREND_MODEL_API_KEY || process.env.DEFAULT_AI_API_KEY || ''
  const baseURL = config.model.baseURL || process.env.TREND_MODEL_BASE_URL || process.env.DEFAULT_AI_BASE_URL || undefined

  return {
    provider: config.model.provider,
    model: config.model.model,
    apiKey,
    baseURL,
    defaultProviderType: config.model.provider,
  }
}
