/**
 * Type-safe JSON parsing helpers for database JSON fields.
 * Uses Zod for schema validation.
 */
import { z } from 'zod'
import type { PublishPlatform } from '@/types/accounts'

// ============================================================================
// Zod Schemas
// ============================================================================

// Account JSON fields
export const ModelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  model: z.string().default('claude-sonnet-4-6'),
  apiKey: z.string(),
  baseURL: z.string().optional(),
  defaultModel: z.string().optional(),
  minimaxApiKey: z.string().optional(),
  agentProviders: z.record(z.string(), z.object({
    type: z.enum(['anthropic', 'openai']),
    apiKey: z.string(),
    baseURL: z.string().optional(),
    defaultModel: z.string(),
  })).optional(),
  defaultProviderType: z.enum(['anthropic', 'openai']).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
})

export const WritingStyleSchema = z.object({
  tone: z.string().optional(),
  length: z.string().optional(),
  style: z.array(z.string()).optional(),
  brandName: z.string().optional(),
  targetAudience: z.string().optional(),
})

export const WechatConfigSchema = z.object({
  appId: z.string(),
  appSecret: z.string(),
  enabled: z.boolean().optional(),
  cachedToken: z.string().optional(),
  tokenExpiresAt: z.union([z.string(), z.number()]).optional(),
  defaultThumbMediaId: z.string().optional(),
  themeId: z.enum(['brand-clean', 'brand-magazine', 'brand-warm', 'wechat-pro']).optional(),
  brandName: z.string().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  titleAlign: z.enum(['left', 'center']).optional(),
  showEndingCard: z.boolean().optional(),
  endingCardText: z.string().optional(),
  imageStyle: z.enum(['rounded', 'soft-shadow', 'square']).optional(),
})

export const JuejinConfigSchema = z.object({
  cookie: z.string().optional(),
  enabled: z.boolean().optional(),
})

export const PublishPlatformSchema = z.enum(['wechat', 'juejin'])

export const QualityConfigSchema = z.object({
  minScore: z.number().default(7.0),
  maxWriteRetries: z.number().default(2),
})

// Topic JSON fields
export const TopicTagsSchema = z.array(z.string())
export const TopicSourcesSchema = z.array(z.object({
  title: z.string(),
  url: z.string(),
  source: z.string().optional(),
}))

// Content JSON fields
export const ContentImageSchema = z.object({
  alt: z.string(),
  caption: z.string().optional(),
  url: z.string(),
  slotId: z.string().optional(),
  marker: z.string().optional(),
  imageType: z.enum(['cover-hero', 'section-illustration', 'data-card', 'quote-card', 'section-card']).optional(),
  renderMode: z.enum(['ai', 'template']).optional(),
  coverMode: z.enum(['ai', 'semi-template', 'template']).optional(),
  sourcePrompt: z.string().optional(),
  mimeType: z.string().optional(),
  uploadStatus: z.enum(['uploaded', 'inline', 'failed']).optional(),
  qualityStatus: z.enum(['passed', 'retried', 'downgraded', 'failed']).optional(),
  fallbackReason: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
})

export const ContentImagesSchema = z.array(ContentImageSchema)

export const PublishRecordSchema = z.object({
  platform: PublishPlatformSchema,
  remoteId: z.string(),
  url: z.string().optional(),
  publishedAt: z.string(),
})

export const PublishRecordsSchema = z.array(PublishRecordSchema)

export const ReviewNotesSchema = z.object({
  score: z.number(),
  passed: z.boolean(),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  dimensionScores: z.object({
    perspective: z.number().optional(),
    structure: z.number().optional(),
    dataSupport: z.number().optional(),
    fluency: z.number().optional(),
  }).optional(),
})

// QualityRecord JSON fields
export const QualityRecordIssuesSchema = z.array(z.string())
export const QualityRecordSuggestionsSchema = z.array(z.string())

// VerificationReport JSON fields
export const VerificationReportDataSchema = z.record(z.unknown())
export const VerificationReportIssuesSchema = z.array(z.string())
export const VerificationReportWarningsSchema = z.array(z.string())

// ============================================================================
// Type Aliases (inferred from schemas)
// ============================================================================

export type ModelConfigJSON = z.infer<typeof ModelConfigSchema>
export type WritingStyleJSON = z.infer<typeof WritingStyleSchema>
export type WechatConfigJSON = z.infer<typeof WechatConfigSchema>
export type JuejinConfigJSON = z.infer<typeof JuejinConfigSchema>
export type QualityConfigJSON = z.infer<typeof QualityConfigSchema>
export type TopicTagsJSON = z.infer<typeof TopicTagsSchema>
export type TopicSourcesJSON = z.infer<typeof TopicSourcesSchema>
export type ContentImagesJSON = z.infer<typeof ContentImagesSchema>
export type PublishRecordJSON = z.infer<typeof PublishRecordSchema>
export type PublishRecordsJSON = z.infer<typeof PublishRecordsSchema>
export type ReviewNotesJSON = z.infer<typeof ReviewNotesSchema>

// ============================================================================
// Generic JSON Parser with Zod Validation
// ============================================================================

/**
 * Parse a JSON string field with Zod validation.
 * Returns defaultValue on parse or validation failure (logs a warning).
 */
export function parseJsonField<T>(
  value: string | null,
  fieldName: string,
  schema: z.ZodSchema<T>,
  defaultValue: T,
): T {
  if (value === null || value === '') {
    return defaultValue
  }

  try {
    const parsed = JSON.parse(value)
    const result = schema.safeParse(parsed)
    if (result.success) {
      return result.data
    } else {
      console.warn(
        `[parseJsonField] Validation failed for "${fieldName}": ${result.error.message}. Using default value.`,
      )
      return defaultValue
    }
  } catch (err) {
    console.warn(
      `[parseJsonField] Failed to parse "${fieldName}": ${err instanceof Error ? err.message : String(err)}. Using default value.`,
    )
    return defaultValue
  }
}

/**
 * Parse a JSON string field from an Account record.
 * Returns defaultValue on parse failure (logs a warning instead of throwing).
 * @deprecated Use parseJsonField with explicit schema instead.
 */
export function parseAccountJsonField<T>(
  value: string | null,
  fieldName: string,
  defaultValue: T,
): T {
  if (value === null || value === '') {
    return defaultValue
  }

  try {
    const parsed = JSON.parse(value) as T
    if (parsed === null || parsed === undefined) {
      return defaultValue
    }
    return parsed
  } catch (err) {
    console.warn(
      `[parseAccountJsonField] Failed to parse "${fieldName}": ${err instanceof Error ? err.message : String(err)}. Using default value.`,
    )
    return defaultValue
  }
}

// ============================================================================
// Specialized Parsers for Each Field Type
// ============================================================================

export function parseModelConfig(value: string | null): ModelConfigJSON {
  if (value === null || value === '') {
    return { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: '' }
  }
  try {
    return ModelConfigSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseModelConfig] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: '' }
  }
}

export function parseWritingStyle(value: string | null): WritingStyleJSON {
  if (value === null || value === '') return {}
  try {
    return WritingStyleSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseWritingStyle] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
}

export function parseWechatConfig(value: string | null): WechatConfigJSON {
  if (value === null || value === '') {
    return { appId: '', appSecret: '' }
  }
  try {
    return WechatConfigSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseWechatConfig] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return { appId: '', appSecret: '' }
  }
}

export function parseJuejinConfig(value: string | null): JuejinConfigJSON {
  if (value === null || value === '') return {}
  try {
    return JuejinConfigSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseJuejinConfig] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
}

export function parsePublishPlatform(value: string | null): PublishPlatform {
  if (value === null || value === '') return 'wechat'
  const result = PublishPlatformSchema.safeParse(value)
  if (result.success) return result.data
  console.warn(`[parsePublishPlatform] Failed to parse: ${value}`)
  return 'wechat'
}

export function parseQualityConfig(value: string | null): QualityConfigJSON {
  if (value === null || value === '') {
    return { minScore: 7.0, maxWriteRetries: 2 }
  }
  try {
    return QualityConfigSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseQualityConfig] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return { minScore: 7.0, maxWriteRetries: 2 }
  }
}

export function parseTopicTags(value: string | null): TopicTagsJSON {
  if (value === null || value === '') return []
  try {
    return TopicTagsSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseTopicTags] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export function parseTopicSources(value: string | null): TopicSourcesJSON {
  if (value === null || value === '') return []
  try {
    return TopicSourcesSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseTopicSources] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export function parseContentImages(value: string | null): ContentImagesJSON {
  if (value === null || value === '') return []
  try {
    return ContentImagesSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseContentImages] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export function parsePublishRecords(value: string | null): PublishRecordsJSON {
  if (value === null || value === '') return []
  try {
    return PublishRecordsSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parsePublishRecords] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export function parseReviewNotes(value: string | null): ReviewNotesJSON | null {
  if (value === null || value === '') return null
  try {
    return ReviewNotesSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseReviewNotes] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

export function parseQualityRecordIssues(value: string | null): string[] {
  if (value === null || value === '') return []
  try {
    return QualityRecordIssuesSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseQualityRecordIssues] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export function parseQualityRecordSuggestions(value: string | null): string[] {
  if (value === null || value === '') return []
  try {
    return QualityRecordSuggestionsSchema.parse(JSON.parse(value))
  } catch (err) {
    console.warn(`[parseQualityRecordSuggestions] Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}
