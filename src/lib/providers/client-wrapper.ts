import { createAgentProvider } from './registry'
import type { AIProvider } from './types'
import type { ModelConfig } from '@/lib/config'
import type { Message, ToolDef, ChatOptions, ChatResponse } from './types'
import { extractText, extractToolCalls } from './utils'

export { extractText, extractToolCalls }

/**
 * Backward-compatible wrapper.
 * Creates a provider based on ModelConfig and delegates all calls to it.
 */
export class AIClient {
  private provider: AIProvider

  constructor(modelConfig: ModelConfig, agentName: string = 'default') {
    this.provider = createAgentProvider(agentName, modelConfig)
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    return this.provider.chat(messages, options)
  }

  async chatWithTools(
    messages: Message[],
    tools: ToolDef[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    return this.provider.chatWithTools(messages, tools, options)
  }
}
