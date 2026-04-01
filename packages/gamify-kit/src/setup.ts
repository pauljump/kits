import type Database from 'better-sqlite3'

/**
 * Creates the gamify tables in the given SQLite database.
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export function initGamifyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gamify_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_gamify_points_userId ON gamify_points(userId);
    CREATE INDEX IF NOT EXISTS idx_gamify_points_reason ON gamify_points(userId, reason);

    CREATE TABLE IF NOT EXISTS gamify_streaks (
      userId INTEGER NOT NULL,
      activity TEXT NOT NULL,
      currentStreak INTEGER NOT NULL DEFAULT 0,
      longestStreak INTEGER NOT NULL DEFAULT 0,
      lastDate TEXT,
      PRIMARY KEY (userId, activity)
    );

    CREATE TABLE IF NOT EXISTS gamify_achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      condition TEXT NOT NULL,
      icon TEXT
    );

    CREATE TABLE IF NOT EXISTS gamify_user_achievements (
      userId INTEGER NOT NULL,
      achievementId TEXT NOT NULL,
      unlockedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (userId, achievementId),
      FOREIGN KEY (achievementId) REFERENCES gamify_achievements(id)
    );
  `)
}
