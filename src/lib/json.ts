/**
 * Type-safe JSON parsing helpers for Account JSON fields.
 */

/**
 * Parse a JSON string field from an Account record.
 * Returns defaultValue on parse failure (logs a warning instead of throwing).
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
