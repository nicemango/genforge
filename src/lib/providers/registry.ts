import type { AIProvider } from './types'
import { createAnthropicProvider } from './anthropic'
import { createOpenAIProvider } from './openai'
import type { ModelConfig } from '@/lib/config'
import { recordUsage } from '@/lib/llm-usage'

const AGENT_MODEL_DEFAULTS: Record<string, string> = {
  topic: 'claude-haiku-4-5-20251001',
  research: 'claude-sonnet-4-6',
  writer: 'claude-sonnet-4-6',
  review: 'claude-haiku-4-5-20251001',
  image: 'claude-sonnet-4-6',
}

export type { ProviderConfig } from '@/lib/config'

function resolveAgentConfig(
  agentName: string,
  modelConfig: ModelConfig,
): { provider: { type: 'anthropic' | 'openai'; apiKey: string; baseURL?: string; defaultModel: string }; model: string } {
  // Check for per-agent full provider config first
  if (modelConfig.agentProviders) {
    const agentProvider = modelConfig.agentProviders[agentName]
    if (agentProvider) {
      return { provider: agentProvider, model: agentProvider.defaultModel }
    }
  }

  // Check if overrides contains a named provider reference
  const override = modelConfig.overrides?.[agentName]
  if (override && modelConfig.agentProviders?.[override]) {
    const namedProvider = modelConfig.agentProviders[override]
    return { provider: namedProvider, model: namedProvider.defaultModel }
  }

  // Fall back to default provider
  const providerType = modelConfig.defaultProviderType ?? 'anthropic'
  const apiKey = modelConfig.apiKey ?? ''
  const baseURL = modelConfig.baseURL
  const defaultModel =
    modelConfig.overrides?.[agentName] ??
    modelConfig.defaultModel ??
    AGENT_MODEL_DEFAULTS[agentName] ??
    'claude-sonnet-4-6'

  return {
    provider: { type: providerType, apiKey, baseURL, defaultModel },
    model: defaultModel,
  }
}

export function createAgentProvider(agentName: string, modelConfig: ModelConfig): AIProvider {
  const { provider, model } = resolveAgentConfig(agentName, modelConfig)

  const baseProvider: AIProvider = (() => {
  switch (provider.type) {
    case 'anthropic':
      return createAnthropicProvider(provider.apiKey, model, provider.baseURL)
    case 'openai':
      if (!provider.baseURL) {
        throw new Error(`OpenAI provider for agent "${agentName}" requires baseURL.`)
      }
      return createOpenAIProvider(provider.apiKey, model, provider.baseURL)
    default:
      throw new Error(`Unknown provider type: ${(provider as { type: string }).type}`)
  }
  })()

  return {
    ...baseProvider,
    async chat(messages, options) {
      const startedAt = Date.now()
      const response = await baseProvider.chat(messages, options)
      recordUsage({
        agentName,
        providerName: baseProvider.name,
        model: options?.model ?? model,
        usage: response.usage,
        kind: "chat",
        durationMs: Date.now() - startedAt,
      })
      return response
    },
    async chatWithTools(messages, tools, options) {
      const startedAt = Date.now()
      const response = await baseProvider.chatWithTools(messages, tools, options)
      recordUsage({
        agentName,
        providerName: baseProvider.name,
        model: options?.model ?? model,
        usage: response.usage,
        kind: "chatWithTools",
        durationMs: Date.now() - startedAt,
      })
      return response
    },
  }
}
