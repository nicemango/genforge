import type { AIProvider, ChatResponse } from './types'
import type { Message, ToolDef, ChatOptions, ContentBlock } from '@/lib/ai'

interface OpenAIChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface OpenAIChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenAIChatCompletionTool {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export function createOpenAIProvider(
  apiKey: string,
  defaultModel: string,
  baseURL: string,
): AIProvider {
  return {
    name: 'openai',
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
      const openaiMessages = buildOpenAIMessages(messages)
      const openaiTools = tools.length > 0 ? buildOpenAITools(tools) : undefined

      const body: Record<string, unknown> = {
        model,
        messages: openaiMessages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        ...(options.systemPrompt
          ? { messages: [{ role: 'system', content: options.systemPrompt } as OpenAIChatMessage, ...openaiMessages] }
          : {}),
        ...(openaiTools ? { tools: openaiTools } : {}),
      }

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI provider error: HTTP ${response.status} — ${errorText}`)
      }

      const data = await response.json() as {
        id: string
        model: string
        choices: Array<{
          message: { role: string; content: string | null; tool_calls?: OpenAIChatCompletionTool[] }
          finish_reason: string
        }>
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
      }

      return buildChatResponse(data)
    },
  }
}

function buildOpenAIMessages(messages: Message[]): OpenAIChatMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content }
    }

    // Handle ContentBlock[] - only text and tool_result are relevant for OpenAI
    const textParts: string[] = []
    for (const block of msg.content) {
      if (block.type === 'text') {
        textParts.push(block.text ?? '')
      } else if (block.type === 'tool_result') {
        textParts.push(block.content ?? '')
      }
    }

    return { role: msg.role, content: textParts.join('\n') }
  })
}

function buildOpenAITools(tools: ToolDef[]): OpenAIChatTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

function buildChatResponse(data: {
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: OpenAIChatCompletionTool[] }
    finish_reason: string
  }>
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}): ChatResponse {
  const choice = data.choices[0]
  if (!choice) {
    throw new Error('No choices in OpenAI response')
  }

  const content: ContentBlock[] = []

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content })
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      })
    }
  }

  const stopReason = mapFinishReason(choice.finish_reason)

  return {
    content,
    stopReason,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
  }
}

function mapFinishReason(reason: string): ChatResponse['stopReason'] {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    default: return 'end_turn'
  }
}
