/**
 * Simple 5-field cron parser: minute hour day month weekday
 *
 * Supports:
 * - Exact values: 5
 * - Wildcards: *
 * - Lists: 1,3,5
 * - Ranges: 1-5
 * - Steps: *​/15 or 1-30/5
 */

interface CronFields {
  minute: number[]
  hour: number[]
  day: number[]
  month: number[]
  weekday: number[]
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set()

  for (const part of field.split(',')) {
    // Handle step: */2 or 1-10/3
    const [rangePart, stepStr] = part.split('/')
    const step = stepStr ? parseInt(stepStr, 10) : 1

    if (isNaN(step) || step < 1) {
      throw new Error(`Invalid step in cron field: ${field}`)
    }

    let start: number
    let end: number

    if (rangePart === '*') {
      start = min
      end = max
    } else if (rangePart!.includes('-')) {
      const [lo, hi] = rangePart!.split('-').map(Number)
      if (isNaN(lo!) || isNaN(hi!) || lo! < min || hi! > max) {
        throw new Error(`Invalid range in cron field: ${field}`)
      }
      start = lo!
      end = hi!
    } else {
      const val = parseInt(rangePart!, 10)
      if (isNaN(val) || val < min || val > max) {
        throw new Error(`Invalid value in cron field: ${field}`)
      }
      if (step === 1) {
        values.add(val)
        continue
      }
      start = val
      end = max
    }

    for (let i = start; i <= end; i += step) {
      values.add(i)
    }
  }

  return [...values].sort((a, b) => a - b)
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): "${expression}"`)
  }

  return {
    minute: parseField(parts[0]!, 0, 59),
    hour: parseField(parts[1]!, 0, 23),
    day: parseField(parts[2]!, 1, 31),
    month: parseField(parts[3]!, 1, 12),
    weekday: parseField(parts[4]!, 0, 6),
  }
}

/**
 * Given a cron expression and a reference date, find the next time
 * the cron would fire at or after `after`.
 */
export function nextCronDate(expression: string, after: Date = new Date()): Date {
  const fields = parseCron(expression)
  // Start from the next minute
  const d = new Date(after.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)

  // Search up to 2 years ahead to find a match
  const limit = new Date(after.getTime() + 2 * 365 * 24 * 60 * 60 * 1000)

  while (d < limit) {
    if (
      fields.month.includes(d.getMonth() + 1) &&
      fields.day.includes(d.getDate()) &&
      fields.weekday.includes(d.getDay()) &&
      fields.hour.includes(d.getHours()) &&
      fields.minute.includes(d.getMinutes())
    ) {
      return d
    }

    // Advance by minute
    d.setMinutes(d.getMinutes() + 1)
  }

  throw new Error(`No next run found within 2 years for cron: "${expression}"`)
}
