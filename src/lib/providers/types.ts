// Core shared types — no imports from other internal modules

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ToolDef {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required?: string[]
  }
}

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export interface ChatResponse {
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: { inputTokens: number; outputTokens: number }
}

export interface AIProvider {
  readonly name: string
  readonly defaultModel: string
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>
  chatWithTools(messages: Message[], tools: ToolDef[], options?: ChatOptions): Promise<ChatResponse>
}
