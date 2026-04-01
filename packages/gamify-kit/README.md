# @pauljump/gamify-kit

Points, streaks, and achievements for any app using SQLite via `@pauljump/api-kit`.

## Install

```bash
pnpm add @pauljump/gamify-kit
```

Peer dependency: `better-sqlite3` (already installed if you use `@pauljump/api-kit`).

## Usage

```typescript
import { getDb } from '@pauljump/api-kit'
import {
  initGamifyTables,
  addPoints,
  getBalance,
  getHistory,
  recordActivity,
  getStreak,
  checkStreakAlive,
  defineAchievement,
  checkAchievements,
  getUnlocked,
} from '@pauljump/gamify-kit'

const db = getDb({ path: './data/app.db' })
initGamifyTables(db)
```

### Points

```typescript
addPoints(db, { userId: 1, amount: 100, reason: 'completed_lesson' })
addPoints(db, { userId: 1, amount: -20, reason: 'hint_used' })

getBalance(db, 1) // 80
getHistory(db, 1, { limit: 50 }) // PointsLedger[]
```

### Streaks

```typescript
recordActivity(db, { userId: 1, activity: 'daily_login' })
// Returns: { current: 3, longest: 7, lastDate: '2026-03-15' }

getStreak(db, { userId: 1, activity: 'daily_login' })
checkStreakAlive(db, { userId: 1, activity: 'daily_login' }) // true/false
```

Streak logic:
- Same day: no-op (already counted)
- Consecutive day: increment
- Gap: reset to 1

### Achievements

```typescript
defineAchievement(db, {
  id: 'first_lesson',
  name: 'First Steps',
  description: 'Complete your first lesson',
  condition: { type: 'points_threshold', threshold: 100 },
})

defineAchievement(db, {
  id: 'week_streak',
  name: 'On Fire',
  description: '7-day login streak',
  condition: { type: 'streak_threshold', activity: 'daily_login', threshold: 7 },
})

defineAchievement(db, {
  id: 'ten_lessons',
  name: 'Scholar',
  description: 'Complete 10 lessons',
  condition: { type: 'points_reason_count', reason: 'completed_lesson', count: 10 },
})

const newBadges = checkAchievements(db, 1) // newly unlocked only
const allBadges = getUnlocked(db, 1) // all unlocked
```

## Tables

Created by `initGamifyTables()`:

| Table | Purpose |
|-------|---------|
| `gamify_points` | Points ledger (userId, amount, reason, createdAt) |
| `gamify_streaks` | Streak state (userId, activity, currentStreak, longestStreak, lastDate) |
| `gamify_achievements` | Achievement definitions (id, name, description, condition JSON, icon) |
| `gamify_user_achievements` | Unlocked achievements (userId, achievementId, unlockedAt) |
