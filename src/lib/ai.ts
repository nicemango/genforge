// Re-export all types from the providers package
export type {
  AIProvider,
  ChatOptions,
  Message,
  ContentBlock,
  ToolDef,
  ChatResponse,
} from '@/lib/providers/types'

export { extractText, extractToolCalls } from '@/lib/providers/utils'
export { AIClient } from '@/lib/providers/client-wrapper'
export { createAgentProvider } from '@/lib/providers/registry'
export type { ProviderConfig } from '@/lib/config'
export type { ModelConfig } from '@/lib/config'
