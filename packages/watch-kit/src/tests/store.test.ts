import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { SnapshotStore } from '../store.js'
import type { RunLogEntry } from '../types.js'

describe('SnapshotStore', () => {
  let db: Database.Database
  let store: SnapshotStore

  beforeEach(() => {
    db = new Database(':memory:')
    store = new SnapshotStore(db)
  })

  // ── Table creation ──

  describe('initialization', () => {
    it('creates watch_snapshots table', () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='watch_snapshots'"
      ).all()
      expect(tables).toHaveLength(1)
    })

    it('creates watch_runs table', () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='watch_runs'"
      ).all()
      expect(tables).toHaveLength(1)
    })

    it('creates indexes', () => {
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_watch_%'"
      ).all() as { name: string }[]
      const names = indexes.map(i => i.name)
      expect(names).toContain('idx_watch_snapshots_status')
      expect(names).toContain('idx_watch_runs_watcher')
    })

    it('is safe to construct multiple times on the same db (IF NOT EXISTS)', () => {
      // Should not throw
      const store2 = new SnapshotStore(db)
      expect(store2).toBeTruthy()
    })
  })

  // ── upsertSnapshot ──

  describe('upsertSnapshot', () => {
    it('inserts a new snapshot', () => {
      store.upsertSnapshot('w1', 'item-a', '{"val":1}', '2026-01-01T00:00:00Z')
      const snap = store.getSnapshot('w1', 'item-a')
      expect(snap).toBeDefined()
      expect(snap!.watcher_id).toBe('w1')
      expect(snap!.item_key).toBe('item-a')
      expect(snap!.data_json).toBe('{"val":1}')
      expect(snap!.first_seen_at).toBe('2026-01-01T00:00:00Z')
      expect(snap!.last_seen_at).toBe('2026-01-01T00:00:00Z')
      expect(snap!.missing_count).toBe(0)
      expect(snap!.status).toBe('active')
    })

    it('updates data and last_seen_at on conflict', () => {
      store.upsertSnapshot('w1', 'item-a', '{"val":1}', '2026-01-01T00:00:00Z')
      store.upsertSnapshot('w1', 'item-a', '{"val":2}', '2026-01-02T00:00:00Z')

      const snap = store.getSnapshot('w1', 'item-a')
      expect(snap!.data_json).toBe('{"val":2}')
      expect(snap!.last_seen_at).toBe('2026-01-02T00:00:00Z')
      // first_seen_at should stay the same
      expect(snap!.first_seen_at).toBe('2026-01-01T00:00:00Z')
    })

    it('resets missing_count and status to active on upsert', () => {
      store.upsertSnapshot('w1', 'item-a', '{"val":1}', '2026-01-01T00:00:00Z')
      store.markMissing('w1', 'item-a', 5) // sets pending_removal

      const before = store.getSnapshot('w1', 'item-a')
      expect(before!.status).toBe('pending_removal')
      expect(before!.missing_count).toBe(1)

      // Re-upsert should reset
      store.upsertSnapshot('w1', 'item-a', '{"val":1}', '2026-01-03T00:00:00Z')
      const after = store.getSnapshot('w1', 'item-a')
      expect(after!.status).toBe('active')
      expect(after!.missing_count).toBe(0)
    })
  })

  // ── getSnapshot / getSnapshots ──

  describe('getSnapshot', () => {
    it('returns undefined for nonexistent key', () => {
      expect(store.getSnapshot('w1', 'nope')).toBeUndefined()
    })

    it('retrieves a stored snapshot', () => {
      store.upsertSnapshot('w1', 'item-a', '{"x":1}', '2026-01-01T00:00:00Z')
      const snap = store.getSnapshot('w1', 'item-a')
      expect(snap).toBeDefined()
      expect(snap!.item_key).toBe('item-a')
    })
  })

  describe('getSnapshots', () => {
    it('returns only active and pending_removal snapshots for a watcher', () => {
      store.upsertSnapshot('w1', 'a', '{}', '2026-01-01T00:00:00Z')
      store.upsertSnapshot('w1', 'b', '{}', '2026-01-01T00:00:00Z')
      store.upsertSnapshot('w1', 'c', '{}', '2026-01-01T00:00:00Z')

      // Mark 'c' as removed (grace=0 means immediate)
      store.markMissing('w1', 'c', 0)

      const snapshots = store.getSnapshots('w1')
      expect(snapshots).toHaveLength(2)
      expect(snapshots.map(s => s.item_key).sort()).toEqual(['a', 'b'])
    })

    it('returns empty array for unknown watcher', () => {
      expect(store.getSnapshots('unknown')).toEqual([])
    })

    it('does not return snapshots from other watchers', () => {
      store.upsertSnapshot('w1', 'a', '{}', '2026-01-01T00:00:00Z')
      store.upsertSnapshot('w2', 'b', '{}', '2026-01-01T00:00:00Z')

      const w1Snaps = store.getSnapshots('w1')
      expect(w1Snaps).toHaveLength(1)
      expect(w1Snaps[0].item_key).toBe('a')
    })
  })

  // ── markMissing ──

  describe('markMissing', () => {
    it('immediately removes when graceChecks is 0', () => {
      store.upsertSnapshot('w1', 'a', '{}', '2026-01-01T00:00:00Z')
      const result = store.markMissing('w1', 'a', 0)
      // With graceChecks=0, missing_count(1) >= 0, so removed
      expect(result).toBe('removed')

      const snap = store.getSnapshot('w1', 'a')
      expect(snap!.status).toBe('removed')
    })

    it('returns pending when within grace period', () => {
      store.upsertSnapshot('w1', 'a', '{}', '2026-01-01T00:00:00Z')
      const result = store.markMissing('w1', 'a', 3)
      expect(result).toBe('pending')

      const snap = store.getSnapshot('w1', 'a')
      expect(snap!.status).toBe('pending_removal')
      expect(snap!.missing_count).toBe(1)
    })

    it('removes after grace period expires', () => {
      store.upsertSnapshot('w1', 'a', '{}', '2026-01-01T00:00:00Z')

      // Implementation: incrementMissing runs first (SQL), then reads back snap.missing_count,
      // then checks snap.missing_count + 1 >= graceChecks. So with graceChecks=3:
      //   Miss 1: count becomes 1, check 1+1=2 >= 3 → false → pending
      //   Miss 2: count becomes 2, check 2+1=3 >= 3 → true → removed
      expect(store.markMissing('w1', 'a', 3)).toBe('pending')
      expect(store.markMissing('w1', 'a', 3)).toBe('removed')

      const snap = store.getSnapshot('w1', 'a')
      expect(snap!.status).toBe('removed')
    })

    it('increments missing_count each call', () => {
      store.upsertSnapshot('w1', 'a', '{}', '2026-01-01T00:00:00Z')

      store.markMissing('w1', 'a', 10)
      expect(store.getSnapshot('w1', 'a')!.missing_count).toBe(1)

      store.markMissing('w1', 'a', 10)
      expect(store.getSnapshot('w1', 'a')!.missing_count).toBe(2)

      store.markMissing('w1', 'a', 10)
      expect(store.getSnapshot('w1', 'a')!.missing_count).toBe(3)
    })

    it('returns removed for nonexistent item', () => {
      const result = store.markMissing('w1', 'ghost', 5)
      expect(result).toBe('removed')
    })
  })

  // ── Run logging ──

  describe('logRun / getRecentRuns', () => {
    function makeRun(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
      return {
        watcher_id: 'w1',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:00:01Z',
        status: 'success',
        items_fetched: 5,
        events_total: 2,
        events_triggered: 1,
        errors: null,
        duration_ms: 1000,
        ...overrides,
      }
    }

    it('logs a run and retrieves it', () => {
      store.logRun(makeRun())
      const runs = store.getRecentRuns('w1')
      expect(runs).toHaveLength(1)
      expect((runs[0] as RunLogEntry).watcher_id).toBe('w1')
      expect((runs[0] as RunLogEntry).status).toBe('success')
      expect((runs[0] as RunLogEntry).items_fetched).toBe(5)
      expect((runs[0] as RunLogEntry).events_total).toBe(2)
      expect((runs[0] as RunLogEntry).events_triggered).toBe(1)
      expect((runs[0] as RunLogEntry).duration_ms).toBe(1000)
    })

    it('stores error information', () => {
      store.logRun(makeRun({ status: 'error', errors: 'fetch timeout' }))
      const runs = store.getRecentRuns('w1')
      expect((runs[0] as RunLogEntry).status).toBe('error')
      expect((runs[0] as RunLogEntry).errors).toBe('fetch timeout')
    })

    it('returns runs in reverse chronological order', () => {
      store.logRun(makeRun({ started_at: '2026-01-01T00:00:00Z' }))
      store.logRun(makeRun({ started_at: '2026-01-02T00:00:00Z' }))
      store.logRun(makeRun({ started_at: '2026-01-03T00:00:00Z' }))

      const runs = store.getRecentRuns('w1')
      expect(runs).toHaveLength(3)
      expect((runs[0] as RunLogEntry).started_at).toBe('2026-01-03T00:00:00Z')
      expect((runs[1] as RunLogEntry).started_at).toBe('2026-01-02T00:00:00Z')
      expect((runs[2] as RunLogEntry).started_at).toBe('2026-01-01T00:00:00Z')
    })

    it('respects limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        store.logRun(makeRun({ started_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))
      }
      const runs = store.getRecentRuns('w1', 5)
      expect(runs).toHaveLength(5)
    })

    it('defaults to 10 results', () => {
      for (let i = 0; i < 15; i++) {
        store.logRun(makeRun({ started_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))
      }
      const runs = store.getRecentRuns('w1')
      expect(runs).toHaveLength(10)
    })

    it('returns empty array for unknown watcher', () => {
      expect(store.getRecentRuns('unknown')).toEqual([])
    })

    it('isolates runs by watcher_id', () => {
      store.logRun(makeRun({ watcher_id: 'w1' }))
      store.logRun(makeRun({ watcher_id: 'w2' }))

      expect(store.getRecentRuns('w1')).toHaveLength(1)
      expect(store.getRecentRuns('w2')).toHaveLength(1)
    })
  })
})
