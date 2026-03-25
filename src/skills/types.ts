import type { TaskType } from '@prisma/client'

/**
 * 环节类型 - Pipeline 中的每个处理阶段
 * 排除 FULL_PIPELINE，因为它不是单个处理环节
 */
export type StepType = Extract<
  TaskType,
  | 'TREND_CRAWL'
  | 'TOPIC_SELECT'
  | 'RESEARCH'
  | 'WRITE'
  | 'GENERATE_IMAGES'
  | 'REVIEW'
  | 'PUBLISH'
>

/**
 * 验证状态
 */
export type VerificationStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP'

/**
 * 输入验证结果
 */
export interface InputValidation {
  valid: boolean
  issues?: string[]
  warnings?: string[]
}

/**
 * 输出验证结果
 */
export interface OutputValidation {
  valid: boolean
  issues?: string[]
  warnings?: string[]
  score?: number
}

/**
 * 验证报告
 */
export interface VerificationReport {
  status: VerificationStatus
  inputValidation: InputValidation
  outputValidation: OutputValidation
  issues: string[]
  warnings: string[]
  score?: number
  suggestions?: string[]
  step: StepType
  timestamp: Date
}

/**
 * 专家结果
 */
export interface ExpertResult {
  verificationReport: VerificationReport
  recommendations?: string[]
}

/**
 * 单个环节的质量门槛配置
 */
export interface StepQualityThreshold {
  minScore?: number
  maxRetries?: number
  blocksPipeline?: boolean
}

/**
 * 专家技能接口 - 每个环节专家需实现此接口
 */
export interface ExpertSkill {
  /** 所属环节 */
  step: StepType
  /** 专家名称 */
  name: string
  /** 描述 */
  description?: string

  /**
   * 验证输入是否符合环节预期
   */
  validateInput(input: unknown): InputValidation

  /**
   * 验证输出是否符合环节质量要求
   */
  validateOutput(input: unknown, output: unknown): OutputValidation

  /**
   * 深度评审 - 分析输入输出并给出改进建议
   */
  review(input: unknown, output: unknown): Promise<ExpertResult>
}
