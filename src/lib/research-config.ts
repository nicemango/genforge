/**
 * ResearchAgent 配置加载器
 *
 * 优先级（从高到低）：
 *   1. CLI 参数（process.argv）
 *   2. 环境变量（RESEARCH_MODEL_* / RESEARCH_MAX_STEPS / ...）
 *   3. src/config/research-agent.json
 *   4. 代码默认值
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ModelConfig } from './config'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface ResearchAgentModelConfig {
  provider: 'anthropic' | 'openai'
  model: string
  apiKey: string
  baseURL: string
}

export interface ResearchAgentAgentConfig {
  maxSteps: number
  temperature: number
  maxTokens: number
  searchRetry: number
  fetchRetry: number
}

export interface ResearchAgentQualityConfig {
  minDataPoints: number
  minCases: number
  minExpertQuotes: number
  minControversies: number
}

export interface ResearchAgentConfig {
  model: ResearchAgentModelConfig
  agent: ResearchAgentAgentConfig
  quality: ResearchAgentQualityConfig
}

const CONFIG_FILE = path.resolve(process.cwd(), 'src', 'config', 'research-agent.json')

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODEL: ResearchAgentModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: '',
  baseURL: '',
}

const DEFAULT_AGENT: ResearchAgentAgentConfig = {
  maxSteps: 60,
  temperature: 0.3,
  maxTokens: 16000,
  searchRetry: 3,
  fetchRetry: 3,
}

const DEFAULT_QUALITY: ResearchAgentQualityConfig = {
  minDataPoints: 8,
  minCases: 3,
  minExpertQuotes: 3,
  minControversies: 2,
}

const DEFAULT_CONFIG: ResearchAgentConfig = {
  model: DEFAULT_MODEL,
  agent: DEFAULT_AGENT,
  quality: DEFAULT_QUALITY,
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function loadFileConfig(): Partial<ResearchAgentConfig> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {}
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(content) as Partial<ResearchAgentConfig>
  } catch {
    return {}
  }
}

interface FlatConfig {
  model?: Partial<ResearchAgentModelConfig>
  agent?: Partial<ResearchAgentAgentConfig>
  quality?: Partial<ResearchAgentQualityConfig>
}

function parseCliArgs(): FlatConfig {
  const argv = process.argv.slice(2)
  const partial: FlatConfig = {}
  const agentPartial: Partial<ResearchAgentAgentConfig> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]

    if ((arg === '--max-steps' || arg === '-s') && next != null && !next.startsWith('-')) {
      agentPartial.maxSteps = parseInt(next, 10)
      i++
    } else if ((arg === '--temperature' || arg === '-t') && next != null && !next.startsWith('-')) {
      agentPartial.temperature = parseFloat(next)
      i++
    } else if ((arg === '--max-tokens' || arg === '-m') && next != null && !next.startsWith('-')) {
      agentPartial.maxTokens = parseInt(next, 10)
      i++
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
  const modelPartial: Partial<ResearchAgentModelConfig> = {}
  if (process.env.RESEARCH_MODEL_PROVIDER) {
    modelPartial.provider = process.env.RESEARCH_MODEL_PROVIDER as 'anthropic' | 'openai'
  }
  if (process.env.RESEARCH_MODEL) {
    modelPartial.model = process.env.RESEARCH_MODEL
  }
  if (process.env.RESEARCH_MODEL_API_KEY) {
    modelPartial.apiKey = process.env.RESEARCH_MODEL_API_KEY
  }
  if (process.env.RESEARCH_MODEL_BASE_URL) {
    modelPartial.baseURL = process.env.RESEARCH_MODEL_BASE_URL
  }
  if (Object.keys(modelPartial).length > 0) {
    partial.model = modelPartial
  }

  // Agent env overrides
  const agentPartial: Partial<ResearchAgentAgentConfig> = {}
  if (process.env.RESEARCH_MAX_STEPS) agentPartial.maxSteps = parseInt(process.env.RESEARCH_MAX_STEPS, 10)
  if (process.env.RESEARCH_TEMPERATURE) agentPartial.temperature = parseFloat(process.env.RESEARCH_TEMPERATURE)
  if (process.env.RESEARCH_MAX_TOKENS) agentPartial.maxTokens = parseInt(process.env.RESEARCH_MAX_TOKENS, 10)
  if (process.env.RESEARCH_SEARCH_RETRY) agentPartial.searchRetry = parseInt(process.env.RESEARCH_SEARCH_RETRY, 10)
  if (process.env.RESEARCH_FETCH_RETRY) agentPartial.fetchRetry = parseInt(process.env.RESEARCH_FETCH_RETRY, 10)
  if (Object.keys(agentPartial).length > 0) {
    partial.agent = agentPartial
  }

  // Quality env overrides
  const qualityPartial: Partial<ResearchAgentQualityConfig> = {}
  if (process.env.RESEARCH_MIN_DATA_POINTS) qualityPartial.minDataPoints = parseInt(process.env.RESEARCH_MIN_DATA_POINTS, 10)
  if (process.env.RESEARCH_MIN_CASES) qualityPartial.minCases = parseInt(process.env.RESEARCH_MIN_CASES, 10)
  if (process.env.RESEARCH_MIN_EXPERT_QUOTES) qualityPartial.minExpertQuotes = parseInt(process.env.RESEARCH_MIN_EXPERT_QUOTES, 10)
  if (process.env.RESEARCH_MIN_CONTROVERSIES) qualityPartial.minControversies = parseInt(process.env.RESEARCH_MIN_CONTROVERSIES, 10)
  if (Object.keys(qualityPartial).length > 0) {
    partial.quality = qualityPartial
  }

  return partial
}

/**
 * 合并所有配置来源
 * CLI > ENV > FILE > DEFAULT
 */
export function loadResearchConfig(): ResearchAgentConfig {
  const file = loadFileConfig() as FlatConfig
  const cli = parseCliArgs() as FlatConfig
  const env = envOverrides() as FlatConfig

  const fileModel = file.model ?? {}
  const cliModel = cli.model ?? {}
  const envModel = env.model ?? {}

  const fileAgent = file.agent ?? {}
  const cliAgent = cli.agent ?? {}
  const envAgent = env.agent ?? {}

  const fileQuality = file.quality ?? {}
  const cliQuality = cli.quality ?? {}
  const envQuality = env.quality ?? {}

  return {
    model: {
      provider: envModel.provider ?? cliModel.provider ?? fileModel.provider ?? DEFAULT_MODEL.provider,
      model: envModel.model ?? cliModel.model ?? fileModel.model ?? DEFAULT_MODEL.model,
      apiKey: envModel.apiKey ?? cliModel.apiKey ?? fileModel.apiKey ?? DEFAULT_MODEL.apiKey,
      baseURL: envModel.baseURL ?? cliModel.baseURL ?? fileModel.baseURL ?? DEFAULT_MODEL.baseURL,
    },
    agent: {
      maxSteps: envAgent.maxSteps ?? cliAgent.maxSteps ?? fileAgent.maxSteps ?? DEFAULT_AGENT.maxSteps,
      temperature: envAgent.temperature ?? cliAgent.temperature ?? fileAgent.temperature ?? DEFAULT_AGENT.temperature,
      maxTokens: envAgent.maxTokens ?? cliAgent.maxTokens ?? fileAgent.maxTokens ?? DEFAULT_AGENT.maxTokens,
      searchRetry: envAgent.searchRetry ?? cliAgent.searchRetry ?? fileAgent.searchRetry ?? DEFAULT_AGENT.searchRetry,
      fetchRetry: envAgent.fetchRetry ?? cliAgent.fetchRetry ?? fileAgent.fetchRetry ?? DEFAULT_AGENT.fetchRetry,
    },
    quality: {
      minDataPoints: envQuality.minDataPoints ?? cliQuality.minDataPoints ?? fileQuality.minDataPoints ?? DEFAULT_QUALITY.minDataPoints,
      minCases: envQuality.minCases ?? cliQuality.minCases ?? fileQuality.minCases ?? DEFAULT_QUALITY.minCases,
      minExpertQuotes: envQuality.minExpertQuotes ?? cliQuality.minExpertQuotes ?? fileQuality.minExpertQuotes ?? DEFAULT_QUALITY.minExpertQuotes,
      minControversies: envQuality.minControversies ?? cliQuality.minControversies ?? fileQuality.minControversies ?? DEFAULT_QUALITY.minControversies,
    },
  }
}

/**
 * 获取 ResearchAgent 的完整 ModelConfig（用于 createAgentProvider）
 */
export function getResearchModelConfig(): ModelConfig {
  const config = loadResearchConfig()

  // ENV overrides take precedence for API key
  const apiKey = config.model.apiKey || process.env.RESEARCH_MODEL_API_KEY || process.env.DEFAULT_AI_API_KEY || ''
  const baseURL = config.model.baseURL || process.env.RESEARCH_MODEL_BASE_URL || process.env.DEFAULT_AI_BASE_URL || undefined

  return {
    provider: config.model.provider,
    model: config.model.model,
    apiKey,
    baseURL,
    defaultProviderType: config.model.provider,
  }
}
