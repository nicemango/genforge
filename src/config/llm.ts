/**
 * LLM Provider 统一配置管理
 *
 * 所有 LLM 配置在此集中管理，修改 llm-providers.json 即可切换模型
 *
 * 使用方式:
 *   import { getProviderConfig, getAgentProvider, getDefaultProvider } from '@/config/llm'
 *
 *   // 获取默认 provider
 *   const config = getDefaultProvider()
 *
 *   // 获取指定 agent 的 provider
 *   const config = getAgentProvider('topic')
 *
 *   // 获取指定 provider
 *   const config = getProviderConfig('anthropic-claude')
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ModelConfig } from '@/lib/config'

// ============================================================================
// Types
// ============================================================================

export type ProviderType = 'anthropic' | 'openai'

export interface LLMProviderConfig {
  name: string
  provider: ProviderType
  model: string
  apiKey: string
  baseURL: string
  enabled: boolean
  quotaResetHour: number | null
}

export interface LLMProvidersConfig {
  defaultProvider: string
  providers: Record<string, LLMProviderConfig>
  agentDefaults: Record<string, string>
}

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR = path.resolve(process.cwd(), 'src', 'config')
const PROVIDERS_FILE = path.join(CONFIG_DIR, 'llm-providers.json')

// ============================================================================
// Environment Variable Resolution
// ============================================================================

/**
 * 解析环境变量占位符 ${VAR_NAME}
 * 支持格式: ${VAR_NAME} 或 ${VAR_NAME:-default}
 */
function resolveEnvVariables(value: string): string {
  return value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_, varName, defaultValue) => {
    return process.env[varName] ?? defaultValue ?? ''
  })
}

// ============================================================================
// Config Loading
// ============================================================================

let cachedConfig: LLMProvidersConfig | null = null

/**
 * 加载 LLM Providers 配置（带缓存）
 */
export function loadLLMProvidersConfig(): LLMProvidersConfig {
  if (cachedConfig) return cachedConfig

  if (!fs.existsSync(PROVIDERS_FILE)) {
    throw new Error(`LLM providers config not found: ${PROVIDERS_FILE}`)
  }

  const rawContent = fs.readFileSync(PROVIDERS_FILE, 'utf-8')

  // 解析环境变量
  const resolvedContent = resolveEnvVariables(rawContent)

  let parsed: unknown
  try {
    parsed = JSON.parse(resolvedContent)
  } catch (err) {
    throw new Error(`Failed to parse ${PROVIDERS_FILE}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid LLM providers config`)
  }

  const config = parsed as LLMProvidersConfig

  // 验证配置
  if (!config.defaultProvider) {
    throw new Error('defaultProvider is required in llm-providers.json')
  }

  if (!config.providers || typeof config.providers !== 'object') {
    throw new Error('providers is required in llm-providers.json')
  }

  cachedConfig = config
  return config
}

/**
 * 清除配置缓存（用于测试或动态刷新）
 */
export function clearLLMConfigCache(): void {
  cachedConfig = null
}

// ============================================================================
// Provider Access
// ============================================================================

/**
 * 获取默认 Provider 配置
 */
export function getDefaultProvider(): LLMProviderConfig {
  const config = loadLLMProvidersConfig()
  const provider = config.providers[config.defaultProvider]

  if (!provider) {
    throw new Error(`Default provider "${config.defaultProvider}" not found in providers`)
  }

  if (!provider.enabled) {
    throw new Error(`Default provider "${config.defaultProvider}" is disabled`)
  }

  if (!provider.apiKey) {
    throw new Error(`API key not set for provider "${config.defaultProvider}". Set ${getEnvVarName(config.defaultProvider)} environment variable.`)
  }

  return provider
}

/**
 * 获取指定 Provider 配置
 */
export function getProviderConfig(providerName: string): LLMProviderConfig {
  const config = loadLLMProvidersConfig()
  const provider = config.providers[providerName]

  if (!provider) {
    throw new Error(`Provider "${providerName}" not found. Available: ${Object.keys(config.providers).join(', ')}`)
  }

  if (!provider.enabled) {
    throw new Error(`Provider "${providerName}" is disabled`)
  }

  if (!provider.apiKey) {
    throw new Error(`API key not set for provider "${providerName}". Set ${getEnvVarName(providerName)} environment variable.`)
  }

  return provider
}

/**
 * 获取 Agent 对应的 Provider 配置
 */
export function getAgentProvider(agentName: string): LLMProviderConfig {
  const config = loadLLMProvidersConfig()
  const providerName = config.agentDefaults[agentName] ?? config.defaultProvider
  return getProviderConfig(providerName)
}

/**
 * 获取 Agent 对应的 ModelConfig（用于 AI 客户端）
 */
export function getAgentModelConfig(agentName: string): ModelConfig {
  const provider = getAgentProvider(agentName)

  return {
    provider: provider.provider,
    model: provider.model,
    defaultModel: provider.model,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL || undefined,
    defaultProviderType: provider.provider,
  }
}

/**
 * 获取默认 ModelConfig（用于 AI 客户端）
 */
export function getDefaultModelConfig(): ModelConfig {
  const provider = getDefaultProvider()

  return {
    provider: provider.provider,
    model: provider.model,
    defaultModel: provider.model,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL || undefined,
    defaultProviderType: provider.provider,
  }
}

/**
 * 列出已配置且带凭证的 Provider，按 llm-providers.json 中的顺序返回。
 */
export function listConfiguredProviderModelConfigs(): Array<{ name: string; modelConfig: ModelConfig }> {
  const config = loadLLMProvidersConfig()

  return Object.entries(config.providers).flatMap(([name, provider]) => {
    if (!provider.enabled || !provider.apiKey) {
      return []
    }

    return [{
      name,
      modelConfig: {
        provider: provider.provider,
        model: provider.model,
        defaultModel: provider.model,
        apiKey: provider.apiKey,
        baseURL: provider.baseURL || undefined,
        defaultProviderType: provider.provider,
      },
    }]
  })
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * 根据 provider 名称推断环境变量名
 */
function getEnvVarName(providerName: string): string {
  // 从 provider 名称推断，如 "volcengine-kimi" -> "VOLCENGINE_API_KEY"
  const parts = providerName.split('-')
  if (parts.length >= 2) {
    return `${parts[0].toUpperCase()}_API_KEY`
  }
  return `${providerName.toUpperCase()}_API_KEY`
}

/**
 * 列出所有可用的 Provider
 */
export function listProviders(): Array<{ name: string; displayName: string; enabled: boolean }> {
  const config = loadLLMProvidersConfig()

  return Object.entries(config.providers).map(([key, provider]) => ({
    name: key,
    displayName: provider.name,
    enabled: provider.enabled,
  }))
}

/**
 * 列出所有可用的 Agent -> Provider 映射
 */
export function listAgentProviderMappings(): Record<string, string> {
  const config = loadLLMProvidersConfig()
  return { ...config.agentDefaults }
}

/**
 * 切换默认 Provider（运行时）
 */
export function switchDefaultProvider(providerName: string): void {
  const config = loadLLMProvidersConfig()

  if (!config.providers[providerName]) {
    throw new Error(`Provider "${providerName}" not found`)
  }

  config.defaultProvider = providerName

  // 注意：这只是更新缓存，实际配置需要修改 JSON 文件
  console.log(`[LLM Config] Default provider switched to: ${providerName}`)
}

/**
 * 切换 Agent 的 Provider（运行时）
 */
export function switchAgentProvider(agentName: string, providerName: string): void {
  const config = loadLLMProvidersConfig()

  if (!config.providers[providerName]) {
    throw new Error(`Provider "${providerName}" not found`)
  }

  config.agentDefaults[agentName] = providerName

  console.log(`[LLM Config] Agent "${agentName}" provider switched to: ${providerName}`)
}

/**
 * 生成环境变量配置说明
 */
export function generateEnvVarHelp(): string {
  const config = loadLLMProvidersConfig()
  const envVars = new Set<string>()

  Object.values(config.providers).forEach((provider) => {
    const match = provider.apiKey.match(/\$\{([^}:]+)(?::-([^}]*))?\}/)
    if (match) {
      envVars.add(match[1])
    }
  })

  if (envVars.size === 0) {
    return 'No environment variables needed - all API keys are hardcoded.'
  }

  const lines = ['# Required environment variables:', '']
  envVars.forEach((varName) => {
    lines.push(`${varName}=your-api-key-here`)
  })

  return lines.join('\n')
}
