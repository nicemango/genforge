import { prisma } from "@/lib/prisma";
import type { ModelConfig } from "@/lib/ai";
import { getDefaultModelConfig, listConfiguredProviderModelConfigs } from "@/config/llm";
import type { WritingStyle } from "@/agents/writer";
import { runTrendAgent } from "@/agents/trend";
import { runTopicAgent } from "@/agents/topic";
import { runResearchAgent } from "@/agents/research";
import { runWriterAgent, WRITER_PROMPT_VERSION } from "@/agents/writer";
import { runImageAgent } from "@/agents/image";
import {
  runReviewAgent,
  type WriterBrief,
  type DimensionScores,
} from "@/agents/review";
import { runPublishAgent } from "@/agents/publisher";
import { DEFAULT_QUALITY_CONFIG, type QualityConfig } from "@/lib/config";
import { parseAccountJsonField, parseWechatConfig } from "@/lib/json";
import { replaceImageSlots } from "@/lib/image-plan";
import type { PipelineInput, PipelineOutput, PipelineStepInput } from "./types";
import type { TaskType } from "@prisma/client";
import { PipelineCoordinator } from "@/skills/coordinator/pipeline-coordinator";
import { workspaceManager, type AgentType } from "@/lib/workspace";
import { uploadImage } from "@/lib/wechat";
import { notifyTaskRunFailure, notifyPipelineComplete } from "@/lib/notifications";
import { createAgentProvider } from "@/lib/providers/registry";

/**
 * Safely parse a JSON string field from Account.
 * Throws with field name and original error on failure.
 */
function parseAccountJSON<T>(json: string, fieldName: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse account.${fieldName}: ${err instanceof Error ? err.message : String(err)}. Raw value: "${json.slice(0, 200)}"`,
    );
  }
}

/**
 * Safely parse a TaskRun output/input JSON field.
 * Throws with context about which task run and field failed.
 */
function parseTaskRunJSON<T>(json: string | null, taskRunId: string, fieldName: string): T {
  if (!json) {
    throw new Error(`TaskRun ${taskRunId} has null ${fieldName}.`);
  }
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse TaskRun(${taskRunId}).${fieldName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface WritingStyleJson {
  tone?: string;
  length?: string;
  style?: string[];
}

type AgentModelProbe = "trend" | "topic" | "research" | "writer" | "review" | "image";

const MODEL_CONFIG_CACHE = new Map<string, Promise<ModelConfig>>();

function getProbeAgent(step: PipelineStepInput["step"]): AgentModelProbe | null {
  switch (step) {
    case "TOPIC_SELECT":
      return "topic";
    case "RESEARCH":
      return "research";
    case "WRITE":
      return "writer";
    case "REVIEW":
      return "review";
    case "GENERATE_IMAGES":
      return "image";
    case "FULL_PIPELINE":
      return "topic";
    default:
      return null;
  }
}

function buildModelCandidates(modelConfig: ModelConfig): Array<{ label: string; modelConfig: ModelConfig }> {
  const candidates: Array<{ label: string; modelConfig: ModelConfig }> = []
  const seen = new Set<string>()

  const pushCandidate = (label: string, candidate: ModelConfig) => {
    const providerType = candidate.defaultProviderType ?? candidate.provider
    const model = candidate.defaultModel ?? candidate.model ?? ""
    const key = `${providerType}|${candidate.baseURL ?? ""}|${model}|${candidate.apiKey ? "with-key" : "no-key"}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ label, modelConfig: candidate })
  }

  pushCandidate("account-config", modelConfig)

  for (const configured of listConfiguredProviderModelConfigs()) {
    pushCandidate(`provider:${configured.name}`, configured.modelConfig)
  }

  return candidates
}

function summarizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes("AccountQuotaExceeded")) {
    return "quota exceeded"
  }
  if (message.includes("Request not allowed")) {
    return "request not allowed"
  }
  if (message.includes("API key not set")) {
    return "missing API key"
  }
  if (message.includes("not support model")) {
    return "plan does not support model"
  }
  if (message.includes("UnsupportedModel")) {
    return "model unsupported by endpoint"
  }

  return message.replace(/\s+/g, " ").slice(0, 160)
}

async function probeModelConfig(agentName: AgentModelProbe, modelConfig: ModelConfig): Promise<void> {
  const provider = createAgentProvider(agentName, modelConfig)
  await provider.chat(
    [{ role: "user", content: "Reply with exactly OK" }],
    { maxTokens: 8, temperature: 0 },
  )
}

async function resolveUsableModelConfig(
  accountId: string,
  step: PipelineStepInput["step"],
  modelConfig: ModelConfig,
): Promise<ModelConfig> {
  const probeAgent = getProbeAgent(step)
  if (!probeAgent) {
    return modelConfig
  }

  const cacheKey = `${accountId}:${probeAgent}`
  const cached = MODEL_CONFIG_CACHE.get(cacheKey)
  if (cached) {
    return cached
  }

  const resolving = (async () => {
    const errors: string[] = []

    for (const candidate of buildModelCandidates(modelConfig)) {
      const candidateModel = candidate.modelConfig.defaultModel ?? candidate.modelConfig.model
      if (!candidate.modelConfig.apiKey || !candidateModel) {
        errors.push(`${candidate.label}: incomplete credentials`)
        continue
      }

      try {
        await probeModelConfig(probeAgent, candidate.modelConfig)
        if (candidate.label !== "account-config") {
          console.warn(
            `[ModelPreflight] ${probeAgent} falling back from account config to ${candidate.label}.`,
          )
        }
        return candidate.modelConfig
      } catch (error) {
        errors.push(`${candidate.label}: ${summarizeProviderError(error)}`)
      }
    }

    throw new Error(
      `No usable model provider for ${probeAgent}. Tried ${errors.length} candidate(s): ${errors.join(" | ")}`,
    )
  })()

  MODEL_CONFIG_CACHE.set(cacheKey, resolving)

  try {
    return await resolving
  } catch (error) {
    MODEL_CONFIG_CACHE.delete(cacheKey)
    throw error
  }
}


export async function runStep(
  input: PipelineStepInput,
): Promise<PipelineOutput> {
  const { accountId, step } = input;
  const startedAt = new Date();

  const taskRun = await prisma.taskRun.create({
    data: {
      accountId,
      taskType: step,
      status: "RUNNING",
      input: JSON.stringify(input),
      parentRunId: input.parentRunId,
    },
  });

  try {
    const output = await executeStep(input, taskRun.id);

    await prisma.taskRun.update({
      where: { id: taskRun.id },
      data: {
        status: "SUCCESS",
        output: JSON.stringify(output),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });

    return { taskRunId: taskRun.id, status: "success", output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    await prisma.taskRun.update({
      where: { id: taskRun.id },
      data: {
        status: "FAILED",
        error,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });

    return { taskRunId: taskRun.id, status: "failed", error };
  }
}

async function executeStep(
  input: PipelineStepInput,
  currentTaskRunId?: string,
): Promise<unknown> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
  });

  let modelConfig = parseAccountJSON<ModelConfig>(account.modelConfig, "modelConfig");
  const writingStyle = parseAccountJSON<WritingStyle>(account.writingStyle, "writingStyle");
  const qualityConfig: QualityConfig = {
    ...DEFAULT_QUALITY_CONFIG,
    ...parseAccountJsonField<Partial<QualityConfig>>(account.qualityConfig, "qualityConfig", {}),
  };
  const wechatConfig = parseWechatConfig(account.wechatConfig)

  // Fall back to .env / llm-providers.json when account config doesn't provide credentials
  if (!modelConfig.apiKey && !modelConfig.defaultModel) {
    // Prefer DEFAULT_AI_* env vars if set, otherwise use llm-providers.json defaults
    const envApiKey = process.env.DEFAULT_AI_API_KEY
    if (envApiKey) {
      modelConfig = {
        ...modelConfig,
        defaultProviderType:
          (process.env.DEFAULT_AI_PROVIDER_TYPE as "anthropic" | "openai") ??
          "anthropic",
        apiKey: envApiKey,
        baseURL: process.env.DEFAULT_AI_BASE_URL,
        defaultModel: process.env.DEFAULT_AI_MODEL,
      }
    } else {
      // Use llm-providers.json default provider
      modelConfig = {
        ...modelConfig,
        ...getDefaultModelConfig(),
      }
    }
  }

  modelConfig = await resolveUsableModelConfig(input.accountId, input.step, modelConfig)

  // Initialize coordinator (skip for FULL_PIPELINE as it calls runStep recursively)
  const isFullPipeline = input.step === "FULL_PIPELINE"
  const coordinator = isFullPipeline ? null : new PipelineCoordinator()

  /**
   * Validate step output using the PipelineCoordinator.
   * - BLOCKER issues → throw and abort
   * - WARN status → log and continue
   * - FAIL with non-blocking step → log and continue
   */
  function validateStepOutput(
    stepInput: PipelineStepInput,
    output: unknown,
    blocking: boolean,
  ): void {
    if (!coordinator) return
    try {
      const validation = coordinator.validateOutput(stepInput, output)
      if (!validation.valid) {
        const issues = validation.issues ?? []
        if (blocking) {
          throw new Error(
            `[${stepInput.step}] Output validation failed: ${issues.join("; ")}`,
          )
        }
        console.warn(
          `[${stepInput.step}] Output validation warnings: ${issues.join("; ")}`,
        )
      } else {
        console.info(`[${stepInput.step}] Expert validation passed.`)
      }
    } catch (err) {
      // Expert not yet implemented — skip validation
      if (
        err instanceof Error &&
        err.message.includes("not implemented")
      ) {
        return
      }
      if (blocking) throw err
      console.warn(`[${stepInput.step}] Expert review error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  switch (input.step) {
    case "TREND_CRAWL": {
      const result = await runTrendAgent(undefined, (info) => {
        input.onProgress?.({
          phase: 'crawling',
          current: info.current,
          total: info.total,
          message: info.sourceName ? `${info.sourceName} (${info.current}/${info.total})` : `${info.current}/${info.total}`,
        })
      });
      validateStepOutput(input, result, true);
      return {
        itemCount: result.items.length,
        fetchedAt: result.fetchedAt,
        items: result.items,
        topicFiltered: result.stats.topicFiltered,
      };
    }

    case "TOPIC_SELECT": {
      const lastTrendRun = await prisma.taskRun.findFirst({
        where: {
          accountId: input.accountId,
          taskType: "TREND_CRAWL",
          status: "SUCCESS",
        },
        orderBy: { finishedAt: "desc" },
      });

      if (!lastTrendRun) {
        throw new Error(
          "No successful TREND_CRAWL run found. Run trend crawl first.",
        );
      }

      const trendOutput = parseTaskRunJSON<{
        items: Array<{
          title: string;
          link: string;
          pubDate: string;
          snippet: string;
          source: string;
        }>;
      }>(lastTrendRun.output, lastTrendRun.id, "output");
      const result = await runTopicAgent(
        trendOutput.items,
        modelConfig,
        input.topicCount != null ? { count: input.topicCount } : undefined,
      );

      // V2: 存储新的洼地策略字段
      const created = await Promise.all(
        result.topics.map((t) =>
          prisma.topic.create({
            data: {
              accountId: input.accountId,
              title: t.title,
              angle: t.angle,
              summary: t.summary,
              heatScore: t.heatScore,
              valueScore: t.valueScore,
              redSeaLevel: t.redSeaLevel,
              contrarianAngle: t.contrarianAngle,
              timeToMainstream: t.timeToMainstream,
              selectionStrategy: result.strategy,
              tags: JSON.stringify(t.tags),
              sources: JSON.stringify(t.sources),
              status: "PENDING",
            },
          }),
        ),
      );

      const topicResult = {
        topics: result.topics,
        topicCount: created.length,
        topicIds: created.map((t) => t.id),
        strategy: result.strategy,
      };
      validateStepOutput(input, topicResult, true);
      return topicResult;
    }

    case "RESEARCH": {
      if (!input.topicId)
        throw new Error("topicId is required for RESEARCH step.");

      const topic = await prisma.topic.findUniqueOrThrow({
        where: { id: input.topicId },
      });

      await prisma.topic.update({
        where: { id: input.topicId },
        data: { status: "IN_PROGRESS" },
      });

      const topicSuggestion = {
        title: topic.title,
        angle: topic.angle,
        summary: topic.summary,
        heatScore: topic.heatScore,
        valueScore: topic.valueScore,
        redSeaLevel: topic.redSeaLevel as "LOW" | "MEDIUM" | "HIGH",
        contrarianAngle: topic.contrarianAngle,
        timeToMainstream: topic.timeToMainstream as "NOW" | "WEEKS" | "MONTHS",
        tags: JSON.parse(topic.tags) as string[],
        sources: JSON.parse(topic.sources) as Array<{
          title: string;
          url: string;
          source: string;
        }>,
      };

      const result = await runResearchAgent(topicSuggestion, modelConfig);

      const researchResult = {
        topicId: input.topicId,
        summary: result.summary,
        researchSummary: result.summary,
        keyPointCount: result.keyPoints.length,
        keyPoints: result.keyPoints,
        sources: result.sources,
        rawOutput: result.rawOutput,
      };
      validateStepOutput(input, researchResult, false);
      return researchResult;
    }

    case "WRITE": {
      if (!input.topicId)
        throw new Error("topicId is required for WRITE step.");

      const topic = await prisma.topic.findUniqueOrThrow({
        where: { id: input.topicId },
      });

      const lastResearchRun = await prisma.taskRun.findFirst({
        where: {
          accountId: input.accountId,
          taskType: "RESEARCH",
          status: "SUCCESS",
        },
        orderBy: { finishedAt: "desc" },
      });

      if (!lastResearchRun) {
        throw new Error(
          "No successful RESEARCH run found. Run research first.",
        );
      }

      const researchOutput = parseTaskRunJSON<{
        topicId: string;
      }>(lastResearchRun.output, lastResearchRun.id, "output");
      if (researchOutput.topicId !== input.topicId) {
        throw new Error(
          `Latest research run is for topic ${researchOutput.topicId}, not ${input.topicId}.`,
        );
      }

      const researchRun = await prisma.taskRun.findFirstOrThrow({
        where: {
          accountId: input.accountId,
          taskType: "RESEARCH",
          status: "SUCCESS",
          output: { contains: input.topicId },
        },
        orderBy: { finishedAt: "desc" },
      });

      const topicSuggestion = {
        title: topic.title,
        angle: topic.angle,
        summary: topic.summary,
        heatScore: topic.heatScore,
        valueScore: topic.valueScore,
        redSeaLevel: topic.redSeaLevel as "LOW" | "MEDIUM" | "HIGH",
        contrarianAngle: topic.contrarianAngle,
        timeToMainstream: topic.timeToMainstream as "NOW" | "WEEKS" | "MONTHS",
        tags: JSON.parse(topic.tags) as string[],
        sources: JSON.parse(topic.sources) as Array<{
          title: string;
          url: string;
          source: string;
        }>,
      };

      const fullResearchOutput = await prisma.taskRun.findFirstOrThrow({
        where: { id: researchRun.id },
      });

      const researchTaskOutput = parseTaskRunJSON<{
        summary?: string;
        researchSummary?: string;
        keyPoints?: string[];
        sources?: Array<{ title: string; url: string; verified: boolean }>;
        rawOutput?: string;
      }>(fullResearchOutput.output, fullResearchOutput.id, "output");

      const researchResult = {
        summary: researchTaskOutput.researchSummary ?? researchTaskOutput.summary ?? "",
        keyPoints: researchTaskOutput.keyPoints ?? [],
        sources: researchTaskOutput.sources ?? topicSuggestion.sources.map((s) => ({
          title: s.title,
          url: s.url,
          verified: false,
        })),
        rawOutput: researchTaskOutput.rawOutput ?? fullResearchOutput.output ?? "",
      };

      const result = await runWriterAgent(
        topicSuggestion,
        researchResult,
        modelConfig,
        writingStyle,
        input.reviewFeedback,
        input.writeAttempts, // 0 = first, 1 = retry, 2 = last try
      );

      const content = await prisma.content.create({
        data: {
          accountId: input.accountId,
          topicId: input.topicId,
          title: result.title,
          body: result.body,
          summary: result.summary,
          wordCount: result.wordCount,
          writerPromptVersion: WRITER_PROMPT_VERSION,
          status: "DRAFT",
        },
      });

      await prisma.topic.update({
        where: { id: input.topicId },
        data: { status: "DONE" },
      });

      const writeResult = {
        contentId: content.id,
        ...result,
      };
      validateStepOutput(input, writeResult, false);
      return writeResult;
    }

    case "GENERATE_IMAGES": {
      if (!input.topicId)
        throw new Error("topicId is required for GENERATE_IMAGES step.");

      const content = await prisma.content.findFirst({
        where: {
          accountId: input.accountId,
          topicId: input.topicId,
          status: "DRAFT",
        },
        orderBy: { createdAt: "desc" },
      });

      if (!content)
        throw new Error(`No DRAFT content found for topic ${input.topicId}.`);

      // If MiniMax is absent, the image agent will degrade AI slots to template cards.
      const minimaxApiKey =
        modelConfig.minimaxApiKey ?? process.env.MINIMAX_API_KEY ?? undefined;

      const result = await runImageAgent(
        content.title,
        content.body,
        minimaxApiKey,
        modelConfig,
        {
          writingStyle,
          layoutConfig: {
            themeId: wechatConfig.themeId,
            brandName: wechatConfig.brandName ?? writingStyle.brandName,
            primaryColor: wechatConfig.primaryColor,
            accentColor: wechatConfig.accentColor,
            titleAlign: wechatConfig.titleAlign,
            showEndingCard: wechatConfig.showEndingCard,
            endingCardText: wechatConfig.endingCardText,
            imageStyle: wechatConfig.imageStyle,
          },
        },
      );

      // Upload images to WeChat permanent material and get URLs
      const imageUploadResults = await Promise.allSettled(
        result.assets.map(async (img) => {
          if (!img.imageBase64) {
            return { ...img, url: img.url, uploadStatus: 'failed' as const }
          }
          try {
            const url = await uploadImage(input.accountId, img.imageBase64)
            return {
              ...img,
              url,
              uploadStatus: 'uploaded' as const,
              qualityStatus: img.qualityStatus === 'downgraded' ? 'downgraded' as const : 'passed' as const,
            }
          } catch (err) {
            console.warn(`[GENERATE_IMAGES] Failed to upload image to WeChat: ${err instanceof Error ? err.message : String(err)}`)
            const fallbackUrl = img.imageBase64 ? `data:${img.mimeType};base64,${img.imageBase64}` : img.url
            return {
              ...img,
              url: fallbackUrl,
              uploadStatus: 'inline' as const,
              qualityStatus: img.qualityStatus ?? 'failed',
              fallbackReason: img.fallbackReason ?? 'Image upload failed; kept inline data URL',
            }
          }
        }),
      )

      // Extract successful uploads
      const imageData: typeof result.assets = []
      for (const uploadResult of imageUploadResults) {
        if (uploadResult.status === 'fulfilled') {
          imageData.push(uploadResult.value)
        }
      }

      const placeholders = content.body.match(/!\[[^\]]*\]\(image:(?:cover|section-\d+|para-\d+)\)/g) ?? []
      if (placeholders.length !== result.assets.length) {
        console.warn(
          `[GENERATE_IMAGES] Placeholder/image count mismatch: ${placeholders.length} placeholders in body, ${result.assets.length} assets planned.`,
        )
      }

      const updatedBody = replaceImageSlots(content.body, imageData)

      await prisma.content.update({
        where: { id: content.id },
        data: {
          body: updatedBody,
          images: JSON.stringify(imageData),
        },
      });

      const imageResult = {
        contentId: content.id,
        imageCount: imageData.length,
        imagePlan: result.imagePlan,
        assets: imageData,
      };
      // GENERATE_IMAGES is non-blocking: failures are logged but don't halt pipeline
      validateStepOutput(input, imageResult, false);
      return imageResult;
    }

    case "REVIEW": {
      if (!input.topicId)
        throw new Error("topicId is required for REVIEW step.");

      const content = await prisma.content.findFirst({
        where: {
          accountId: input.accountId,
          topicId: input.topicId,
          status: "DRAFT",
        },
        orderBy: { createdAt: "desc" },
      });

      if (!content)
        throw new Error(`No DRAFT content found for topic ${input.topicId}.`);

      await prisma.content.update({
        where: { id: content.id },
        data: { status: "REVIEWING" },
      });

      const result = await runReviewAgent(
        content.title,
        content.body,
        modelConfig,
        true,
      );

      const finalBody = result.fixedBody ?? content.body;
      const passed = result.score >= qualityConfig.minScore;
      const newStatus = passed ? "READY" : "REJECTED";

      await prisma.content.update({
        where: { id: content.id },
        data: {
          status: newStatus,
          body: finalBody,
          reviewNotes: JSON.stringify({
            score: result.score,
            issues: result.issues,
            suggestions: result.suggestions,
          }),
        },
      });

      // Write quality record for tracking
      const imagesData = JSON.parse(content.images || "[]") as Array<unknown>;
      await prisma.qualityRecord.create({
        data: {
          accountId: input.accountId,
          topicId: input.topicId,
          contentId: content.id,
          score: result.score,
          passed,
          issues: JSON.stringify(result.issues ?? []),
          suggestions: JSON.stringify(result.suggestions ?? []),
          wordCount: content.wordCount,
          imageCount: imagesData.length,
          writeAttempts:
            (input as PipelineStepInput & { writeAttempts?: number })
              .writeAttempts ?? 1,
          writerPromptVersion: content.writerPromptVersion,
        },
      });

      const reviewResult = {
        contentId: content.id,
        passed,
        score: result.score,
        dimensionScores: result.dimensionScores,
        issues: result.issues,
        suggestions: result.suggestions,
        writerBrief: result.writerBrief,
      };
      validateStepOutput(input, reviewResult, true);
      return reviewResult;
    }

    case "PUBLISH": {
      if (!input.topicId)
        throw new Error("topicId is required for PUBLISH step.");

      const content = await prisma.content.findFirst({
        where: {
          accountId: input.accountId,
          topicId: input.topicId,
          status: "READY",
        },
        orderBy: { createdAt: "desc" },
      });

      if (!content)
        throw new Error(`No READY content found for topic ${input.topicId}.`);

      const result = await runPublishAgent(
        input.accountId,
        content.title,
        content.body,
        content.summary,
        { contentId: content.id },
      );

      await prisma.content.update({
        where: { id: content.id },
        data: {
          status: "PUBLISHED",
          wechatMediaId: result.mediaId,
          publishedAt: new Date(result.publishedAt),
        },
      });

      const publishResult = { contentId: content.id, mediaId: result.mediaId, publishedAt: result.publishedAt };
      validateStepOutput(input, publishResult, true);
      return publishResult;
    }

    case "FULL_PIPELINE": {
      // Idempotency check: skip if there's already a RUNNING pipeline for this account
      const existingRunning = await prisma.taskRun.findFirst({
        where: {
          accountId: input.accountId,
          taskType: "FULL_PIPELINE",
          status: "RUNNING",
          id: currentTaskRunId ? { not: currentTaskRunId } : undefined,
        },
      });

      if (existingRunning) {
        throw new Error(
          `Pipeline is already running (taskRunId: ${existingRunning.id}).`,
        );
      }

      // Workspace management: check for resumable workspace or create new one
      let workspaceId = input.workspaceId
      let currentStep: AgentType = "trend"
      const previousOutputs: Record<string, unknown> = {}
      let topicBatch: Record<string, AgentType[]> = {}

      if (workspaceId) {
        const existingWorkspace = await workspaceManager.get(workspaceId)
        if (existingWorkspace?.status === "running" && existingWorkspace.currentStep) {
          // Resume from checkpoint
          const resumeResult = await workspaceManager.resume(workspaceId)
          currentStep = resumeResult.currentStep
          Object.assign(previousOutputs, resumeResult.previousOutputs)
          topicBatch = resumeResult.topicBatch
          console.log(`[FULL_PIPELINE] Resuming from workspace ${workspaceId} at step ${currentStep}`)
          console.log(`[FULL_PIPELINE] Topic batch: ${JSON.stringify(topicBatch)}`)
        } else {
          // Workspace exists but not resumable, create new one
          const newWorkspace = await workspaceManager.create(input.accountId, workspaceId)
          workspaceId = newWorkspace.id
        }
      } else {
        // No workspaceId provided, create new workspace
        const newWorkspace = await workspaceManager.create(input.accountId)
        workspaceId = newWorkspace.id
      }

      // Helper to get compound step key for per-topic steps
      const perTopicKey = (step: AgentType, topicId: string) => `${step}:${topicId}`

      // Helper to checkpoint step output to workspace
      const checkpointStep = async (step: AgentType, output: unknown, topicId?: string) => {
        if (workspaceId) {
          const effectiveStep = topicId ? (perTopicKey(step, topicId) as AgentType) : step
          // Write step-specific output files
          if (step === "trend") {
            const trendOutput = output as { items?: unknown[] }
            if (trendOutput.items) {
              await workspaceManager.writeOutput(workspaceId, step, "items.json", JSON.stringify(trendOutput.items, null, 2))
            }
          } else if (step === "topic") {
            await workspaceManager.writeOutput(workspaceId, step, "topics.json", JSON.stringify(output, null, 2))
          } else if (step === "research") {
            const researchOutput = output as { researchSummary?: string; rawOutput?: string }
            if (researchOutput.researchSummary) {
              await workspaceManager.writeOutput(workspaceId, step, "summary.md", researchOutput.researchSummary)
            }
            if (researchOutput.rawOutput) {
              await workspaceManager.writeOutput(workspaceId, step, "research-full.md", researchOutput.rawOutput)
            }
            await workspaceManager.writeOutput(workspaceId, step, "output.json", JSON.stringify(output, null, 2))
          } else if (step === "write") {
            const writeOutput = output as { body?: string; title?: string }
            if (writeOutput.body) {
              await workspaceManager.writeOutput(workspaceId, step, "final.md", writeOutput.body)
            }
            await workspaceManager.writeOutput(workspaceId, step, "output.json", JSON.stringify(output, null, 2))
          } else if (step === "images") {
            await workspaceManager.writeOutput(workspaceId, step, "output.json", JSON.stringify(output, null, 2))
          } else if (step === "review") {
            await workspaceManager.writeOutput(workspaceId, step, "review.json", JSON.stringify(output, null, 2))
          }
          // Create checkpoint in run.json (with topicId for per-topic steps)
          await workspaceManager.checkpoint(workspaceId, step, output, topicId)
        }
      }

      // Helper to run a step with workspace context
      const runStepWithWorkspace = async (step: TaskType, stepInput: Partial<PipelineStepInput>, stepAgentType: AgentType, topicId?: string): Promise<PipelineOutput> => {
        const cacheKey = topicId ? perTopicKey(stepAgentType, topicId) : stepAgentType
        // Progress reporter: writes to workspace so UI can poll
        const onProgress = async (info: { phase: string; current: number; total: number; message?: string }) => {
          if (workspaceId) {
            await workspaceManager.writeProgress(workspaceId, {
              phase: info.phase,
              current: info.current,
              total: info.total,
              message: info.message,
            })
          }
        }
        // For resumed steps, try to use previous output if available
        if (previousOutputs[cacheKey]) {
          console.log(`[FULL_PIPELINE] Skipping step ${step}${topicId ? ` for topic ${topicId}` : ''} (using cached output from workspace)`)
          return {
            taskRunId: "",
            status: "success",
            output: previousOutputs[cacheKey],
          }
        }
        const result = await runStep({ ...input, ...stepInput, step, workspaceId, parentRunId: currentTaskRunId, onProgress } as PipelineStepInput)
        if (result.status === "failed") {
          if (workspaceId) {
            await workspaceManager.setStatus(workspaceId, "failed")
          }
          throw new Error(`${step} failed: ${result.error}`)
        }
        await checkpointStep(stepAgentType, result.output, topicId)
        return result
      }

      try {
        // Phase 1: Trend -> Topic (global steps, run once)
        if (currentStep === "trend") {
          const trendResult = await runStepWithWorkspace("TREND_CRAWL", {}, "trend")
          if (trendResult.status === "failed")
            throw new Error(`TREND_CRAWL failed: ${trendResult.error}`)
        }

        if (currentStep === "trend" || currentStep === "topic") {
          const topicResult = await runStepWithWorkspace("TOPIC_SELECT", {}, "topic")
          if (topicResult.status === "failed")
            throw new Error(`TOPIC_SELECT failed: ${topicResult.error}`)
        }

        // Get all topicIds from workspace
        const storedTopicOutput = (await workspaceManager.readPreviousOutput(workspaceId!, "topic")) as { topicIds?: string[] } | null
        const topicIds = storedTopicOutput?.topicIds ?? []
        if (topicIds.length === 0) throw new Error("No topics generated.")
        console.log(`[FULL_PIPELINE] Generated ${topicIds.length} topics: ${topicIds.join(", ")}`)

        // Phase 2: Process each topic sequentially
        let firstSuccessfulResult: { topicId: string; writeOutput: unknown; reviewOutput: unknown; attempts: number } | null = null
        const failedTopics: Array<{ topicId: string; error: string }> = []

        for (const topicId of topicIds) {
          const completedStepsForTopic = topicBatch[topicId] ?? []

          // Skip topics that have already passed publish
          if (completedStepsForTopic.includes("publish")) {
            console.log(`[FULL_PIPELINE] Topic ${topicId} already completed, skipping`)
            continue
          }

          console.log(`[FULL_PIPELINE] Processing topic ${topicId} (completed steps: ${completedStepsForTopic.join(", ") || "none"})`)

          try {
            // RESEARCH for this topic
            if (!completedStepsForTopic.includes("research")) {
              const researchResult = await runStepWithWorkspace("RESEARCH", { topicId }, "research", topicId)
              if (researchResult.status === "failed")
                throw new Error(`RESEARCH failed: ${researchResult.error}`)
            }

            // WRITE with retry loop for this topic
            const maxRetries = qualityConfig.maxWriteRetries
            let lastWriteOutput: unknown = null
            let lastReviewOutput: unknown = null
            let reviewFeedback: string | undefined = undefined
            let topicSucceeded = false

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              console.log(`[FULL_PIPELINE] Topic ${topicId}: Attempt ${attempt + 1}/${maxRetries + 1}`)

              if (attempt < maxRetries) {
                // 第 0 次和第 1 次：正常 WRITE
                const writeStepInput =
                  attempt === 0
                    ? { step: "WRITE" as const, topicId }
                    : {
                        step: "WRITE" as const,
                        topicId,
                        reviewFeedback,
                        writeAttempts: attempt + 1,
                      }

                const cacheKey = perTopicKey("write", topicId)
                // Check if we should use cached write output on retry
                if (attempt > 0 && previousOutputs[cacheKey]) {
                  console.log(`[FULL_PIPELINE] Topic ${topicId}: Using cached write output for attempt ${attempt}`)
                  lastWriteOutput = previousOutputs[cacheKey]
                } else {
                  const writeResult = await runStepWithWorkspace("WRITE", writeStepInput, "write", topicId)
                  if (writeResult.status === "failed")
                    throw new Error(`WRITE failed: ${writeResult.error}`)
                  lastWriteOutput = writeResult.output
                }

                // GENERATE_IMAGES: skip on failure, non-blocking
                const imageCacheKey = perTopicKey("images", topicId)
                if (!previousOutputs[imageCacheKey] && !completedStepsForTopic.includes("images")) {
                  const imageResult = await runStep({
                    ...input,
                    step: "GENERATE_IMAGES",
                    topicId,
                    workspaceId,
                  })
                  if (imageResult.status === "failed") {
                    console.warn(`[FULL_PIPELINE] Topic ${topicId}: GENERATE_IMAGES skipped: ${imageResult.error}`)
                  } else {
                    await checkpointStep("images", imageResult.output, topicId)
                  }
                }
              } else {
                // 第 2 次（最后一次）：直接使用 review.fixedBody，不再 WRITE
                console.log(`[FULL_PIPELINE] Topic ${topicId}: Last attempt - using review.fixedBody directly`)
              }

              // REVIEW
              const reviewResult = await runStep({
                ...input,
                step: "REVIEW",
                topicId,
                workspaceId,
                writeAttempts: attempt + 1,
              })
              if (reviewResult.status === "failed")
                throw new Error(`REVIEW failed: ${reviewResult.error}`)

              await checkpointStep("review", reviewResult.output, topicId)

              const reviewData = reviewResult.output as {
                passed: boolean;
                score: number;
                issues: string[];
                suggestions: string[];
                dimensionScores?: DimensionScores;
                writerBrief?: WriterBrief;
                fixedBody?: string;
              };
              lastReviewOutput = reviewData

              if (reviewData.passed) {
                // Quality gate passed for this topic
                console.log(`[FULL_PIPELINE] Topic ${topicId} passed review (score: ${reviewData.score})`)

                // PUBLISH
                const publishResult = await runStep({
                  ...input,
                  step: "PUBLISH",
                  topicId,
                  workspaceId,
                })
                if (publishResult.status === "failed") {
                  throw new Error(`PUBLISH failed: ${publishResult.error}`)
                }
                await checkpointStep("publish", publishResult.output, topicId)

                if (!firstSuccessfulResult) {
                  firstSuccessfulResult = { topicId, writeOutput: lastWriteOutput, reviewOutput: lastReviewOutput, attempts: attempt + 1 }
                }
                topicSucceeded = true
                break
              }

              // REVIEW failed — build structured feedback for retry
              if (attempt < maxRetries) {
                reviewFeedback = buildReviewFeedback(
                  reviewData,
                  qualityConfig.minScore,
                  attempt + 1,
                )
                console.warn(
                  `[FULL_PIPELINE] Topic ${topicId}: Review attempt ${attempt + 1} failed (score: ${reviewData.score}). Retrying with feedback.`,
                )
              } else {
                // 最后一次失败：直接使用 review.fixedBody 作为最终 body
                console.warn(`[FULL_PIPELINE] Topic ${topicId}: All attempts failed - using review.fixedBody as final content`)
                if (reviewData.fixedBody) {
                  const content = await prisma.content.findFirst({
                    where: { accountId: input.accountId, topicId: topicId, status: "REJECTED" },
                    orderBy: { createdAt: "desc" },
                  })
                  if (content) {
                    await prisma.content.update({
                      where: { id: content.id },
                      data: { body: reviewData.fixedBody, status: "DRAFT" },
                    })
                    console.log(`[FULL_PIPELINE] Topic ${topicId}: Updated content with review.fixedBody`)
                  }
                }
              }
            }

            if (!topicSucceeded) {
              // All retries exhausted for this topic
              const finalReview = lastReviewOutput as { score: number; issues: string[] } | null
              failedTopics.push({
                topicId,
                error: `Review failed after ${maxRetries + 1} attempts. Score: ${finalReview?.score ?? "N/A"}/10. Issues: ${(finalReview?.issues ?? []).join("; ") || "none"}`,
              })
              console.warn(`[FULL_PIPELINE] Topic ${topicId} failed after ${maxRetries + 1} attempts`)
            }
          } catch (err) {
            failedTopics.push({ topicId, error: err instanceof Error ? err.message : String(err) })
            console.error(`[FULL_PIPELINE] Topic ${topicId} threw error: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        // Return results
        if (firstSuccessfulResult) {
          if (workspaceId) {
            await workspaceManager.setStatus(workspaceId, "completed")
            // Send completion notification with success/failure counts
            await notifyPipelineComplete(
              workspaceId,
              topicIds.length,
              firstSuccessfulResult ? 1 : 0,
              failedTopics.length,
            ).catch((notifyErr) => {
              console.error(`[FULL_PIPELINE] Failed to send notification: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`)
            })
          }
          return {
            topicId: firstSuccessfulResult.topicId,
            writeOutput: firstSuccessfulResult.writeOutput,
            reviewOutput: firstSuccessfulResult.reviewOutput,
            attempts: firstSuccessfulResult.attempts,
          }
        }

        // All topics failed
        if (workspaceId) {
          await workspaceManager.setStatus(workspaceId, "failed")
          // Send failure notification for all topics failed
          await notifyPipelineComplete(
            workspaceId,
            topicIds.length,
            0,
            topicIds.length,
          ).catch((notifyErr) => {
            console.error(`[FULL_PIPELINE] Failed to send notification: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`)
          })
        }
        return {
          taskRunId: currentTaskRunId ?? "",
          status: "failed",
          error: `All ${topicIds.length} topics failed: ${JSON.stringify(failedTopics)}`,
          output: { failedTopics, topicCount: topicIds.length },
        }
      } catch (err) {
        if (workspaceId) {
          await workspaceManager.setStatus(workspaceId, "failed")
          // Send failure notification
          const errorMessage = err instanceof Error ? err.message : String(err)
          await notifyTaskRunFailure(
            currentTaskRunId ?? workspaceId,
            "FULL_PIPELINE",
            input.accountId,
            errorMessage,
          ).catch((notifyErr) => {
            console.error(`[FULL_PIPELINE] Failed to send notification: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`)
          })
        }
        throw err
      }
    }

    default:
      throw new Error(`Unknown step: ${input.step}`);
  }
}

function buildReviewFeedback(
  reviewData: {
    score: number;
    issues: string[];
    suggestions: string[];
    dimensionScores?: DimensionScores;
    writerBrief?: WriterBrief;
  },
  minScore: number,
  attemptNumber: number,
): string {
  const sections: string[] = [];

  // Retry prefix based on attempt number
  if (attemptNumber === 2) {
    sections.push(
      "[第2次重写] 上一次重写未能彻底解决问题，本次必须优先处理以下核心问题，其他可次要考虑：\n",
    );
  } else if (attemptNumber >= 3) {
    sections.push(
      "[第3次重写/最终机会] 前两次重写均未通过质量门控。本次请从头重新审视文章逻辑，不要在原文上小修小改，而是重新构建文章结构：\n",
    );
  }

  sections.push("## 上一版本审稿反馈\n");

  const brief = reviewData.writerBrief;

  if (brief) {
    // Structured feedback from writerBrief
    sections.push(`**核心问题**：${brief.coreProblem}\n`);

    if (brief.mustFix.length > 0) {
      sections.push("**必须修改（按优先级）**：");
      brief.mustFix.forEach((item, i) => {
        sections.push(
          `${i + 1}. [${item.priority}] ${item.location}：${item.problem} → 改为：${item.fix}`,
        );
      });
      sections.push("");
    }

    if (brief.keepGood.length > 0) {
      sections.push("**保留的优点（不要改动）**：");
      brief.keepGood.forEach((item) => {
        sections.push(`- ${item}`);
      });
      sections.push("");
    }
  } else {
    // Fallback: use issues array when writerBrief is not available
    if (reviewData.issues?.length > 0) {
      sections.push("**发现的问题**：");
      reviewData.issues.forEach((issue, i) => {
        sections.push(`${i + 1}. ${issue}`);
      });
      sections.push("");
    }

    if (reviewData.suggestions?.length > 0) {
      sections.push("**修改建议**：");
      reviewData.suggestions.forEach((s, i) => {
        sections.push(`${i + 1}. ${s}`);
      });
      sections.push("");
    }
  }

  // Dimension scores
  const ds = reviewData.dimensionScores;
  if (ds) {
    sections.push(
      `**评分详情**：观点深度${ds.perspective}/数据支撑${ds.dataSupport}/结构${ds.structure}/流畅度${ds.fluency}，综合${reviewData.score}分（需达到${minScore}）`,
    );
  } else {
    sections.push(`**评分**：${reviewData.score}/10（需达到${minScore}）`);
  }

  return sections.join("\n");
}

export async function runFullPipeline(
  input: PipelineInput,
): Promise<PipelineOutput> {
  return runStep({ ...input, step: "FULL_PIPELINE" });
}
