// Minimal cron expression matcher (5-field: min hour dom month dow).
// Supports: *, number, step (*/n), comma-separated values, ranges (a-b).
export function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expr}"`)

  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts

  const values = [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    date.getUTCDay(),
  ]
  const exprs = [minExpr, hourExpr, domExpr, monExpr, dowExpr]
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]

  return exprs.every((e, i) => matchField(e, values[i], ranges[i][0], ranges[i][1]))
}

function matchField(expr: string, value: number, min: number, max: number): boolean {
  if (expr === '*') return true

  if (expr.startsWith('*/')) {
    const step = parseInt(expr.slice(2), 10)
    return (value - min) % step === 0
  }

  if (expr.includes(',')) {
    return expr.split(',').some((part) => matchField(part.trim(), value, min, max))
  }

  if (expr.includes('-')) {
    const [lo, hi] = expr.split('-').map(Number)
    return value >= lo && value <= hi
  }

  return parseInt(expr, 10) === value
}

// Compute the next Date after `from` that matches `expr`.
// Searches up to 1 year ahead; throws if no match found.
export function nextRunDate(expr: string, from: Date = new Date()): Date {
  const d = new Date(from)
  d.setUTCSeconds(0)
  d.setUTCMilliseconds(0)
  d.setUTCMinutes(d.getUTCMinutes() + 1)

  const limit = new Date(from)
  limit.setUTCFullYear(limit.getUTCFullYear() + 1)

  while (d < limit) {
    if (matchesCron(expr, d)) return new Date(d)
    d.setUTCMinutes(d.getUTCMinutes() + 1)
  }

  throw new Error(`Could not find next run date for cron expression: "${expr}"`)
}
