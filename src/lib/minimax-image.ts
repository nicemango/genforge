export interface ImageGenerationRequest {
  prompt: string
  model?: string
  aspectRatio?: string
  responseFormat?: 'base64' | 'url'
  n?: number
}

export interface ImageGenerationResult {
  images: string[] // base64 strings or URLs
  id: string
  model: string
}

const BASE_URL = 'https://api.minimaxi.com/v1/image_generation'

const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate images with exponential-backoff retry on transient failures.
 * Retries on HTTP 429, 500, 502, 503, 504; fails immediately on auth errors (401, 403).
 */
export async function generateImages(
  apiKey: string,
  request: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  const { prompt, model = 'image-01', aspectRatio = '16:9', responseFormat = 'base64', n = 1 } = request

  let lastError: string = ''

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          aspect_ratio: aspectRatio,
          response_format: responseFormat,
          n,
        }),
        signal: AbortSignal.timeout(120000),
      })

      if (response.ok) {
        const data = await response.json() as {
          id: string
          model: string
          data: { image_base64?: string[]; image_url?: string[] }
        }

        const images = data.data.image_base64 ?? data.data.image_url ?? []

        return {
          images,
          id: data.id,
          model: data.model,
        }
      }

      // Non-retryable auth errors
      if (response.status === 401 || response.status === 403) {
        const body = await response.text()
        throw new Error(`MiniMax auth error: HTTP ${response.status} — ${body}`)
      }

      lastError = `HTTP ${response.status} — ${await response.text()}`

      if (attempt < MAX_RETRIES - 1) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        await sleep(delay)
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)

      // Network-level errors (no response) are retriable
      const isNetworkError = !(err instanceof Error && err.message.startsWith('MiniMax auth error'))
      if (!isNetworkError || attempt >= MAX_RETRIES - 1) {
        throw new Error(`MiniMax image generation failed after ${attempt + 1} attempt(s): ${lastError}`)
      }

      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
      await sleep(delay)
    }
  }

  throw new Error(`MiniMax image generation failed after ${MAX_RETRIES} attempts: ${lastError}`)
}

/**
 * Generate a single image with retry. Returns base64 string or throws.
 * Falls back to returning a placeholder indicator when all retries are exhausted.
 */
export async function generateImageWithFallback(
  apiKey: string,
  request: ImageGenerationRequest,
): Promise<{ imageBase64: string | null; error: string | null; cached: boolean }> {
  try {
    const result = await generateImages(apiKey, { ...request, n: 1 })
    return { imageBase64: result.images[0] ?? null, error: null, cached: false }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[generateImageWithFallback] all retries exhausted: ${error}`)
    return { imageBase64: null, error, cached: false }
  }
}
