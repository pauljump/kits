/**
 * Diff engine — compares current items against stored snapshots.
 *
 * Produces typed WatchEvents: added, removed, changed, unchanged.
 * Handles grace periods for removal (StuyWatch's pending pattern).
 */

import type { DiffableItem, WatchEvent, GraceConfig, Snapshot } from './types.js'
import type { SnapshotStore } from './store.js'

export interface DiffResult<T> {
  events: WatchEvent<T>[]
  /** Items that are pending removal but haven't hit grace threshold yet */
  pendingRemovals: string[]
}

export function diffSnapshots<T>(
  watcherId: string,
  currentItems: DiffableItem<T>[],
  store: SnapshotStore,
  diffFields?: (keyof T & string)[],
  grace?: GraceConfig,
): DiffResult<T> {
  const now = new Date().toISOString()
  const events: WatchEvent<T>[] = []
  const pendingRemovals: string[] = []

  // Get all existing snapshots for this watcher
  const existingSnapshots = store.getSnapshots(watcherId)
  const existingByKey = new Map<string, Snapshot>()
  for (const snap of existingSnapshots) {
    existingByKey.set(snap.item_key, snap)
  }

  // Track which keys we see in current data
  const seenKeys = new Set<string>()

  // Process current items
  for (const item of currentItems) {
    seenKeys.add(item.key)
    const existing = existingByKey.get(item.key)
    const dataJson = JSON.stringify(item.data)

    if (!existing || existing.status === 'removed') {
      // New item
      events.push({
        type: 'added',
        key: item.key,
        current: item.data,
        previous: null,
        timestamp: now,
      })
    } else {
      // Existing item — check for changes
      const previousData = JSON.parse(existing.data_json) as T
      const changedFields = detectChanges(previousData, item.data, diffFields)

      if (changedFields.length > 0) {
        events.push({
          type: 'changed',
          key: item.key,
          current: item.data,
          previous: previousData,
          changedFields,
          timestamp: now,
        })
      } else {
        events.push({
          type: 'unchanged',
          key: item.key,
          current: item.data,
          previous: previousData,
          timestamp: now,
        })
      }
    }

    // Update snapshot (reactivates pending_removal items too)
    store.upsertSnapshot(watcherId, item.key, dataJson, now)
  }

  // Handle missing items (were active, not in current data)
  const graceChecks = grace?.removalChecks ?? 0

  for (const [key, snap] of existingByKey) {
    if (seenKeys.has(key)) continue
    if (snap.status === 'removed') continue

    if (graceChecks <= 0) {
      // No grace period — immediate removal
      store.markMissing(watcherId, key, 0)
      const previousData = JSON.parse(snap.data_json) as T
      events.push({
        type: 'removed',
        key,
        current: null,
        previous: previousData,
        timestamp: now,
      })
    } else {
      // Grace period — increment missing count
      const result = store.markMissing(watcherId, key, graceChecks)
      if (result === 'removed') {
        const previousData = JSON.parse(snap.data_json) as T
        events.push({
          type: 'removed',
          key,
          current: null,
          previous: previousData,
          timestamp: now,
        })
      } else {
        pendingRemovals.push(key)
      }
    }
  }

  return { events, pendingRemovals }
}

/**
 * Detect which fields changed between two objects.
 * If diffFields is provided, only checks those fields.
 * Otherwise compares all top-level fields.
 */
function detectChanges<T>(
  previous: T,
  current: T,
  diffFields?: (keyof T & string)[],
): string[] {
  const changed: string[] = []

  if (!previous || !current) return changed

  const fields = diffFields || (Object.keys(current as Record<string, unknown>) as (keyof T & string)[])

  for (const field of fields) {
    const prevVal = previous[field]
    const currVal = current[field]

    // JSON comparison for objects/arrays, strict equality for primitives
    if (typeof prevVal === 'object' || typeof currVal === 'object') {
      if (JSON.stringify(prevVal) !== JSON.stringify(currVal)) {
        changed.push(field as string)
      }
    } else if (prevVal !== currVal) {
      changed.push(field as string)
    }
  }

  return changed
}
