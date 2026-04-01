/**
 * Watch engine — the main orchestrator.
 *
 * register() a watcher, then call evaluate() when it's time to check.
 * watch-kit doesn't own scheduling — call evaluate() from api-kit's
 * startCron, a webhook handler, or wherever.
 */

import type {
  WatcherConfig,
  WatchEvent,
  WatchResult,
  WatchEngineConfig,
  RunLogEntry,
} from './types.js'
import { SnapshotStore } from './store.js'
import { diffSnapshots } from './diff.js'

export class WatchEngine {
  private store: SnapshotStore
  private watchers = new Map<string, WatcherConfig<any, any>>()

  constructor(config: WatchEngineConfig) {
    this.store = new SnapshotStore(config.db)
  }

  /** Register a watcher. Can be called multiple times to update config. */
  register<TRaw, TItem>(watcher: WatcherConfig<TRaw, TItem>): void {
    this.watchers.set(watcher.id, watcher)
  }

  /** Unregister a watcher. */
  unregister(watcherId: string): void {
    this.watchers.delete(watcherId)
  }

  /** Get a registered watcher config. */
  getWatcher(watcherId: string): WatcherConfig<any, any> | undefined {
    return this.watchers.get(watcherId)
  }

  /** List all registered watcher IDs. */
  listWatchers(): string[] {
    return Array.from(this.watchers.keys())
  }

  /**
   * Evaluate a watcher: fetch → extract → diff → evaluate conditions → dispatch actions.
   *
   * Call this from startCron, a route handler, or wherever.
   * Returns the full result including all events and which ones triggered.
   */
  async evaluate<TRaw, TItem>(watcherId: string): Promise<WatchResult<TItem>> {
    const watcher = this.watchers.get(watcherId) as WatcherConfig<TRaw, TItem> | undefined
    if (!watcher) {
      throw new Error(`Watcher "${watcherId}" not registered`)
    }

    const startedAt = new Date().toISOString()
    const startMs = Date.now()

    try {
      // 1. Fetch raw data from source
      const raw = await watcher.fetch()

      // 2. Extract diffable items
      const items = watcher.extract(raw)

      // 3. Diff against stored snapshots
      const { events } = diffSnapshots(
        watcher.id,
        items,
        this.store,
        watcher.diffFields,
        watcher.grace,
      )

      // 4. Evaluate conditions — filter to triggered events
      const triggered = events.filter(event => {
        if (event.type === 'unchanged') return false
        return watcher.conditions.some(cond => cond.fn(event))
      })

      // 5. Dispatch actions for triggered events
      if (triggered.length > 0) {
        for (const action of watcher.actions) {
          try {
            await action.fn(triggered, { id: watcher.id, name: watcher.name })
          } catch (err) {
            console.error(`[watch-kit] Action "${action.name}" failed for watcher "${watcherId}":`, err)
          }
        }
      }

      // 6. Log the run
      const finishedAt = new Date().toISOString()
      const run: RunLogEntry = {
        watcher_id: watcherId,
        started_at: startedAt,
        finished_at: finishedAt,
        status: 'success',
        items_fetched: items.length,
        events_total: events.filter(e => e.type !== 'unchanged').length,
        events_triggered: triggered.length,
        errors: null,
        duration_ms: Date.now() - startMs,
      }
      this.store.logRun(run)

      return { events, triggered, run }
    } catch (err) {
      const finishedAt = new Date().toISOString()
      const run: RunLogEntry = {
        watcher_id: watcherId,
        started_at: startedAt,
        finished_at: finishedAt,
        status: 'error',
        items_fetched: 0,
        events_total: 0,
        events_triggered: 0,
        errors: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startMs,
      }
      this.store.logRun(run)

      throw err
    }
  }

  /** Get recent run history for a watcher. */
  getRunHistory(watcherId: string, limit: number = 10): RunLogEntry[] {
    return this.store.getRecentRuns(watcherId, limit) as RunLogEntry[]
  }

  /** Direct access to the snapshot store (for advanced use cases). */
  getStore(): SnapshotStore {
    return this.store
  }
}
