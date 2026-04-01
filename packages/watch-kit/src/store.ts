/**
 * Snapshot store — SQLite-backed state tracking for watchers.
 *
 * Tracks what we've seen, when, and whether it's still there.
 * Handles grace periods (StuyWatch's "pending" pattern) and
 * deduplication (Bookem's "seen_cases" pattern).
 */

import type Database from 'better-sqlite3'
import type { Snapshot } from './types.js'

const SETUP_SQL = `
  CREATE TABLE IF NOT EXISTS watch_snapshots (
    watcher_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    data_json TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    missing_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (watcher_id, item_key)
  );

  CREATE INDEX IF NOT EXISTS idx_watch_snapshots_status
    ON watch_snapshots(watcher_id, status);

  CREATE TABLE IF NOT EXISTS watch_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watcher_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status TEXT NOT NULL,
    items_fetched INTEGER NOT NULL DEFAULT 0,
    events_total INTEGER NOT NULL DEFAULT 0,
    events_triggered INTEGER NOT NULL DEFAULT 0,
    errors TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_watch_runs_watcher
    ON watch_runs(watcher_id, started_at);
`

export class SnapshotStore {
  private db: Database.Database
  private stmts: ReturnType<typeof this.prepareStatements>

  constructor(db: Database.Database) {
    this.db = db
    db.exec(SETUP_SQL)
    this.stmts = this.prepareStatements()
  }

  private prepareStatements() {
    return {
      getActive: this.db.prepare<[string]>(`
        SELECT * FROM watch_snapshots
        WHERE watcher_id = ? AND status IN ('active', 'pending_removal')
      `),
      getByKey: this.db.prepare<[string, string]>(`
        SELECT * FROM watch_snapshots
        WHERE watcher_id = ? AND item_key = ?
      `),
      upsert: this.db.prepare<[string, string, string, string, string]>(`
        INSERT INTO watch_snapshots (watcher_id, item_key, data_json, first_seen_at, last_seen_at, missing_count, status)
        VALUES (?, ?, ?, ?, ?, 0, 'active')
        ON CONFLICT(watcher_id, item_key) DO UPDATE SET
          data_json = excluded.data_json,
          last_seen_at = excluded.last_seen_at,
          missing_count = 0,
          status = 'active'
      `),
      incrementMissing: this.db.prepare<[string, string]>(`
        UPDATE watch_snapshots
        SET missing_count = missing_count + 1
        WHERE watcher_id = ? AND item_key = ? AND status IN ('active', 'pending_removal')
      `),
      markPendingRemoval: this.db.prepare<[string, string]>(`
        UPDATE watch_snapshots SET status = 'pending_removal'
        WHERE watcher_id = ? AND item_key = ? AND status = 'active'
      `),
      markRemoved: this.db.prepare<[string, string]>(`
        UPDATE watch_snapshots SET status = 'removed'
        WHERE watcher_id = ? AND item_key = ?
      `),
      logRun: this.db.prepare(`
        INSERT INTO watch_runs (watcher_id, started_at, finished_at, status, items_fetched, events_total, events_triggered, errors, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
    }
  }

  /** Get all active/pending snapshots for a watcher */
  getSnapshots(watcherId: string): Snapshot[] {
    return this.stmts.getActive.all(watcherId) as Snapshot[]
  }

  /** Get a specific snapshot by key */
  getSnapshot(watcherId: string, itemKey: string): Snapshot | undefined {
    return this.stmts.getByKey.get(watcherId, itemKey) as Snapshot | undefined
  }

  /** Upsert a snapshot (seen this item now) */
  upsertSnapshot(watcherId: string, itemKey: string, dataJson: string, now: string): void {
    this.stmts.upsert.run(watcherId, itemKey, dataJson, now, now)
  }

  /** Mark an item as missing (increment counter, potentially change status) */
  markMissing(watcherId: string, itemKey: string, graceChecks: number): 'pending' | 'removed' {
    this.stmts.incrementMissing.run(watcherId, itemKey)
    const snap = this.getSnapshot(watcherId, itemKey)
    if (!snap) return 'removed'

    if (snap.missing_count + 1 >= graceChecks) {
      this.stmts.markRemoved.run(watcherId, itemKey)
      return 'removed'
    } else {
      this.stmts.markPendingRemoval.run(watcherId, itemKey)
      return 'pending'
    }
  }

  /** Log a watcher run */
  logRun(entry: {
    watcher_id: string
    started_at: string
    finished_at: string
    status: string
    items_fetched: number
    events_total: number
    events_triggered: number
    errors: string | null
    duration_ms: number
  }): void {
    this.stmts.logRun.run(
      entry.watcher_id, entry.started_at, entry.finished_at, entry.status,
      entry.items_fetched, entry.events_total, entry.events_triggered,
      entry.errors, entry.duration_ms
    )
  }

  /** Get recent runs for a watcher */
  getRecentRuns(watcherId: string, limit: number = 10) {
    return this.db.prepare(`
      SELECT * FROM watch_runs WHERE watcher_id = ? ORDER BY started_at DESC LIMIT ?
    `).all(watcherId, limit)
  }
}
