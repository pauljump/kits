import type Database from 'better-sqlite3'

/**
 * Create the job queue tables if they don't exist.
 * Call once at app startup with your api-kit db instance.
 */
export function initJobTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_definitions (
      name        TEXT PRIMARY KEY,
      cron        TEXT,
      payload     TEXT DEFAULT '{}',
      enabled     INTEGER DEFAULT 1,
      lastRunAt   TEXT,
      nextRunAt   TEXT
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      payload     TEXT DEFAULT '{}',
      runAt       TEXT NOT NULL,
      startedAt   TEXT,
      completedAt TEXT,
      error       TEXT,
      attempts    INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_job_runs_status_runAt
      ON job_runs (status, runAt);

    CREATE INDEX IF NOT EXISTS idx_job_runs_name
      ON job_runs (name);
  `)
}
