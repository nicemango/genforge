import type { Tool, ToolResult } from './types'
import { generateImages } from '@/lib/minimax-image'

interface GenerateImageParams {
  prompt: string
  aspectRatio?: string
  n?: number
}

// In-memory cache keyed by hash(prompt + aspectRatio) to avoid duplicate generations.
const promptCache = new Map<string, string>()
let imageIdCounter = 0

function cacheKey(prompt: string, aspectRatio: string): string {
  // Use a fast hash to key the cache — we only need determinism within a process run.
  let hash = 0
  const str = `${aspectRatio}:${prompt}`
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32-bit integer
  }
  return `IMG_CACHED_${Math.abs(hash).toString(36)}`
}

// Store generated base64 images by ID to avoid bloating conversation context.
// The pipeline reads from this map to replace __IMG_ID_N__ markers with actual base64.
export const generatedImagesStore = new Map<string, string>()

export function createGenerateImageTool(apiKey: string): Tool {
  return {
    name: 'generate_image',
    description:
      'Generate an image from a text description using MiniMax image generation model. ' +
      'Returns a base64 encoded JPEG image. Use this to create cover images or illustrations for articles.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Detailed text description of the image to generate. ' +
            'Be specific about subject, style, lighting, composition, and mood.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio of the image: "1:1", "16:9", "9:16", "4:3", "3:4" (default: 16:9)',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        },
        n: {
          type: 'number',
          description: 'Number of images to generate (default: 1, max: 4)',
        },
      },
      required: ['prompt'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const { prompt, aspectRatio = '16:9', n = 1 } = params as unknown as GenerateImageParams
      const safeN = Math.min(Number(n), 4)
      const key = cacheKey(prompt, aspectRatio)

      try {
        // Check in-process cache first to avoid redundant API calls.
        const cachedBase64 = promptCache.get(key)
        if (cachedBase64) {
          const imgId = `IMG_${imageIdCounter++}`
          generatedImagesStore.set(imgId, cachedBase64)
          return {
            success: true,
            output: JSON.stringify({
              id: `cached-${imgId}`,
              imageIds: [imgId],
              imageCount: 1,
              cached: true,
              message: `Image served from cache (ID: ${imgId}). Use __IMG_ID_${imgId}__ marker.`,
            }),
          }
        }

        const timeoutMs = 45_000
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        let result: Awaited<ReturnType<typeof generateImages>>
        try {
          result = await generateImages(apiKey, {
            prompt,
            aspectRatio,
            responseFormat: 'base64',
            n: safeN,
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (!result || !Array.isArray(result.images) || result.images.length === 0) {
          return { success: false, output: '', error: 'MiniMax returned empty images array' }
        }

        // Store base64 images in module-level map, return IDs to agent to avoid token bloat.
        const imageIds: string[] = []
        for (const imageBase64 of result.images) {
          // Populate cache for the first image only (n=1 is most common).
          if (safeN === 1) {
            promptCache.set(key, imageBase64)
          }
          const imgId = `IMG_${imageIdCounter++}`
          generatedImagesStore.set(imgId, imageBase64)
          imageIds.push(imgId)
        }

        return {
          success: true,
          output: JSON.stringify({
            id: result.id,
            imageIds,
            imageCount: result.images.length,
            message: `${result.images.length} image(s) generated. Store IDs: ${imageIds.join(', ')}. Use __IMG_ID_${imageIds[0]}__ marker in your markdown output.`,
          }),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, output: '', error: message }
      }
    },
  }
}
