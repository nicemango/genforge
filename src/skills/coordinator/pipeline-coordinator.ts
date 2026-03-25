import type { ExpertResult, ExpertSkill, InputValidation, OutputValidation } from '@/skills/types'
import type { PipelineStepInput } from '@/pipeline/types'
import type { StepType } from '@/skills/types'
import { ExpertSkillRegistry } from '@/skills/registry'

/**
 * PipelineCoordinator
 *
 * 负责在 Pipeline 执行过程中调用各环节 Expert 进行验证。
 * - 验证输入是否符合环节预期
 * - 验证输出是否符合质量要求
 * - 提供综合评审结果供 Pipeline 决策
 */
export class PipelineCoordinator {
  private getExpert: (step: StepType) => ExpertSkill

  /**
   * @param getExpert - 一个函数，接受 StepType，返回对应的 Expert 实例。
   *                    默认为从 ExpertSkillRegistry 获取。
   */
  constructor(
    getExpert?: (step: StepType) => ExpertSkill,
  ) {
    if (getExpert) {
      this.getExpert = getExpert
    } else {
      // Lazy import to avoid circular dependencies
      let registry: ExpertSkillRegistry | null = null
      this.getExpert = (step: StepType) => {
        if (!registry) {
          registry = new ExpertSkillRegistry()
        }
        return registry.getExpert(step)
      }
    }
  }

  /**
   * 综合评审：输入 + 输出一次性验证并返回完整报告
   */
  async review(input: PipelineStepInput, output: unknown): Promise<ExpertResult> {
    const expert = this.getExpert(input.step as StepType)
    return expert.review(input, output)
  }

  /**
   * 验证输入：检查环节执行前的参数和环境是否满足要求
   */
  validateInput(input: PipelineStepInput): { valid: boolean; issues: string[] } {
    const expert = this.getExpert(input.step as StepType)
    const result = expert.validateInput(input)
    return { valid: result.valid, issues: result.issues ?? [] }
  }

  /**
   * 验证输出：检查环节执行后的产出是否满足质量要求
   */
  validateOutput(input: PipelineStepInput, output: unknown): { valid: boolean; issues: string[] } {
    const expert = this.getExpert(input.step as StepType)
    const result = expert.validateOutput(input, output)
    return { valid: result.valid, issues: result.issues ?? [] }
  }
}
