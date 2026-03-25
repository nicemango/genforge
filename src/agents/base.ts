import {
  type AIProvider,
  type Message,
  type ContentBlock,
  type ToolDef,
  type ChatOptions,
  extractText,
  extractToolCalls,
} from '@/lib/ai'
import type { Tool } from '@/tools/types'

export interface AgentRunOptions extends ChatOptions {
  maxSteps?: number
  systemPrompt?: string
}

export interface AgentResult {
  success: boolean
  output: string
  steps: number
  toolCallCount: number
}

export class BaseAgent {
  protected tools: Map<string, Tool> = new Map()
  protected defaultMaxSteps: number

  constructor(
    protected readonly provider: AIProvider,
    options: { maxSteps?: number } = {},
  ) {
    this.defaultMaxSteps = options.maxSteps ?? 20
  }

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }

  protected buildToolDefs(): ToolDef[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  async run(task: string, options: AgentRunOptions = {}): Promise<AgentResult> {
    const maxSteps = options.maxSteps ?? this.defaultMaxSteps
    const toolDefs = this.buildToolDefs()

    const chatOptions: ChatOptions = {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      systemPrompt: options.systemPrompt,
    }

    const messages: Message[] = [{ role: 'user', content: task }]
    let totalToolCalls = 0

    for (let step = 0; step < maxSteps; step++) {
      const response = await this.provider.chatWithTools(messages, toolDefs, chatOptions)

      if (response.stopReason === 'end_turn' || response.stopReason === 'stop_sequence') {
        return {
          success: true,
          output: extractText(response),
          steps: step + 1,
          toolCallCount: totalToolCalls,
        }
      }

      if (response.stopReason === 'max_tokens') {
        throw new Error(`LLM hit max_tokens at step ${step + 1}.`)
      }

      if (response.stopReason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content })

        const toolCalls = extractToolCalls(response)
        const resultBlocks: ContentBlock[] = []

        for (const call of toolCalls) {
          const tool = this.tools.get(call.name)
          if (tool === undefined) {
            throw new Error(
              `Agent called unknown tool: "${call.name}". Registered: [${Array.from(this.tools.keys()).join(', ')}]`,
            )
          }

          const result = await tool.execute(call.input)
          totalToolCalls++

          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: result.success ? result.output : (result.error ?? result.output),
            is_error: !result.success,
          })
        }

        messages.push({ role: 'user', content: resultBlocks })
        continue
      }

      throw new Error(`Unexpected stop reason: ${response.stopReason}`)
    }

    throw new Error(`Agent exceeded max steps (${maxSteps}).`)
  }
}
