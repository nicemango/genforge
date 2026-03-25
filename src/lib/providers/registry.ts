import type { AIProvider } from './types'
import { createAnthropicProvider } from './anthropic'
import { createOpenAIProvider } from './openai'
import type { ModelConfig } from '@/lib/config'

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
  const baseURL = providerType === 'openai' ? modelConfig.baseURL : undefined
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
}
