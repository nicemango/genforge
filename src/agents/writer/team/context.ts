import type { ModelConfig } from '@/lib/config'
import type { TopicSuggestion } from '@/agents/topic'
import type { ResearchResult } from '@/agents/research'
import { createAgentProvider } from '@/lib/providers/registry'
import type { AIProvider } from '@/lib/providers/types'
import type { WriterContext } from './types'

/**
 * WriterContext 工厂函数
 */
export function createWriterContext(params: {
  topic: TopicSuggestion
  research: ResearchResult
  modelConfig: ModelConfig
  writingStyle?: WriterContext['writingStyle']
  reviewFeedback?: string
}): WriterContext {
  const provider = createAgentProvider('writer', params.modelConfig)

  return {
    // Fixed inputs
    topic: params.topic,
    research: params.research,
    modelConfig: params.modelConfig,
    writingStyle: params.writingStyle,

    // Pipeline state
    outline: null,
    draft: null,
    rewrite: null,
    final: null,

    // Feedback loop
    reviewFeedback: params.reviewFeedback ?? null,
    optimizationFeedback: null,
    attempt: 0,
    scores: [],
    passed: false,

    // Internal
    _provider: provider,
  }
}

/**
 * 获取当前使用的 AI Provider
 */
export function getContextProvider(context: WriterContext): AIProvider {
  if (!context._provider) {
    context._provider = createAgentProvider('writer', context.modelConfig)
  }
  return context._provider
}

/**
 * 根据 attempt 动态调整 temperature
 */
export function getTemperature(
  baseTemp: number,
  attempt: number,
  stage: 'outline' | 'draft' | 'rewrite' | 'humanize',
): number {
  if (attempt >= 2) {
    // Reduce temperature on retry attempts to be more focused
    const reductions: Record<string, number> = {
      outline: 0.1,
      draft: 0.2,
      rewrite: 0.25,
      humanize: 0.15,
    }
    return Math.max(0.1, baseTemp - (reductions[stage] ?? 0.1))
  }
  return baseTemp
}
