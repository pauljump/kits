import type Database from 'better-sqlite3'

/**
 * Creates the analytics_events and analytics_users tables if they don't exist.
 * Call once at app startup after getDb().
 */
export function initAnalyticsTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      userId TEXT,
      properties TEXT DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_event_ts ON analytics_events (event, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_user_ts ON analytics_events (userId, timestamp);

    CREATE TABLE IF NOT EXISTS analytics_users (
      userId TEXT PRIMARY KEY,
      traits TEXT DEFAULT '{}',
      firstSeen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      lastSeen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `)
}
