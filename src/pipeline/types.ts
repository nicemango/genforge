import type { TaskType } from '@prisma/client'

export interface PipelineInput {
  accountId: string
  topicCount?: number
  topicId?: string
  /** Passed from REVIEW to WRITE on retry: the review issues to address */
  reviewFeedback?: string
  /** Number of write retries remaining (managed internally) */
  retriesLeft?: number
  /** Workspace ID for checkpoint/resume. If not provided, a new workspace is created. */
  workspaceId?: string
}

export interface PipelineStepInput extends PipelineInput {
  step: TaskType
}

export interface PipelineOutput {
  taskRunId: string
  status: 'success' | 'failed'
  output?: unknown
  error?: string
  /** Number of write attempts made (for FULL_PIPELINE) */
  attempts?: number
}
