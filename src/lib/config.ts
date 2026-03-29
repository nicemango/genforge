/**
 * 配置管理 - 支持多账号独立配置
 */
import { z, ZodError } from 'zod'
import { createAnthropicProvider } from './providers/anthropic'

export interface ModelConfig {
  provider: 'anthropic' | 'openai'
  model: string
  apiKey: string
  baseURL?: string
  defaultModel?: string
  minimaxApiKey?: string
  agentProviders?: Record<string, { type: 'anthropic' | 'openai'; apiKey: string; baseURL?: string; defaultModel: string }>
  defaultProviderType?: 'anthropic' | 'openai'
  overrides?: Record<string, string>
}

// 模型配置 schema
const ModelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  model: z.string().default('claude-sonnet-4-6'),
  apiKey: z.string(),
  baseURL: z.string().optional(),
  defaultModel: z.string().optional(),
  minimaxApiKey: z.string().optional(),
  agentProviders: z.record(z.string(), z.object({
    type: z.enum(['anthropic', 'openai']),
    apiKey: z.string(),
    baseURL: z.string().optional(),
    defaultModel: z.string(),
  })).optional(),
  defaultProviderType: z.enum(['anthropic', 'openai']).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
})

// 写作风格配置
const WritingStyleSchema = z.object({
  tone: z.string().optional(),
  length: z.string().optional(),
  style: z.array(z.string()).optional(),
})

// 微信配置
const WechatConfigSchema = z.object({
  appId: z.string(),
  appSecret: z.string(),
  themeId: z.enum(['brand-clean', 'brand-magazine', 'brand-warm', 'wechat-pro']).optional(),
  brandName: z.string().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  titleAlign: z.enum(['left', 'center']).optional(),
  showEndingCard: z.boolean().optional(),
  endingCardText: z.string().optional(),
  imageStyle: z.enum(['rounded', 'soft-shadow', 'square']).optional(),
})

// 单环节质量门槛
export interface StepQualityThreshold {
  minScore?: number       // 该环节最低质量分
  maxRetries?: number     // 该环节最大重试次数
  blocksPipeline?: boolean // 失败是否中止整个 Pipeline
}

// 质量门槛配置
const StepQualityThresholdSchema = z.object({
  minScore: z.number().optional(),
  maxRetries: z.number().optional(),
  blocksPipeline: z.boolean().optional(),
})

const QualityConfigSchema = z.object({
  minScore: z.number().default(7.0),
  maxWriteRetries: z.number().default(2),
  stepThresholds: z.record(z.string(), StepQualityThresholdSchema).optional(),
})

export type QualityConfig = z.infer<typeof QualityConfigSchema>

export const DEFAULT_STEP_THRESHOLDS: Record<string, StepQualityThreshold> = {
  TREND_CRAWL: { blocksPipeline: false },
  TOPIC_SELECT: { blocksPipeline: false },
  RESEARCH: { blocksPipeline: false },
  WRITE: { minScore: 7.0, maxRetries: 2, blocksPipeline: false },
  GENERATE_IMAGES: { blocksPipeline: false },
  REVIEW: { minScore: 7.0, blocksPipeline: false },
  PUBLISH: { blocksPipeline: true },
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  minScore: 7.0,
  maxWriteRetries: 2,
  stepThresholds: DEFAULT_STEP_THRESHOLDS,
}

export type ProviderConfig = ModelConfig

/**
 * 从 JSON 加载模型配置
 */
export function loadModelConfig(configJson: string | object | null | undefined): ModelConfig {
  if (configJson == null) {
    throw new Error('modelConfig is null or undefined')
  }
  let parsed: unknown
  try {
    parsed = typeof configJson === 'string' ? JSON.parse(configJson) : configJson
  } catch (err) {
    throw new Error(
      `Failed to parse modelConfig JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let config: z.infer<typeof ModelConfigSchema>
  try {
    config = ModelConfigSchema.parse(parsed)
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors = err.errors
        .map((e) => `  - ${e.path.join('.') || '(root)'}: ${e.message}`)
        .join('\n')
      throw new Error(`modelConfig validation failed:\n${fieldErrors}`)
    }
    throw err
  }

  return config as ModelConfig
}

/**
 * 获取默认模型配置（从环境变量）
 */
export function getDefaultModelConfig(): ModelConfig {
  const apiKey = process.env.DEFAULT_AI_API_KEY
  if (!apiKey) {
    throw new Error('DEFAULT_AI_API_KEY not set')
  }

  const defaultProviderType = (process.env.DEFAULT_AI_PROVIDER_TYPE as 'anthropic' | 'openai') ?? 'anthropic'

  return {
    provider: defaultProviderType,
    model: process.env.DEFAULT_AI_MODEL || 'claude-sonnet-4-6',
    apiKey,
    baseURL: process.env.DEFAULT_AI_BASE_URL,
    defaultProviderType,
  }
}

/**
 * 创建 AI 客户端
 */
export function createAIClient(config: ModelConfig) {
  const providerType = config.defaultProviderType ?? config.provider

  if (providerType === 'anthropic') {
    return createAnthropicProvider(config.apiKey, config.model, config.baseURL)
  }
  if (providerType === 'openai') {
    const { createOpenAIProvider } = require('./providers/openai')
    return createOpenAIProvider(config.apiKey, config.model, config.baseURL)
  }
  throw new Error(`Unsupported provider: ${providerType}`)
}
