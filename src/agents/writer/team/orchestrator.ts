import type { WriterContext } from './types'
import type { WriterResult } from '@/agents/writer'
import { WRITER_PROMPT_VERSION } from './types'
import { getContextProvider } from './context'
import { runOutlineEditor } from '../agents/outline-editor'
import { runDraftWriter } from '../agents/draft-writer'
import { runRewriteEditor } from '../agents/rewrite-editor'
import { runHumanizeEditor } from '../agents/humanize-editor'
import { runScoreJudge } from '../agents/score-judge'

const MAX_ATTEMPTS = 3

export class WriterOrchestrator {
  private context: WriterContext

  constructor(context: WriterContext) {
    this.context = context
  }

  async run(): Promise<WriterResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      this.context.attempt = attempt
      const provider = getContextProvider(this.context)

      try {
        // Run pipeline stages sequentially
        this.context.outline = await runOutlineEditor(provider, {
          context: this.context,
        })

        this.context.draft = await runDraftWriter(provider, {
          context: this.context,
          outline: this.context.outline,
        })

        this.context.rewrite = await runRewriteEditor(provider, {
          context: this.context,
          outline: this.context.outline,
          draft: this.context.draft,
        })

        this.context.final = await runHumanizeEditor(provider, {
          context: this.context,
          outline: this.context.outline,
          rewrite: this.context.rewrite,
        })

        const scoreResult = await runScoreJudge(provider, {
          final: this.context.final,
          reviewFeedback: this.context.reviewFeedback,
        })

        const scoreRound = {
          attempt: attempt + 1,
          metrics: scoreResult.metrics,
          issues: scoreResult.issues,
          optimizations: scoreResult.optimizations,
          passed: scoreResult.passed,
        }

        this.context.scores.push(scoreRound)

        if (scoreResult.passed) {
          return this.buildResult()
        }

        // Build optimization feedback for next attempt
        this.context.optimizationFeedback = [
          ...scoreResult.issues.map((issue) => `问题：${issue}`),
          ...scoreResult.optimizations.map((opt) => `优化：${opt}`),
        ].join('\n')
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        if (attempt === MAX_ATTEMPTS - 1) {
          throw error
        }
        // Extract validation error for outline failures and set as reviewFeedback
        // so the next attempt's outline prompt includes the correction context
        const isOutlineError = errorMsg.includes('大纲质量不达标') ||
                               errorMsg.includes('outline-editor')
        if (isOutlineError) {
          this.context.reviewFeedback = `【请修复上述问题后再生成大纲】${errorMsg}`
        }
        // Set optimization feedback for downstream stages
        this.context.optimizationFeedback = `执行错误：${errorMsg}`
      }
    }

    throw new Error(`${MAX_ATTEMPTS} 轮后仍未达标`)
  }

  private buildResult(): WriterResult {
    const final = this.context.final
    if (!final) {
      throw new Error('No final article generated')
    }

    const outline = this.context.outline!

    // Convert new WriterOutline (TitleCandidate[]) to legacy WriterOutline (string[])
    const legacyOutline: WriterResult['outline'] = {
      titles: outline.titles.map((t) => t.title),
      hook: outline.hook,
      sections: outline.sections,
      ending: outline.ending,
    }

    return {
      outline: legacyOutline,
      draft: this.context.draft!,
      rewrite: this.context.rewrite!,
      final,
      scores: this.context.scores,
      title: final.title,
      body: final.content,
      summary: extractSummary(final.content),
      wordCount: countChineseWords(final.content),
      promptVersion: WRITER_PROMPT_VERSION,
    }
  }
}

function extractSummary(markdown: string): string {
  const withoutTitle = markdown.replace(/^#\s+.+$/m, '').trim()
  const firstParagraph = withoutTitle.split(/\n\n+/).filter(
    (paragraph) => paragraph.trim(),
  )[0] ?? ''
  return firstParagraph.replace(/[#*`!\[\]()]/g, '').trim().slice(0, 200)
}

function countChineseWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
  const englishWords = (text.match(/[a-zA-Z]+/g)?.length ?? 0) * 2
  const digitCount = text.match(/\d/g)?.length ?? 0
  return chineseChars + englishWords + Math.ceil(digitCount * 0.5)
}
