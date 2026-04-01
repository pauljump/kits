import type Database from 'better-sqlite3'

/** Configuration for defining an achievement */
export interface AchievementDefinition {
  id: string
  name: string
  description: string
  condition: AchievementCondition
  icon?: string
}

/** Stored achievement record */
export interface Achievement {
  id: string
  name: string
  description: string
  condition: AchievementCondition
  icon: string | null
}

/** Conditions that can unlock an achievement */
export type AchievementCondition =
  | { type: 'points_threshold'; threshold: number }
  | { type: 'streak_threshold'; activity: string; threshold: number }
  | { type: 'points_reason_count'; reason: string; count: number }

/** Unlocked achievement with timestamp */
export interface UnlockedAchievement extends Achievement {
  unlockedAt: string
}

/** Current streak info for a user + activity */
export interface StreakInfo {
  current: number
  longest: number
  lastDate: string | null
}

/** A single points ledger entry */
export interface PointsLedger {
  id: number
  userId: number
  amount: number
  reason: string
  createdAt: string
}

/** Options for adding points */
export interface AddPointsOptions {
  userId: number
  amount: number
  reason: string
}

/** Options for recording streak activity */
export interface RecordActivityOptions {
  userId: number
  activity: string
}

/** Options for querying a streak */
export interface GetStreakOptions {
  userId: number
  activity: string
}

/** Re-export Database type for convenience */
export type { Database }
