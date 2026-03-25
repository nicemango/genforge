/**
 * Shared type definitions for Account-related data.
 * These are pure type definitions with no runtime dependencies.
 * Can be imported by both client and server components.
 */

/**
 * Simplified ModelConfig for frontend use (form editing).
 * This is a subset of the full ModelConfig in src/lib/config.ts.
 */
export interface FrontendModelConfig {
  apiKey?: string
  baseURL?: string
  defaultModel?: string
  defaultProviderType?: 'anthropic' | 'openai'
}

/**
 * Simplified WechatConfig for frontend use.
 */
export interface FrontendWechatConfig {
  appId?: string
  appSecret?: string
  enabled?: boolean
  cachedToken?: string
  tokenExpiresAt?: string
  defaultThumbMediaId?: string
}

/**
 * Simplified WritingStyle for frontend use.
 */
export interface FrontendWritingStyle {
  tone?: string
  length?: string
  style?: string[]
}

/**
 * Account type as stored in database (JSON strings).
 */
export interface AccountRecord {
  id: string
  name: string
  isActive: boolean
  modelConfig: string // JSON string
  writingStyle: string // JSON string
  wechatConfig: string // JSON string
  qualityConfig: string // JSON string
  createdAt: Date
  updatedAt: Date
}

/**
 * Parsed Account with deserialized JSON fields.
 */
export interface ParsedAccount {
  id: string
  name: string
  isActive: boolean
  modelConfig: FrontendModelConfig
  writingStyle: FrontendWritingStyle
  wechatConfig: FrontendWechatConfig
  qualityConfig: {
    minScore: number
    maxWriteRetries: number
  }
  createdAt: Date
  updatedAt: Date
}
