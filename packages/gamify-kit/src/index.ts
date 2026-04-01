export { initGamifyTables } from './setup.js'

export { addPoints, getBalance, getHistory } from './points.js'

export { recordActivity, getStreak, checkStreakAlive } from './streaks.js'

export {
  defineAchievement,
  checkAchievements,
  getUnlocked,
} from './achievements.js'

export type {
  AchievementDefinition,
  Achievement,
  AchievementCondition,
  UnlockedAchievement,
  StreakInfo,
  PointsLedger,
  AddPointsOptions,
  RecordActivityOptions,
  GetStreakOptions,
} from './types.js'
