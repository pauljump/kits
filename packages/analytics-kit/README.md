# @pauljump/analytics-kit

SQLite-backed event tracking for the monorepo. Drop into any project that uses `@pauljump/api-kit`'s `getDb()`.

## Setup

```typescript
import { initAnalyticsTables, createTracker } from '@pauljump/analytics-kit'
import { getDb } from '@pauljump/api-kit'

const db = getDb({ path: './data/app.db' })
initAnalyticsTables(db) // creates tables + indexes if they don't exist

const analytics = createTracker(db)
```

## API

### `track(params)`

Record an event.

```typescript
analytics.track({
  event: 'listing_viewed',
  userId: 'user-123',          // optional
  properties: { unitId: 456, source: 'search' },
})
```

### `identify(params)`

Attach traits to a user. Traits are merged (not replaced) on subsequent calls.

```typescript
analytics.identify({
  userId: 'user-123',
  traits: { email: 'paul@example.com', plan: 'basic' },
})
```

### `getEvents(query?)`

Query raw events. Returns newest first.

```typescript
const events = analytics.getEvents({
  event: 'listing_viewed',
  userId: 'user-123',
  since: '2026-03-01',
  limit: 100,
})
```

### `getCounts(query)`

Aggregate event counts grouped by time period.

```typescript
const counts = analytics.getCounts({
  event: 'listing_viewed',
  groupBy: 'day',    // 'hour' | 'day' | 'week' | 'month'
  since: '2026-03-01',
})
// [{ period: '2026-03-14', count: 42 }, { period: '2026-03-15', count: 38 }]
```

### `getUniques(query)`

Count unique users per time period.

```typescript
const uniques = analytics.getUniques({
  event: 'listing_viewed',
  since: '2026-03-01',
  groupBy: 'day',
})
```

### `getFunnel(query)`

Funnel analysis across a sequence of events.

```typescript
const funnel = analytics.getFunnel({
  steps: ['listing_viewed', 'checkout_started', 'payment_completed'],
  since: '2026-03-01',
})
// [{ step: 'listing_viewed', count: 100 }, { step: 'checkout_started', count: 25 }, ...]
```

## SQLite Tables

- `analytics_events` — id, event, userId, properties (JSON), timestamp
- `analytics_users` — userId, traits (JSON), firstSeen, lastSeen

Indexes on `(event, timestamp)` and `(userId, timestamp)` for fast queries.
