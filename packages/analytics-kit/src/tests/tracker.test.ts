import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initAnalyticsTables } from '../setup.js'
import { createTracker } from '../tracker.js'
import type { Tracker } from '../tracker.js'

function createTestDb() {
  const db = new Database(':memory:')
  initAnalyticsTables(db)
  return db
}

describe('initAnalyticsTables', () => {
  it('creates analytics_events and analytics_users tables', () => {
    const db = new Database(':memory:')
    initAnalyticsTables(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)

    expect(names).toContain('analytics_events')
    expect(names).toContain('analytics_users')
  })

  it('creates indexes on analytics_events', () => {
    const db = new Database(':memory:')
    initAnalyticsTables(db)

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='analytics_events'")
      .all() as Array<{ name: string }>
    const names = indexes.map((i) => i.name)

    expect(names).toContain('idx_events_event_ts')
    expect(names).toContain('idx_events_user_ts')
  })

  it('is idempotent — calling twice does not error', () => {
    const db = new Database(':memory:')
    initAnalyticsTables(db)
    expect(() => initAnalyticsTables(db)).not.toThrow()
  })
})

describe('track()', () => {
  let db: Database.Database
  let tracker: Tracker

  beforeEach(() => {
    db = createTestDb()
    tracker = createTracker(db)
  })

  it('records an event with default properties', () => {
    tracker.track({ event: 'page_view' })

    const events = tracker.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('page_view')
    expect(events[0].properties).toEqual({})
    expect(events[0].userId).toBeNull()
    expect(events[0].id).toBe(1)
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('records an event with properties', () => {
    tracker.track({
      event: 'button_click',
      properties: { page: '/home', variant: 'blue' },
    })

    const events = tracker.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0].properties).toEqual({ page: '/home', variant: 'blue' })
  })

  it('records an event with userId', () => {
    tracker.track({ event: 'login', userId: 'user-42' })

    const events = tracker.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0].userId).toBe('user-42')
  })

  it('records multiple events with auto-incrementing ids', () => {
    tracker.track({ event: 'a' })
    tracker.track({ event: 'b' })
    tracker.track({ event: 'c' })

    const events = tracker.getEvents()
    expect(events).toHaveLength(3)
    // getEvents returns DESC order, so newest first
    const ids = events.map((e) => e.id).sort()
    expect(ids).toEqual([1, 2, 3])
  })
})

describe('identify()', () => {
  let db: Database.Database
  let tracker: Tracker

  beforeEach(() => {
    db = createTestDb()
    tracker = createTracker(db)
  })

  it('creates a user with traits', () => {
    tracker.identify({ userId: 'user-1', traits: { name: 'Alice', plan: 'pro' } })

    const row = db
      .prepare('SELECT userId, traits, firstSeen, lastSeen FROM analytics_users WHERE userId = ?')
      .get('user-1') as { userId: string; traits: string; firstSeen: string; lastSeen: string }

    expect(row.userId).toBe('user-1')
    expect(JSON.parse(row.traits)).toEqual({ name: 'Alice', plan: 'pro' })
    expect(row.firstSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(row.lastSeen).toBe(row.firstSeen)
  })

  it('merges traits on repeat call via json_patch', () => {
    tracker.identify({ userId: 'user-1', traits: { name: 'Alice', plan: 'free' } })
    tracker.identify({ userId: 'user-1', traits: { plan: 'pro', company: 'Acme' } })

    const row = db
      .prepare('SELECT traits FROM analytics_users WHERE userId = ?')
      .get('user-1') as { traits: string }

    const traits = JSON.parse(row.traits)
    expect(traits.name).toBe('Alice')       // preserved from first call
    expect(traits.plan).toBe('pro')         // overwritten by second call
    expect(traits.company).toBe('Acme')     // added by second call
  })

  it('updates lastSeen but preserves firstSeen on repeat call', () => {
    // Use vi.useFakeTimers to control Date
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'))

    const t = createTracker(db)
    t.identify({ userId: 'user-1', traits: { a: 1 } })

    vi.setSystemTime(new Date('2026-01-02T12:00:00.000Z'))
    t.identify({ userId: 'user-1', traits: { b: 2 } })

    const row = db
      .prepare('SELECT firstSeen, lastSeen FROM analytics_users WHERE userId = ?')
      .get('user-1') as { firstSeen: string; lastSeen: string }

    expect(row.firstSeen).toBe('2026-01-01T10:00:00Z')
    expect(row.lastSeen).toBe('2026-01-02T12:00:00Z')

    vi.useRealTimers()
  })
})

describe('getEvents()', () => {
  let db: Database.Database
  let tracker: Tracker

  beforeEach(() => {
    db = createTestDb()
    tracker = createTracker(db)
  })

  it('returns all events when no query is provided', () => {
    tracker.track({ event: 'a' })
    tracker.track({ event: 'b' })

    const events = tracker.getEvents()
    expect(events).toHaveLength(2)
  })

  it('returns events in descending timestamp order', () => {
    // Insert with explicit timestamps to ensure order
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('first', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('second', '2026-01-02T00:00:00Z')"
    ).run()

    const events = tracker.getEvents()
    expect(events[0].event).toBe('second')
    expect(events[1].event).toBe('first')
  })

  it('filters by event name', () => {
    tracker.track({ event: 'page_view' })
    tracker.track({ event: 'click' })
    tracker.track({ event: 'page_view' })

    const events = tracker.getEvents({ event: 'page_view' })
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.event === 'page_view')).toBe(true)
  })

  it('filters by userId', () => {
    tracker.track({ event: 'a', userId: 'u1' })
    tracker.track({ event: 'b', userId: 'u2' })
    tracker.track({ event: 'c', userId: 'u1' })

    const events = tracker.getEvents({ userId: 'u1' })
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.userId === 'u1')).toBe(true)
  })

  it('filters by since', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('old', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('new', '2026-01-10T00:00:00Z')"
    ).run()

    const events = tracker.getEvents({ since: '2026-01-05T00:00:00Z' })
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('new')
  })

  it('filters by until', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('old', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('new', '2026-01-10T00:00:00Z')"
    ).run()

    const events = tracker.getEvents({ until: '2026-01-05T00:00:00Z' })
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('old')
  })

  it('filters by since and until together', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('a', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('b', '2026-01-05T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('c', '2026-01-10T00:00:00Z')"
    ).run()

    const events = tracker.getEvents({
      since: '2026-01-03T00:00:00Z',
      until: '2026-01-07T00:00:00Z',
    })
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('b')
  })

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      tracker.track({ event: `event-${i}` })
    }

    const events = tracker.getEvents({ limit: 3 })
    expect(events).toHaveLength(3)
  })

  it('combines event filter with limit', () => {
    for (let i = 0; i < 5; i++) {
      tracker.track({ event: 'target' })
      tracker.track({ event: 'noise' })
    }

    const events = tracker.getEvents({ event: 'target', limit: 2 })
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.event === 'target')).toBe(true)
  })

  it('returns empty array when no events match', () => {
    tracker.track({ event: 'a' })
    const events = tracker.getEvents({ event: 'nonexistent' })
    expect(events).toEqual([])
  })
})

describe('getCounts()', () => {
  let db: Database.Database
  let tracker: Tracker

  beforeEach(() => {
    db = createTestDb()
    tracker = createTracker(db)
  })

  it('groups by day', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-01T10:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-01T14:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-02T08:00:00Z')"
    ).run()

    const counts = tracker.getCounts({ event: 'pv', groupBy: 'day' })
    expect(counts).toEqual([
      { period: '2026-01-01', count: 2 },
      { period: '2026-01-02', count: 1 },
    ])
  })

  it('groups by hour', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-01T10:05:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-01T10:30:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-01T11:00:00Z')"
    ).run()

    const counts = tracker.getCounts({ event: 'pv', groupBy: 'hour' })
    expect(counts).toHaveLength(2)
    expect(counts[0]).toEqual({ period: '2026-01-01T10:00:00Z', count: 2 })
    expect(counts[1]).toEqual({ period: '2026-01-01T11:00:00Z', count: 1 })
  })

  it('groups by month', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-15T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-20T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-02-01T00:00:00Z')"
    ).run()

    const counts = tracker.getCounts({ event: 'pv', groupBy: 'month' })
    expect(counts).toEqual([
      { period: '2026-01', count: 2 },
      { period: '2026-02', count: 1 },
    ])
  })

  it('filters by since and until', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-05T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-10T00:00:00Z')"
    ).run()

    const counts = tracker.getCounts({
      event: 'pv',
      groupBy: 'day',
      since: '2026-01-03T00:00:00Z',
      until: '2026-01-07T00:00:00Z',
    })
    expect(counts).toHaveLength(1)
    expect(counts[0].count).toBe(1)
  })

  it('only counts events matching the specified event name', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('pv', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('click', '2026-01-01T00:00:00Z')"
    ).run()

    const counts = tracker.getCounts({ event: 'pv', groupBy: 'day' })
    expect(counts).toHaveLength(1)
    expect(counts[0].count).toBe(1)
  })

  it('returns empty array when no events match', () => {
    const counts = tracker.getCounts({ event: 'nonexistent', groupBy: 'day' })
    expect(counts).toEqual([])
  })
})

describe('getUniques()', () => {
  let db: Database.Database
  let tracker: Tracker

  beforeEach(() => {
    db = createTestDb()
    tracker = createTracker(db)
  })

  it('counts distinct users per day', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u1', '2026-01-01T10:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u1', '2026-01-01T11:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u2', '2026-01-01T12:00:00Z')"
    ).run()

    const uniques = tracker.getUniques({ event: 'pv', groupBy: 'day' })
    expect(uniques).toHaveLength(1)
    expect(uniques[0]).toEqual({ period: '2026-01-01', count: 2 })
  })

  it('counts distinct users across multiple days', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u1', '2026-01-01T10:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u2', '2026-01-01T11:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u1', '2026-01-02T10:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u2', '2026-01-02T11:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u3', '2026-01-02T12:00:00Z')"
    ).run()

    const uniques = tracker.getUniques({ event: 'pv', groupBy: 'day' })
    expect(uniques).toEqual([
      { period: '2026-01-01', count: 2 },
      { period: '2026-01-02', count: 3 },
    ])
  })

  it('filters by since and until', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u1', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u2', '2026-01-05T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u3', '2026-01-10T00:00:00Z')"
    ).run()

    const uniques = tracker.getUniques({
      event: 'pv',
      groupBy: 'day',
      since: '2026-01-03T00:00:00Z',
      until: '2026-01-07T00:00:00Z',
    })
    expect(uniques).toHaveLength(1)
    expect(uniques[0].count).toBe(1)
  })

  it('groups by month', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u1', '2026-01-15T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u1', '2026-01-20T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('pv', 'u2', '2026-02-01T00:00:00Z')"
    ).run()

    const uniques = tracker.getUniques({ event: 'pv', groupBy: 'month' })
    expect(uniques).toEqual([
      { period: '2026-01', count: 1 },
      { period: '2026-02', count: 1 },
    ])
  })

  it('returns empty array when no events match', () => {
    const uniques = tracker.getUniques({ event: 'nonexistent', groupBy: 'day' })
    expect(uniques).toEqual([])
  })
})

describe('getFunnel()', () => {
  let db: Database.Database
  let tracker: Tracker

  beforeEach(() => {
    db = createTestDb()
    tracker = createTracker(db)
  })

  it('returns counts for each funnel step', () => {
    // Simulate a signup funnel: 10 views, 5 signups, 2 purchases
    for (let i = 0; i < 10; i++) {
      db.prepare(
        "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('view', ?, '2026-01-01T00:00:00Z')"
      ).run(`u${i}`)
    }
    for (let i = 0; i < 5; i++) {
      db.prepare(
        "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('signup', ?, '2026-01-01T01:00:00Z')"
      ).run(`u${i}`)
    }
    for (let i = 0; i < 2; i++) {
      db.prepare(
        "INSERT INTO analytics_events (event, userId, timestamp) VALUES ('purchase', ?, '2026-01-01T02:00:00Z')"
      ).run(`u${i}`)
    }

    const funnel = tracker.getFunnel({ steps: ['view', 'signup', 'purchase'] })
    expect(funnel).toEqual([
      { step: 'view', count: 10 },
      { step: 'signup', count: 5 },
      { step: 'purchase', count: 2 },
    ])
  })

  it('returns zero for steps with no events', () => {
    tracker.track({ event: 'view' })

    const funnel = tracker.getFunnel({ steps: ['view', 'signup'] })
    expect(funnel).toEqual([
      { step: 'view', count: 1 },
      { step: 'signup', count: 0 },
    ])
  })

  it('filters by since and until', () => {
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('view', '2026-01-01T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('view', '2026-01-05T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('view', '2026-01-10T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO analytics_events (event, timestamp) VALUES ('signup', '2026-01-05T01:00:00Z')"
    ).run()

    const funnel = tracker.getFunnel({
      steps: ['view', 'signup'],
      since: '2026-01-03T00:00:00Z',
      until: '2026-01-07T00:00:00Z',
    })
    expect(funnel).toEqual([
      { step: 'view', count: 1 },
      { step: 'signup', count: 1 },
    ])
  })

  it('returns empty counts for empty steps array', () => {
    tracker.track({ event: 'view' })
    const funnel = tracker.getFunnel({ steps: [] })
    expect(funnel).toEqual([])
  })
})
