import type { ChatResponse } from './types'

export function extractText(response: ChatResponse): string {
  return response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text!)
    .join('')
}

export function extractToolCalls(
  response: ChatResponse,
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return response.content
    .filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    )
    .map((b) => ({ id: b.id!, name: b.name!, input: b.input! }))
}
