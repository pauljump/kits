import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { SnapshotStore } from '../store.js'
import { diffSnapshots } from '../diff.js'
import type { DiffableItem } from '../types.js'

interface TestItem {
  name: string
  price: number
  status: string
}

function makeItem(key: string, data: Partial<TestItem> = {}): DiffableItem<TestItem> {
  return {
    key,
    data: { name: data.name ?? key, price: data.price ?? 100, status: data.status ?? 'active' },
  }
}

describe('diffSnapshots', () => {
  let db: Database.Database
  let store: SnapshotStore

  beforeEach(() => {
    db = new Database(':memory:')
    store = new SnapshotStore(db)
  })

  // ── Added items ──

  it('detects added items when no previous snapshot exists', () => {
    const items = [makeItem('a'), makeItem('b')]
    const { events } = diffSnapshots('w1', items, store)

    const added = events.filter(e => e.type === 'added')
    expect(added).toHaveLength(2)
    expect(added[0].key).toBe('a')
    expect(added[0].current).toEqual({ name: 'a', price: 100, status: 'active' })
    expect(added[0].previous).toBeNull()
    expect(added[0].timestamp).toBeTruthy()
  })

  it('detects newly added items alongside existing ones', () => {
    // First run seeds the store
    diffSnapshots('w1', [makeItem('a')], store)
    // Second run adds 'b'
    const { events } = diffSnapshots('w1', [makeItem('a'), makeItem('b')], store)

    const added = events.filter(e => e.type === 'added')
    expect(added).toHaveLength(1)
    expect(added[0].key).toBe('b')
  })

  it('re-adds an item that was previously removed', () => {
    // Seed, then remove by omitting
    diffSnapshots('w1', [makeItem('a')], store)
    diffSnapshots('w1', [], store) // removes 'a'

    // Now 'a' reappears
    const { events } = diffSnapshots('w1', [makeItem('a')], store)
    const added = events.filter(e => e.type === 'added')
    expect(added).toHaveLength(1)
    expect(added[0].key).toBe('a')
  })

  // ── Removed items ──

  it('detects removed items when not in current snapshot', () => {
    diffSnapshots('w1', [makeItem('a'), makeItem('b')], store)
    const { events } = diffSnapshots('w1', [makeItem('a')], store)

    const removed = events.filter(e => e.type === 'removed')
    expect(removed).toHaveLength(1)
    expect(removed[0].key).toBe('b')
    expect(removed[0].current).toBeNull()
    expect(removed[0].previous).toEqual({ name: 'b', price: 100, status: 'active' })
  })

  it('detects all items removed when current is empty', () => {
    diffSnapshots('w1', [makeItem('a'), makeItem('b'), makeItem('c')], store)
    const { events } = diffSnapshots('w1', [], store)

    const removed = events.filter(e => e.type === 'removed')
    expect(removed).toHaveLength(3)
    expect(removed.map(e => e.key).sort()).toEqual(['a', 'b', 'c'])
  })

  // ── Changed items ──

  it('detects changed items when data differs', () => {
    diffSnapshots('w1', [makeItem('a', { price: 100 })], store)
    const { events } = diffSnapshots('w1', [makeItem('a', { price: 200 })], store)

    const changed = events.filter(e => e.type === 'changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].key).toBe('a')
    expect(changed[0].current).toEqual({ name: 'a', price: 200, status: 'active' })
    expect(changed[0].previous).toEqual({ name: 'a', price: 100, status: 'active' })
  })

  it('populates changedFields correctly', () => {
    diffSnapshots('w1', [makeItem('a', { price: 100, status: 'active' })], store)
    const { events } = diffSnapshots('w1', [makeItem('a', { price: 200, status: 'sold' })], store)

    const changed = events.filter(e => e.type === 'changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].changedFields).toContain('price')
    expect(changed[0].changedFields).toContain('status')
    expect(changed[0].changedFields).not.toContain('name')
  })

  it('respects diffFields — only tracks specified fields', () => {
    diffSnapshots('w1', [makeItem('a', { price: 100, status: 'active' })], store, ['price'])
    const { events } = diffSnapshots(
      'w1',
      [makeItem('a', { price: 100, status: 'sold' })],
      store,
      ['price'],
    )

    // Status changed but we only diff on price, so this is unchanged
    const changed = events.filter(e => e.type === 'changed')
    expect(changed).toHaveLength(0)

    const unchanged = events.filter(e => e.type === 'unchanged')
    expect(unchanged).toHaveLength(1)
  })

  it('detects change on diffFields subset', () => {
    diffSnapshots('w1', [makeItem('a', { price: 100 })], store, ['price'])
    const { events } = diffSnapshots(
      'w1',
      [makeItem('a', { price: 200 })],
      store,
      ['price'],
    )

    const changed = events.filter(e => e.type === 'changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].changedFields).toEqual(['price'])
  })

  // ── Unchanged items ──

  it('marks items as unchanged when data is identical', () => {
    diffSnapshots('w1', [makeItem('a', { price: 100 })], store)
    const { events } = diffSnapshots('w1', [makeItem('a', { price: 100 })], store)

    const unchanged = events.filter(e => e.type === 'unchanged')
    expect(unchanged).toHaveLength(1)
    expect(unchanged[0].key).toBe('a')
    expect(unchanged[0].changedFields).toBeUndefined()
  })

  // ── Grace period logic ──

  it('without grace period, items are removed immediately', () => {
    diffSnapshots('w1', [makeItem('a')], store)
    const { events, pendingRemovals } = diffSnapshots('w1', [], store)

    expect(events.filter(e => e.type === 'removed')).toHaveLength(1)
    expect(pendingRemovals).toHaveLength(0)
  })

  it('with grace period, items enter pending_removal before removal', () => {
    // Use graceChecks=4 so we get 2 pending rounds before removal
    // Store logic: after increment, checks (missing_count + 1) >= graceChecks
    //   Miss 1: count=1, 1+1=2 >= 4? no → pending
    //   Miss 2: count=2, 2+1=3 >= 4? no → pending
    //   Miss 3: count=3, 3+1=4 >= 4? yes → removed
    const grace = { removalChecks: 4 }
    diffSnapshots('w1', [makeItem('a')], store, undefined, grace)

    // First miss — pending
    const r1 = diffSnapshots('w1', [], store, undefined, grace)
    expect(r1.events.filter(e => e.type === 'removed')).toHaveLength(0)
    expect(r1.pendingRemovals).toContain('a')

    // Second miss — still pending
    const r2 = diffSnapshots('w1', [], store, undefined, grace)
    expect(r2.events.filter(e => e.type === 'removed')).toHaveLength(0)
    expect(r2.pendingRemovals).toContain('a')

    // Third miss — removed
    const r3 = diffSnapshots('w1', [], store, undefined, grace)
    expect(r3.events.filter(e => e.type === 'removed')).toHaveLength(1)
    expect(r3.pendingRemovals).toHaveLength(0)
  })

  it('pending_removal item reactivates when seen again', () => {
    const grace = { removalChecks: 3 }
    diffSnapshots('w1', [makeItem('a')], store, undefined, grace)

    // Miss once
    diffSnapshots('w1', [], store, undefined, grace)

    // Item comes back
    const { events } = diffSnapshots('w1', [makeItem('a')], store, undefined, grace)

    // Should be unchanged (not added again), because it was still pending
    const unchanged = events.filter(e => e.type === 'unchanged')
    expect(unchanged).toHaveLength(1)
    expect(unchanged[0].key).toBe('a')

    // Verify store shows active
    const snap = store.getSnapshot('w1', 'a')
    expect(snap?.status).toBe('active')
    expect(snap?.missing_count).toBe(0)
  })

  // ── Mixed scenarios ──

  it('handles mixed added, changed, removed, and unchanged in one diff', () => {
    diffSnapshots('w1', [
      makeItem('keep', { price: 100 }),
      makeItem('change', { price: 50 }),
      makeItem('remove', { price: 75 }),
    ], store)

    const { events } = diffSnapshots('w1', [
      makeItem('keep', { price: 100 }),
      makeItem('change', { price: 999 }),
      makeItem('new', { price: 10 }),
    ], store)

    expect(events.find(e => e.key === 'keep')?.type).toBe('unchanged')
    expect(events.find(e => e.key === 'change')?.type).toBe('changed')
    expect(events.find(e => e.key === 'remove')?.type).toBe('removed')
    expect(events.find(e => e.key === 'new')?.type).toBe('added')
  })

  it('isolates watchers — different watcher IDs do not interfere', () => {
    diffSnapshots('w1', [makeItem('a')], store)
    diffSnapshots('w2', [makeItem('b')], store)

    // w1 should not see w2's item
    const { events } = diffSnapshots('w1', [makeItem('a'), makeItem('c')], store)
    expect(events.filter(e => e.type === 'added')).toHaveLength(1)
    expect(events.find(e => e.type === 'added')?.key).toBe('c')
  })
})
