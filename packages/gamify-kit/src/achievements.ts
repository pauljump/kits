import type Database from 'better-sqlite3'
import type {
  AchievementDefinition,
  Achievement,
  AchievementCondition,
  UnlockedAchievement,
} from './types.js'
import { getBalance } from './points.js'
import { getStreak } from './streaks.js'

/**
 * Define (or upsert) an achievement.
 */
export function defineAchievement(
  db: Database.Database,
  def: AchievementDefinition,
): void {
  db.prepare(
    `INSERT INTO gamify_achievements (id, name, description, condition, icon)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       condition = excluded.condition,
       icon = excluded.icon`,
  ).run(def.id, def.name, def.description, JSON.stringify(def.condition), def.icon ?? null)
}

/**
 * Check all defined achievements against a user's current state.
 * Returns only *newly* unlocked achievements (skips already-unlocked ones).
 */
export function checkAchievements(
  db: Database.Database,
  userId: number,
): UnlockedAchievement[] {
  // Get all achievements not yet unlocked by this user
  const unchecked = db
    .prepare(
      `SELECT a.id, a.name, a.description, a.condition, a.icon
       FROM gamify_achievements a
       WHERE a.id NOT IN (
         SELECT achievementId FROM gamify_user_achievements WHERE userId = ?
       )`,
    )
    .all(userId) as Array<{
    id: string
    name: string
    description: string
    condition: string
    icon: string | null
  }>

  const newlyUnlocked: UnlockedAchievement[] = []

  for (const row of unchecked) {
    const condition = JSON.parse(row.condition) as AchievementCondition

    if (evaluateCondition(db, userId, condition)) {
      const now = new Date().toISOString()
      db.prepare(
        'INSERT INTO gamify_user_achievements (userId, achievementId, unlockedAt) VALUES (?, ?, ?)',
      ).run(userId, row.id, now)

      newlyUnlocked.push({
        id: row.id,
        name: row.name,
        description: row.description,
        condition,
        icon: row.icon,
        unlockedAt: now,
      })
    }
  }

  return newlyUnlocked
}

/**
 * Get all achievements unlocked by a user.
 */
export function getUnlocked(
  db: Database.Database,
  userId: number,
): UnlockedAchievement[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.description, a.condition, a.icon, ua.unlockedAt
       FROM gamify_user_achievements ua
       JOIN gamify_achievements a ON a.id = ua.achievementId
       WHERE ua.userId = ?
       ORDER BY ua.unlockedAt DESC`,
    )
    .all(userId) as Array<{
    id: string
    name: string
    description: string
    condition: string
    icon: string | null
    unlockedAt: string
  }>

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    condition: JSON.parse(row.condition) as AchievementCondition,
    icon: row.icon,
    unlockedAt: row.unlockedAt,
  }))
}

/**
 * Evaluate whether a condition is met for a user.
 */
function evaluateCondition(
  db: Database.Database,
  userId: number,
  condition: AchievementCondition,
): boolean {
  switch (condition.type) {
    case 'points_threshold': {
      const balance = getBalance(db, userId)
      return balance >= condition.threshold
    }
    case 'streak_threshold': {
      const streak = getStreak(db, {
        userId,
        activity: condition.activity,
      })
      return streak.current >= condition.threshold
    }
    case 'points_reason_count': {
      const row = db
        .prepare(
          'SELECT COUNT(*) as cnt FROM gamify_points WHERE userId = ? AND reason = ?',
        )
        .get(userId, condition.reason) as { cnt: number }
      return row.cnt >= condition.count
    }
  }
}
