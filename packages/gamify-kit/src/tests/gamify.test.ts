import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initGamifyTables } from '../setup.js'
import { addPoints, getBalance, getHistory } from '../points.js'
import { recordActivity, getStreak, checkStreakAlive } from '../streaks.js'
import { defineAchievement, checkAchievements, getUnlocked } from '../achievements.js'

function createDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initGamifyTables(db)
  return db
}

// ── Points ──────────────────────────────────────────────────────────

describe('Points', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createDb()
  })

  it('addPoints credits balance', () => {
    addPoints(db, { userId: 1, amount: 50, reason: 'signup' })
    expect(getBalance(db, 1)).toBe(50)
  })

  it('addPoints with negative amount deducts', () => {
    addPoints(db, { userId: 1, amount: 100, reason: 'bonus' })
    addPoints(db, { userId: 1, amount: -30, reason: 'purchase' })
    expect(getBalance(db, 1)).toBe(70)
  })

  it('getBalance returns sum of all entries', () => {
    addPoints(db, { userId: 1, amount: 10, reason: 'a' })
    addPoints(db, { userId: 1, amount: 20, reason: 'b' })
    addPoints(db, { userId: 1, amount: 30, reason: 'c' })
    expect(getBalance(db, 1)).toBe(60)
  })

  it('getBalance returns 0 for unknown user', () => {
    expect(getBalance(db, 999)).toBe(0)
  })

  it('getBalance is scoped per user', () => {
    addPoints(db, { userId: 1, amount: 50, reason: 'x' })
    addPoints(db, { userId: 2, amount: 75, reason: 'x' })
    expect(getBalance(db, 1)).toBe(50)
    expect(getBalance(db, 2)).toBe(75)
  })

  it('getHistory returns entries newest first', () => {
    // Insert with explicit timestamps to guarantee ordering
    db.prepare(
      'INSERT INTO gamify_points (userId, amount, reason, createdAt) VALUES (?, ?, ?, ?)',
    ).run(1, 10, 'first', '2026-01-01T00:00:00')
    db.prepare(
      'INSERT INTO gamify_points (userId, amount, reason, createdAt) VALUES (?, ?, ?, ?)',
    ).run(1, 20, 'second', '2026-01-02T00:00:00')
    db.prepare(
      'INSERT INTO gamify_points (userId, amount, reason, createdAt) VALUES (?, ?, ?, ?)',
    ).run(1, 30, 'third', '2026-01-03T00:00:00')

    const history = getHistory(db, 1)
    expect(history).toHaveLength(3)
    expect(history[0].reason).toBe('third')
    expect(history[1].reason).toBe('second')
    expect(history[2].reason).toBe('first')
  })

  it('getHistory respects limit', () => {
    for (let i = 0; i < 10; i++) {
      addPoints(db, { userId: 1, amount: 1, reason: `r${i}` })
    }
    const history = getHistory(db, 1, { limit: 3 })
    expect(history).toHaveLength(3)
  })

  it('getHistory returns empty array for unknown user', () => {
    expect(getHistory(db, 999)).toEqual([])
  })
})

// ── Streaks ─────────────────────────────────────────────────────────

describe('Streaks', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createDb()
  })

  it('recordActivity starts a streak at 1', () => {
    const result = recordActivity(db, { userId: 1, activity: 'login' })
    expect(result.current).toBe(1)
    expect(result.longest).toBe(1)
    expect(result.lastDate).toBeTruthy()
  })

  it('recordActivity same day is a no-op (idempotent)', () => {
    const first = recordActivity(db, { userId: 1, activity: 'login' })
    const second = recordActivity(db, { userId: 1, activity: 'login' })
    expect(second.current).toBe(first.current)
    expect(second.longest).toBe(first.longest)
    expect(second.lastDate).toBe(first.lastDate)
  })

  it('recordActivity consecutive day increments streak', () => {
    // Seed a streak with lastDate = yesterday by inserting directly
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    db.prepare(
      'INSERT INTO gamify_streaks (userId, activity, currentStreak, longestStreak, lastDate) VALUES (?, ?, ?, ?, ?)',
    ).run(1, 'login', 3, 3, yesterdayStr)

    const result = recordActivity(db, { userId: 1, activity: 'login' })
    expect(result.current).toBe(4)
    expect(result.longest).toBe(4)
  })

  it('recordActivity after gap resets current but preserves longest', () => {
    // Seed a streak with lastDate = 3 days ago
    const threeDaysAgo = new Date()
    threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3)
    const dateStr = threeDaysAgo.toISOString().slice(0, 10)

    db.prepare(
      'INSERT INTO gamify_streaks (userId, activity, currentStreak, longestStreak, lastDate) VALUES (?, ?, ?, ?, ?)',
    ).run(1, 'login', 5, 10, dateStr)

    const result = recordActivity(db, { userId: 1, activity: 'login' })
    expect(result.current).toBe(1)
    expect(result.longest).toBe(10) // preserved
  })

  it('getStreak returns zero values for unknown user', () => {
    const streak = getStreak(db, { userId: 999, activity: 'login' })
    expect(streak.current).toBe(0)
    expect(streak.longest).toBe(0)
    expect(streak.lastDate).toBeNull()
  })

  it('checkStreakAlive returns true if activity was today', () => {
    recordActivity(db, { userId: 1, activity: 'login' })
    expect(checkStreakAlive(db, { userId: 1, activity: 'login' })).toBe(true)
  })

  it('checkStreakAlive returns true if activity was yesterday', () => {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    db.prepare(
      'INSERT INTO gamify_streaks (userId, activity, currentStreak, longestStreak, lastDate) VALUES (?, ?, ?, ?, ?)',
    ).run(1, 'login', 1, 1, yesterdayStr)

    expect(checkStreakAlive(db, { userId: 1, activity: 'login' })).toBe(true)
  })

  it('checkStreakAlive returns false if activity was 2+ days ago', () => {
    const twoDaysAgo = new Date()
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2)
    const dateStr = twoDaysAgo.toISOString().slice(0, 10)

    db.prepare(
      'INSERT INTO gamify_streaks (userId, activity, currentStreak, longestStreak, lastDate) VALUES (?, ?, ?, ?, ?)',
    ).run(1, 'login', 1, 1, dateStr)

    expect(checkStreakAlive(db, { userId: 1, activity: 'login' })).toBe(false)
  })

  it('checkStreakAlive returns false for unknown user', () => {
    expect(checkStreakAlive(db, { userId: 999, activity: 'login' })).toBe(false)
  })
})

// ── Achievements ────────────────────────────────────────────────────

describe('Achievements', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = createDb()
  })

  it('defineAchievement creates achievement', () => {
    defineAchievement(db, {
      id: 'first-100',
      name: 'Century',
      description: 'Earn 100 points',
      condition: { type: 'points_threshold', threshold: 100 },
      icon: '💯',
    })

    const row = db
      .prepare('SELECT * FROM gamify_achievements WHERE id = ?')
      .get('first-100') as any
    expect(row).toBeTruthy()
    expect(row.name).toBe('Century')
    expect(row.icon).toBe('💯')
    expect(JSON.parse(row.condition)).toEqual({
      type: 'points_threshold',
      threshold: 100,
    })
  })

  it('defineAchievement upserts on repeat', () => {
    defineAchievement(db, {
      id: 'a1',
      name: 'Original',
      description: 'v1',
      condition: { type: 'points_threshold', threshold: 10 },
    })

    defineAchievement(db, {
      id: 'a1',
      name: 'Updated',
      description: 'v2',
      condition: { type: 'points_threshold', threshold: 20 },
    })

    const row = db
      .prepare('SELECT * FROM gamify_achievements WHERE id = ?')
      .get('a1') as any
    expect(row.name).toBe('Updated')
    expect(row.description).toBe('v2')
    expect(JSON.parse(row.condition).threshold).toBe(20)
  })

  it('checkAchievements unlocks points_threshold achievement', () => {
    defineAchievement(db, {
      id: 'pts-50',
      name: '50 Club',
      description: 'Earn 50 points',
      condition: { type: 'points_threshold', threshold: 50 },
    })

    // Not enough points yet
    addPoints(db, { userId: 1, amount: 30, reason: 'task' })
    let unlocked = checkAchievements(db, 1)
    expect(unlocked).toHaveLength(0)

    // Now enough
    addPoints(db, { userId: 1, amount: 25, reason: 'task' })
    unlocked = checkAchievements(db, 1)
    expect(unlocked).toHaveLength(1)
    expect(unlocked[0].id).toBe('pts-50')
    expect(unlocked[0].unlockedAt).toBeTruthy()
  })

  it('checkAchievements unlocks streak_threshold achievement', () => {
    defineAchievement(db, {
      id: 'streak-3',
      name: 'Hat Trick',
      description: '3-day login streak',
      condition: { type: 'streak_threshold', activity: 'login', threshold: 3 },
    })

    // Seed a 3-day streak by setting lastDate to today with currentStreak = 3
    const today = new Date().toISOString().slice(0, 10)
    db.prepare(
      'INSERT INTO gamify_streaks (userId, activity, currentStreak, longestStreak, lastDate) VALUES (?, ?, ?, ?, ?)',
    ).run(1, 'login', 3, 3, today)

    const unlocked = checkAchievements(db, 1)
    expect(unlocked).toHaveLength(1)
    expect(unlocked[0].id).toBe('streak-3')
  })

  it('checkAchievements returns only newly unlocked (not previously unlocked)', () => {
    defineAchievement(db, {
      id: 'pts-10',
      name: 'Starter',
      description: 'Earn 10 points',
      condition: { type: 'points_threshold', threshold: 10 },
    })

    addPoints(db, { userId: 1, amount: 100, reason: 'big-bonus' })

    // First check — unlocks it
    const first = checkAchievements(db, 1)
    expect(first).toHaveLength(1)

    // Second check — already unlocked, should return empty
    const second = checkAchievements(db, 1)
    expect(second).toHaveLength(0)
  })

  it('checkAchievements unlocks points_reason_count achievement', () => {
    defineAchievement(db, {
      id: 'scan-5',
      name: 'Scanner Pro',
      description: 'Scan 5 times',
      condition: { type: 'points_reason_count', reason: 'scan', count: 5 },
    })

    for (let i = 0; i < 4; i++) {
      addPoints(db, { userId: 1, amount: 1, reason: 'scan' })
    }
    expect(checkAchievements(db, 1)).toHaveLength(0)

    addPoints(db, { userId: 1, amount: 1, reason: 'scan' })
    const unlocked = checkAchievements(db, 1)
    expect(unlocked).toHaveLength(1)
    expect(unlocked[0].id).toBe('scan-5')
  })

  it('getUnlocked returns all unlocked achievements', () => {
    defineAchievement(db, {
      id: 'a',
      name: 'A',
      description: 'a',
      condition: { type: 'points_threshold', threshold: 10 },
    })
    defineAchievement(db, {
      id: 'b',
      name: 'B',
      description: 'b',
      condition: { type: 'points_threshold', threshold: 20 },
    })

    addPoints(db, { userId: 1, amount: 25, reason: 'x' })
    checkAchievements(db, 1) // unlocks both

    const all = getUnlocked(db, 1)
    expect(all).toHaveLength(2)
    const ids = all.map((a) => a.id).sort()
    expect(ids).toEqual(['a', 'b'])
    // Each has parsed condition and unlockedAt
    for (const a of all) {
      expect(a.condition).toBeDefined()
      expect(a.condition.type).toBe('points_threshold')
      expect(a.unlockedAt).toBeTruthy()
    }
  })

  it('getUnlocked returns empty array when nothing unlocked', () => {
    expect(getUnlocked(db, 1)).toEqual([])
  })
})
