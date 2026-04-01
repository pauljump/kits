/**
 * watch-kit types.
 *
 * Core abstraction: Watcher fetches data → SnapshotStore diffs it →
 * Conditions evaluate → Actions dispatch.
 *
 * Design principles:
 * - Conditions are functions, not a DSL (not enough use cases to know the grammar)
 * - Any () => Promise<T> is a valid source (don't mandate etl-kit)
 * - Events carry full context (current + previous + diff) for downstream consumers
 * - watch-kit doesn't own scheduling — it provides what happens when data arrives
 */

import type Database from 'better-sqlite3'

// ── Source: how to get data ──

/** User-provided function that fetches current state. Any shape. */
export type FetchFn<T> = () => Promise<T>

/**
 * User-provided function that extracts a diffable record set from raw fetched data.
 * Returns an array of items, each with a unique key for tracking.
 */
export type ExtractFn<TRaw, TItem> = (raw: TRaw) => DiffableItem<TItem>[]

export interface DiffableItem<T> {
  /** Unique key for this item (e.g., unit_number + property, case_id) */
  key: string
  /** The full data payload */
  data: T
}

// ── Events: what changed ──

export type WatchEventType = 'added' | 'removed' | 'changed' | 'unchanged'

export interface WatchEvent<T> {
  type: WatchEventType
  key: string
  /** Current data (null for 'removed') */
  current: T | null
  /** Previous data (null for 'added') */
  previous: T | null
  /** Which fields changed (for 'changed' events) */
  changedFields?: string[]
  /** Timestamp of this evaluation */
  timestamp: string
}

export interface WatchResult<T> {
  /** All events from this evaluation */
  events: WatchEvent<T>[]
  /** Only events that matched at least one condition */
  triggered: WatchEvent<T>[]
  /** Run metadata */
  run: RunLogEntry
}

// ── Conditions: which events matter ──

/**
 * A condition is a simple predicate on a WatchEvent.
 * If it returns true, the event is "triggered" and actions fire.
 */
export type ConditionFn<T> = (event: WatchEvent<T>) => boolean

/** Named condition for audit logging. */
export interface Condition<T> {
  name: string
  fn: ConditionFn<T>
}

// ── Actions: what to do about it ──

/** Action receives triggered events + watcher context. */
export type ActionFn<T> = (events: WatchEvent<T>[], watcher: WatcherMeta) => Promise<void> | void

export interface Action<T> {
  name: string
  fn: ActionFn<T>
}

/** Minimal watcher info passed to actions (avoids generic variance issues). */
export interface WatcherMeta {
  id: string
  name: string
}

// ── Grace periods: delayed state transitions ──

export interface GraceConfig {
  /**
   * How many consecutive "missing" evaluations before an item is considered truly removed.
   * Default: 0 (immediate removal). StuyWatch uses ~7 days worth of checks.
   */
  removalChecks: number
}

// ── Watcher: the full config ──

export interface WatcherConfig<TRaw, TItem> {
  /** Unique ID for this watcher */
  id: string
  /** Human-readable name */
  name: string
  /** Fetch current state from source */
  fetch: FetchFn<TRaw>
  /** Extract diffable items from raw data */
  extract: ExtractFn<TRaw, TItem>
  /** Which fields to compare for 'changed' detection. If omitted, deep-equals entire data object. */
  diffFields?: (keyof TItem & string)[]
  /** Conditions that determine which events trigger actions */
  conditions: Condition<TItem>[]
  /** Actions to run when conditions match */
  actions: Action<TItem>[]
  /** Grace period before removal (optional) */
  grace?: GraceConfig
}

// ── Snapshot store ──

export interface Snapshot {
  watcher_id: string
  item_key: string
  data_json: string
  first_seen_at: string
  last_seen_at: string
  /** How many consecutive evaluations this item has been missing */
  missing_count: number
  /** 'active' | 'pending_removal' | 'removed' */
  status: string
}

// ── Run log ──

export interface RunLogEntry {
  watcher_id: string
  started_at: string
  finished_at: string
  status: 'success' | 'error'
  items_fetched: number
  events_total: number
  events_triggered: number
  errors: string | null
  duration_ms: number
}

// ── Engine ──

export interface WatchEngineConfig {
  /** SQLite database instance (from api-kit's getDb or standalone) */
  db: Database.Database
}
