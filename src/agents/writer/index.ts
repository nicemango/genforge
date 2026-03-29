/**
 * Writer Agent Team
 *
 * 多 Agent 协作的 Writer 实现：
 * - outline-editor: 设计文章骨架
 * - draft-writer: 基于骨架扩写初稿
 * - rewrite-editor: 生成三种风格改写
 * - humanize-editor: 整合改写版本 + 品牌 voice + 配图占位符
 * - score-judge: 四维评分 + 结构化反馈
 *
 * 通过 WRITER_TEAM_ENABLED=true 环境变量切换。
 */

import type { ModelConfig } from '@/lib/config'
import type { TopicSuggestion } from '@/agents/topic'
import type { ResearchResult } from '@/agents/research'
import { createWriterContext } from './team/context'
import { WriterOrchestrator } from './team/orchestrator'
import {
  type WritingStyle,
  type WriterOutlineSection,
  type WriterOutline,
  type WriterDraftSection,
  type WriterRewriteStyle,
  type WriterRewriteSection,
  type WriterFinal,
  type WriterScoreMetrics,
  type WriterScoreRound,
  type WriterResult,
  WRITER_PROMPT_VERSION,
  // Legacy function from original writer.ts
  runWriterAgentLegacy,
} from '../writer-legacy'

// Re-export all types and constants for backward compatibility
export {
  WRITER_PROMPT_VERSION,
  type WritingStyle,
  type WriterOutlineSection,
  type WriterOutline,
  type WriterDraftSection,
  type WriterRewriteStyle,
  type WriterRewriteSection,
  type WriterFinal,
  type WriterScoreMetrics,
  type WriterScoreRound,
  type WriterResult,
}

/**
 * Run Writer using the new Team architecture
 */
export async function runWriterTeam(
  topic: TopicSuggestion,
  research: ResearchResult,
  modelConfig: ModelConfig,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
): Promise<WriterResult> {
  const context = createWriterContext({
    topic,
    research,
    modelConfig,
    writingStyle,
    reviewFeedback,
  })

  const orchestrator = new WriterOrchestrator(context)
  return orchestrator.run()
}

/**
 * Writer Agent entry point
 *
 * 通过 WRITER_TEAM_ENABLED=true 环境变量切换新旧实现：
 * - true: 使用新的 Team 架构 (runWriterTeam)
 * - false/undefined: 使用原有的单体实现 (runWriterAgentLegacy)
 */
export async function runWriterAgent(
  topic: TopicSuggestion,
  research: ResearchResult,
  modelConfig: ModelConfig,
  writingStyle?: WritingStyle,
  reviewFeedback?: string,
  attempt?: number,
): Promise<WriterResult> {
  if (process.env.WRITER_TEAM_ENABLED === 'true') {
    return runWriterTeam(topic, research, modelConfig, writingStyle, reviewFeedback)
  }

  return runWriterAgentLegacy(
    topic,
    research,
    modelConfig,
    writingStyle,
    reviewFeedback,
    attempt,
  )
}
