import type { ExpertSkill, StepType } from './types'
import { trendExpert } from './experts/trend-expert'
import { topicExpert } from './experts/topic-expert'
import { ResearchExpert } from './experts/research-expert'
import { WriteExpert } from './experts/write-expert'
import { imageExpert } from './experts/image-expert'
import { reviewExpert } from './experts/review-expert'
import { publishExpert } from './experts/publish-expert'

/**
 * 环节专家注册表
 * 负责管理所有环节专家的注册与查询
 */
export class ExpertSkillRegistry {
  private experts = new Map<StepType, ExpertSkill>()

  constructor() {
    this.registerDefaultExperts()
  }

  /**
   * 注册专家到指定环节
   */
  registerExpert(step: StepType, expert: ExpertSkill): void {
    if (expert.step !== step) {
      throw new Error(
        `Expert step mismatch: expected ${step}, got ${expert.step}`,
      )
    }
    this.experts.set(step, expert)
  }

  /**
   * 获取指定环节的专家
   */
  getExpert(step: StepType): ExpertSkill {
    const expert = this.experts.get(step)
    if (!expert) {
      throw new Error(`No expert registered for step: ${step}`)
    }
    return expert
  }

  /**
   * 检查是否已注册指定环节的专家
   */
  hasExpert(step: StepType): boolean {
    return this.experts.has(step)
  }

  /**
   * 列出所有已注册的专家
   */
  listExperts(): ExpertSkill[] {
    return Array.from(this.experts.values())
  }

  /**
   * 注册所有环节专家
   */
  private registerDefaultExperts(): void {
    this.registerExpert(trendExpert.step, trendExpert)
    this.registerExpert(topicExpert.step, topicExpert)
    this.registerExpert('RESEARCH' as StepType, new ResearchExpert())
    this.registerExpert('WRITE' as StepType, new WriteExpert())
    this.registerExpert(imageExpert.step, imageExpert)
    this.registerExpert(reviewExpert.step, reviewExpert)
    this.registerExpert(publishExpert.step, publishExpert)
  }
}
