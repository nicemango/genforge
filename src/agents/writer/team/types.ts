import type { ZodSchema } from 'zod'
import type { AIProvider } from '@/lib/providers/types'
import type { ModelConfig } from '@/lib/config'
import type { TopicSuggestion } from '@/agents/topic'
import type { ResearchResult } from '@/agents/research'
import type { WriterOutline } from '../agents/outline-editor'

// Re-export existing types from writer.ts for compatibility
export type {
  WritingStyle,
  WriterOutlineSection,
  WriterDraftSection,
  WriterRewriteStyle,
  WriterRewriteSection,
  WriterFinal,
  WriterScoreMetrics,
  WriterScoreRound,
  WriterResult,
} from '@/agents/writer'

// WriterOutline is now imported from outline-editor (uses TitleCandidate[])
export type { WriterOutline } from '../agents/outline-editor'

export const WRITER_PROMPT_VERSION = '3.0.0'

export type WriterStage = 'outline' | 'draft' | 'rewrite' | 'humanize' | 'score'

export type AgentName =
  | 'outline-editor'
  | 'draft-writer'
  | 'rewrite-editor'
  | 'humanize-editor'
  | 'score-judge'

export interface WriterContext {
  // Fixed inputs
  topic: TopicSuggestion
  research: ResearchResult
  writingStyle?: {
    tone?: string
    length?: string
    style?: string[]
    brandName?: string
    targetAudience?: string
    preferredHookMode?: 'auto' | 'A' | 'B' | 'C'
    tonePreset?: 'sharp' | 'balanced' | 'professional'
  }
  modelConfig: ModelConfig

  // Pipeline state
  outline: WriterOutline | null
  draft: import('@/agents/writer').WriterDraftSection[] | null
  rewrite: import('@/agents/writer').WriterRewriteSection[] | null
  final: import('@/agents/writer').WriterFinal | null

  // Feedback loop
  reviewFeedback: string | null
  optimizationFeedback: string | null
  attempt: number
  scores: import('@/agents/writer').WriterScoreRound[]
  passed: boolean

  // Internal
  _provider?: AIProvider
}

export interface AgentMessage {
  type: 'RESULT' | 'ERROR' | 'RETRY'
  from: AgentName
  to: 'orchestrator' | AgentName
  payload: {
    stage: WriterStage
    data?: unknown
    issues?: string[]
    error?: string
  }
}

export interface TeamConfig {
  maxAttempts: number
  temperatureByStage: Record<WriterStage, number>
}

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  maxAttempts: 3,
  temperatureByStage: {
    outline: 0.2,
    draft: 0.45,
    rewrite: 0.55,
    humanize: 0.35,
    score: 0.1,
  },
}

export interface AgentConfig {
  name: AgentName
  stage: WriterStage
  systemPrompt: string
  schema: ZodSchema<unknown>
  maxTokens: number
  temperature: number
}

export interface ScoreResult {
  metrics: import('@/agents/writer').WriterScoreMetrics
  issues: string[]
  optimizations: string[]
  passed: boolean
}
