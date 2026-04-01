import type Database from 'better-sqlite3'
import type { RecordActivityOptions, GetStreakOptions, StreakInfo } from './types.js'

/**
 * Get today's date as YYYY-MM-DD in UTC.
 */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Get yesterday's date as YYYY-MM-DD in UTC.
 */
function yesterdayUTC(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Record an activity for streak tracking.
 * - Same day: no-op (already recorded today)
 * - Consecutive day: increments streak
 * - Gap: resets streak to 1
 */
export function recordActivity(
  db: Database.Database,
  opts: RecordActivityOptions,
): StreakInfo {
  const today = todayUTC()
  const yesterday = yesterdayUTC()

  const existing = db
    .prepare('SELECT currentStreak, longestStreak, lastDate FROM gamify_streaks WHERE userId = ? AND activity = ?')
    .get(opts.userId, opts.activity) as
    | { currentStreak: number; longestStreak: number; lastDate: string | null }
    | undefined

  if (!existing) {
    // First time — insert with streak of 1
    db.prepare(
      'INSERT INTO gamify_streaks (userId, activity, currentStreak, longestStreak, lastDate) VALUES (?, ?, 1, 1, ?)',
    ).run(opts.userId, opts.activity, today)
    return { current: 1, longest: 1, lastDate: today }
  }

  // Already recorded today
  if (existing.lastDate === today) {
    return {
      current: existing.currentStreak,
      longest: existing.longestStreak,
      lastDate: existing.lastDate,
    }
  }

  let newStreak: number
  if (existing.lastDate === yesterday) {
    // Consecutive day
    newStreak = existing.currentStreak + 1
  } else {
    // Gap — reset
    newStreak = 1
  }

  const newLongest = Math.max(newStreak, existing.longestStreak)

  db.prepare(
    'UPDATE gamify_streaks SET currentStreak = ?, longestStreak = ?, lastDate = ? WHERE userId = ? AND activity = ?',
  ).run(newStreak, newLongest, today, opts.userId, opts.activity)

  return { current: newStreak, longest: newLongest, lastDate: today }
}

/**
 * Get the current streak info for a user + activity.
 * Returns zeroed info if no activity has been recorded.
 */
export function getStreak(
  db: Database.Database,
  opts: GetStreakOptions,
): StreakInfo {
  const row = db
    .prepare('SELECT currentStreak, longestStreak, lastDate FROM gamify_streaks WHERE userId = ? AND activity = ?')
    .get(opts.userId, opts.activity) as
    | { currentStreak: number; longestStreak: number; lastDate: string | null }
    | undefined

  if (!row) {
    return { current: 0, longest: 0, lastDate: null }
  }

  return {
    current: row.currentStreak,
    longest: row.longestStreak,
    lastDate: row.lastDate,
  }
}

/**
 * Check if a streak is still alive (activity was recorded today or yesterday).
 */
export function checkStreakAlive(
  db: Database.Database,
  opts: GetStreakOptions,
): boolean {
  const streak = getStreak(db, opts)
  if (!streak.lastDate) return false
  const today = todayUTC()
  const yesterday = yesterdayUTC()
  return streak.lastDate === today || streak.lastDate === yesterday
}
