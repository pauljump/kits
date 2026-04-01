import type Database from 'better-sqlite3'
import type { AddPointsOptions, PointsLedger } from './types.js'

/**
 * Add points to a user's ledger.
 * Amount can be negative for deductions.
 */
export function addPoints(
  db: Database.Database,
  opts: AddPointsOptions,
): void {
  const stmt = db.prepare(
    'INSERT INTO gamify_points (userId, amount, reason) VALUES (?, ?, ?)',
  )
  stmt.run(opts.userId, opts.amount, opts.reason)
}

/**
 * Get total points balance for a user (sum of all ledger entries).
 */
export function getBalance(db: Database.Database, userId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM gamify_points WHERE userId = ?')
    .get(userId) as { total: number }
  return row.total
}

/**
 * Get the full points history for a user, newest first.
 */
export function getHistory(
  db: Database.Database,
  userId: number,
  opts?: { limit?: number },
): PointsLedger[] {
  const limit = opts?.limit ?? 100
  return db
    .prepare(
      'SELECT id, userId, amount, reason, createdAt FROM gamify_points WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
    )
    .all(userId, limit) as PointsLedger[]
}
