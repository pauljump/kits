# @pauljump/job-queue

SQLite-backed persistent job queue for the monorepo. Works with api-kit's `getDb()`.

Unlike `startCron()` (in-process intervals that vanish on restart), job-queue persists jobs to SQLite so they survive restarts, run at specific times, and retry on failure.

## Usage

```typescript
import { initJobTables, createJobQueue } from '@pauljump/job-queue'
import { getDb } from '@pauljump/api-kit'

const db = getDb({ path: './data/app.db' })
initJobTables(db)

const queue = createJobQueue(db)

// Register a handler
queue.register('send-weekly-report', async (payload) => {
  await generateAndSendReport(payload.userId)
})

// Schedule a recurring job (cron syntax)
queue.schedule({
  name: 'send-weekly-report',
  cron: '0 9 * * 0', // Sundays at 9am
  payload: { userId: 1 },
})

// Schedule a one-time job
queue.enqueue({
  name: 'send-weekly-report',
  payload: { userId: 1 },
  runAt: new Date('2026-03-20T09:00:00Z'),
})

// Start processing
queue.start({ pollIntervalMs: 5000 })

// Get job history
const history = queue.getHistory({ name: 'send-weekly-report', limit: 20 })
```

## Cron Syntax

Standard 5-field cron: `minute hour day month weekday`

| Field   | Values | Special |
|---------|--------|---------|
| minute  | 0-59   | *, lists (1,3), ranges (1-5), steps (*/15) |
| hour    | 0-23   | same |
| day     | 1-31   | same |
| month   | 1-12   | same |
| weekday | 0-6    | 0=Sunday |

## SQLite Tables

- **job_definitions** — registered recurring jobs (name, cron, payload, enabled, lastRunAt, nextRunAt)
- **job_runs** — individual job executions (id, name, status, payload, runAt, startedAt, completedAt, error, attempts)

## API

- `initJobTables(db)` — create tables (idempotent)
- `createJobQueue(db, config?)` — returns queue instance
- `queue.register(name, handler)` — register a job handler
- `queue.schedule(def)` — create/update a recurring job definition
- `queue.enqueue(opts)` — enqueue a one-time job
- `queue.start(config?)` — start polling for due jobs
- `queue.stop()` — stop polling
- `queue.getHistory(opts?)` — query past job runs
