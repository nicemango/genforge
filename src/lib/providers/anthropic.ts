import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ChatResponse } from './types'
import type { Message, ToolDef, ChatOptions, ContentBlock } from '@/lib/ai'

export function createAnthropicProvider(
  apiKey: string,
  defaultModel: string,
  baseURL?: string,
): AIProvider {
  const client = new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  })

  return {
    name: 'anthropic',
    defaultModel,

    async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
      return this.chatWithTools(messages, [], options)
    },

    async chatWithTools(
      messages: Message[],
      tools: ToolDef[],
      options: ChatOptions = {},
    ): Promise<ChatResponse> {
      const model = options.model ?? defaultModel
      if (!model) {
        throw new Error(
          'Anthropic provider: no model specified. Provide options.model or set defaultModel when creating the provider.',
        )
      }

      const sdkTools: Anthropic.Tool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool['input_schema'],
      }))

      const response = await client.messages.create({
        model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        messages: messages.map(toSDKMessage),
        ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        ...(sdkTools.length > 0 ? { tools: sdkTools } : {}),
      })

      return buildChatResponse(response)
    },
  }
}

function buildChatResponse(response: Anthropic.Message): ChatResponse {
  const content: ContentBlock[] = response.content.flatMap((block): ContentBlock[] => {
    if (block.type === 'text') {
      return [{ type: 'text', text: block.text }]
    }
    if (block.type === 'tool_use') {
      return [{ type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> }]
    }
    return []
  })

  return {
    content,
    stopReason: mapStopReason(response.stop_reason),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  }
}

function toSDKMessage(msg: Message): Anthropic.MessageParam {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content }
  }

  const blocks: Anthropic.ContentBlockParam[] = msg.content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text! }
    }
    if (block.type === 'tool_use') {
      return { type: 'tool_use', id: block.id!, name: block.name!, input: block.input! }
    }
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id!,
        content: block.content!,
        ...(block.is_error !== undefined ? { is_error: block.is_error } : {}),
      }
    }
    throw new Error(`Unknown content block type: ${(block as { type: string }).type}`)
  })

  return { role: msg.role, content: blocks }
}

function mapStopReason(reason: string | null): ChatResponse['stopReason'] {
  switch (reason) {
    case 'end_turn': return 'end_turn'
    case 'tool_use': return 'tool_use'
    case 'max_tokens': return 'max_tokens'
    case 'stop_sequence': return 'stop_sequence'
    default: return 'end_turn'
  }
}
