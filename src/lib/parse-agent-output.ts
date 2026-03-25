import { z, type ZodSchema, ZodError } from 'zod'

/**
 * Safely extract JSON from LLM text output.
 * Tries multiple strategies:
 * 1. Direct JSON.parse on the full text
 * 2. Extract from markdown code block (```json ... ```)
 * 3. Find first { ... } or [ ... ] boundary
 *
 * Throws with a clear error message if all strategies fail.
 */
export function extractJSON(text: string): unknown {
  // Strategy 1: direct parse
  try {
    return JSON.parse(text)
  } catch {
    // continue to next strategy
  }

  // Strategy 2: markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {
      // continue to next strategy
    }
  }

  // Strategy 3: find first { ... } or [ ... ] boundary
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')

  let start: number
  let end: number
  let closer: string

  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error(
      `Failed to extract JSON from LLM output: no JSON structure found. Output starts with: "${text.slice(0, 200)}"`,
    )
  }

  if (firstBracket === -1 || (firstBrace !== -1 && firstBrace < firstBracket)) {
    start = firstBrace
    closer = '}'
  } else {
    start = firstBracket
    closer = ']'
  }

  end = text.lastIndexOf(closer)
  if (end <= start) {
    throw new Error(
      `Failed to extract JSON from LLM output: unmatched ${closer === '}' ? 'braces' : 'brackets'}. Output starts with: "${text.slice(0, 200)}"`,
    )
  }

  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch (err) {
    throw new Error(
      `Failed to parse extracted JSON from LLM output: ${err instanceof Error ? err.message : String(err)}. Extracted: "${candidate.slice(0, 300)}"`,
    )
  }
}

/**
 * Validate that extracted JSON conforms to a Zod schema.
 * Throws with agent name and field-level details on validation failure.
 */
export function validateAgentOutput<T>(
  data: unknown,
  schema: ZodSchema<T>,
  agentName: string,
): T {
  try {
    return schema.parse(data)
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors = err.errors
        .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
        .join('\n')
      throw new Error(
        `[${agentName}] Output validation failed:\n${fieldErrors}\nReceived: ${JSON.stringify(data).slice(0, 500)}`,
      )
    }
    throw err
  }
}

/**
 * Convenience: extract JSON from text and validate against schema in one call.
 */
export function parseAgentOutput<T>(
  text: string,
  schema: ZodSchema<T>,
  agentName: string,
): T {
  const raw = extractJSON(text)
  return validateAgentOutput(raw, schema, agentName)
}
