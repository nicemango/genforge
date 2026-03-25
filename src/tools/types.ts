export interface ToolResult {
  success: boolean
  output: string
  error?: string
}

export interface Tool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required?: string[]
  }
  execute(params: Record<string, unknown>): Promise<ToolResult>
}
