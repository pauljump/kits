import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initJobTables } from '../setup.js'
import { createJobQueue } from '../queue.js'

function createTestDb() {
  const db = new Database(':memory:')
  initJobTables(db)
  return db
}

const silentLogger = {
  info: () => {},
  error: () => {},
}

describe('initJobTables', () => {
  it('creates job_definitions and job_runs tables', () => {
    const db = new Database(':memory:')
    initJobTables(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    const tableNames = tables.map((t) => t.name)

    expect(tableNames).toContain('job_definitions')
    expect(tableNames).toContain('job_runs')
  })

  it('creates indexes on job_runs', () => {
    const db = new Database(':memory:')
    initJobTables(db)

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='job_runs'")
      .all() as Array<{ name: string }>
    const indexNames = indexes.map((i) => i.name)

    expect(indexNames).toContain('idx_job_runs_status_runAt')
    expect(indexNames).toContain('idx_job_runs_name')
  })

  it('is idempotent — calling twice does not throw', () => {
    const db = new Database(':memory:')
    initJobTables(db)
    expect(() => initJobTables(db)).not.toThrow()
  })
})

describe('createJobQueue', () => {
  let db: InstanceType<typeof Database>
  let queue: ReturnType<typeof createJobQueue>

  beforeEach(() => {
    db = createTestDb()
    queue = createJobQueue(db, { logger: silentLogger })
  })

  afterEach(() => {
    queue.stop()
    db.close()
  })

  describe('register + enqueue + processDueJobs', () => {
    it('executes a handler for an enqueued job', async () => {
      const results: Record<string, unknown>[] = []
      queue.register('test-job', async (payload) => {
        results.push(payload)
      })

      queue.enqueue({ name: 'test-job', payload: { key: 'value' } })

      // Access processDueJobs through start — but we'll call it via the internal mechanism
      // We can use start with a very short interval, or directly test via getHistory
      // Since processDueJobs is not exported, we trigger it via start()
      // Use a short interval and wait
      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({ key: 'value' })
    })

    it('marks job as completed after successful execution', async () => {
      queue.register('simple', async () => {})
      queue.enqueue({ name: 'simple' })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      const history = queue.getHistory({ name: 'simple' })
      expect(history).toHaveLength(1)
      expect(history[0]!.status).toBe('completed')
      expect(history[0]!.completedAt).toBeTruthy()
      expect(history[0]!.error).toBeNull()
    })

    it('handles jobs with no payload', async () => {
      const called = vi.fn()
      queue.register('no-payload', async (payload) => {
        called(payload)
      })
      queue.enqueue({ name: 'no-payload' })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      expect(called).toHaveBeenCalledWith({})
    })

    it('marks job as failed when no handler is registered', async () => {
      queue.enqueue({ name: 'unregistered-job' })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      const history = queue.getHistory({ name: 'unregistered-job' })
      expect(history).toHaveLength(1)
      expect(history[0]!.status).toBe('failed')
      expect(history[0]!.error).toBe('No handler registered')
    })

    it('processes multiple jobs in order', async () => {
      const order: string[] = []
      queue.register('ordered', async (payload) => {
        order.push(payload.id as string)
      })

      queue.enqueue({ name: 'ordered', payload: { id: 'first' } })
      queue.enqueue({ name: 'ordered', payload: { id: 'second' } })
      queue.enqueue({ name: 'ordered', payload: { id: 'third' } })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 200))
      queue.stop()

      expect(order).toEqual(['first', 'second', 'third'])
    })
  })

  describe('enqueue with runAt', () => {
    it('does not process future-dated jobs', async () => {
      const called = vi.fn()
      queue.register('future', async () => { called() })

      const future = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
      queue.enqueue({ name: 'future', runAt: future })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      expect(called).not.toHaveBeenCalled()
    })

    it('processes past-dated jobs immediately', async () => {
      const called = vi.fn()
      queue.register('past', async () => { called() })

      const past = new Date(Date.now() - 60 * 1000) // 1 minute ago
      queue.enqueue({ name: 'past', runAt: past })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      expect(called).toHaveBeenCalledOnce()
    })
  })

  describe('schedule (recurring jobs)', () => {
    it('creates a job definition and an initial run', () => {
      queue.register('cron-job', async () => {})
      queue.schedule({ name: 'cron-job', cron: '*/5 * * * *' })

      const def = db
        .prepare('SELECT * FROM job_definitions WHERE name = ?')
        .get('cron-job') as Record<string, unknown> | undefined
      expect(def).toBeDefined()
      expect(def!.cron).toBe('*/5 * * * *')
      expect(def!.enabled).toBe(1)
      expect(def!.nextRunAt).toBeTruthy()

      const runs = db
        .prepare('SELECT * FROM job_runs WHERE name = ?')
        .all('cron-job') as unknown[]
      expect(runs).toHaveLength(1)
    })

    it('stores payload in the definition', () => {
      queue.register('payload-cron', async () => {})
      queue.schedule({
        name: 'payload-cron',
        cron: '0 * * * *',
        payload: { source: 'test' },
      })

      const def = db
        .prepare('SELECT payload FROM job_definitions WHERE name = ?')
        .get('payload-cron') as { payload: string }
      expect(JSON.parse(def.payload)).toEqual({ source: 'test' })
    })

    it('upserts on duplicate schedule name', () => {
      queue.register('upsert-job', async () => {})
      queue.schedule({ name: 'upsert-job', cron: '0 * * * *' })
      queue.schedule({ name: 'upsert-job', cron: '*/10 * * * *' })

      const defs = db
        .prepare('SELECT * FROM job_definitions WHERE name = ?')
        .all('upsert-job') as unknown[]
      expect(defs).toHaveLength(1)

      const def = defs[0] as Record<string, unknown>
      expect(def.cron).toBe('*/10 * * * *')
    })

    it('schedules next run after completing a recurring job', async () => {
      queue.register('recurring', async () => {})
      queue.schedule({ name: 'recurring', cron: '* * * * *' })

      // Manually set the first run to be due now
      db.prepare("UPDATE job_runs SET runAt = datetime('now', '-1 minute') WHERE name = 'recurring'").run()

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 200))
      queue.stop()

      const runs = db
        .prepare("SELECT * FROM job_runs WHERE name = 'recurring' ORDER BY id")
        .all() as Array<Record<string, unknown>>

      // Should have the original run (completed) + a new scheduled run
      expect(runs.length).toBeGreaterThanOrEqual(2)
      expect(runs[0]!.status).toBe('completed')
      // The second run should be pending (the next scheduled occurrence)
      const pendingRuns = runs.filter((r) => r.status === 'pending')
      expect(pendingRuns.length).toBeGreaterThanOrEqual(1)
    })

    it('respects enabled=false', () => {
      queue.register('disabled', async () => {})
      queue.schedule({ name: 'disabled', cron: '0 * * * *', enabled: false })

      const def = db
        .prepare('SELECT enabled FROM job_definitions WHERE name = ?')
        .get('disabled') as { enabled: number }
      expect(def.enabled).toBe(0)
    })
  })

  describe('failed jobs and retries', () => {
    it('retries a failed job up to maxRetries', async () => {
      let attempts = 0
      queue.register('flaky', async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('transient failure')
        }
      })

      queue.enqueue({ name: 'flaky' })
      queue.start({ pollIntervalMs: 10, maxRetries: 5 })
      await new Promise((r) => setTimeout(r, 500))
      queue.stop()

      const history = queue.getHistory({ name: 'flaky' })
      expect(history).toHaveLength(1)
      expect(history[0]!.status).toBe('completed')
      expect(history[0]!.attempts).toBeGreaterThanOrEqual(3)
    })

    it('marks job as failed after exhausting retries', async () => {
      queue.register('always-fails', async () => {
        throw new Error('permanent failure')
      })

      queue.enqueue({ name: 'always-fails' })
      queue.start({ pollIntervalMs: 10, maxRetries: 2 })
      await new Promise((r) => setTimeout(r, 300))
      queue.stop()

      const history = queue.getHistory({ name: 'always-fails' })
      expect(history).toHaveLength(1)
      expect(history[0]!.status).toBe('failed')
      expect(history[0]!.error).toBe('permanent failure')
      expect(history[0]!.attempts).toBe(2)
    })

    it('records error message from thrown Error', async () => {
      queue.register('error-msg', async () => {
        throw new Error('specific error message')
      })

      queue.enqueue({ name: 'error-msg' })
      queue.start({ pollIntervalMs: 10, maxRetries: 1 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      const history = queue.getHistory({ name: 'error-msg' })
      expect(history[0]!.error).toBe('specific error message')
    })

    it('records error from non-Error throws', async () => {
      queue.register('string-throw', async () => {
        throw 'string error'
      })

      queue.enqueue({ name: 'string-throw' })
      queue.start({ pollIntervalMs: 10, maxRetries: 1 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      const history = queue.getHistory({ name: 'string-throw' })
      expect(history[0]!.error).toBe('string error')
    })
  })

  describe('getHistory', () => {
    it('returns completed and failed jobs', async () => {
      queue.register('success', async () => {})
      queue.register('failure', async () => {
        throw new Error('boom')
      })

      queue.enqueue({ name: 'success' })
      queue.enqueue({ name: 'failure' })

      queue.start({ pollIntervalMs: 10, maxRetries: 1 })
      await new Promise((r) => setTimeout(r, 200))
      queue.stop()

      const history = queue.getHistory()
      expect(history).toHaveLength(2)

      const statuses = history.map((h) => h.status).sort()
      expect(statuses).toEqual(['completed', 'failed'])
    })

    it('filters by name', async () => {
      queue.register('alpha', async () => {})
      queue.register('beta', async () => {})

      queue.enqueue({ name: 'alpha' })
      queue.enqueue({ name: 'beta' })
      queue.enqueue({ name: 'alpha' })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 200))
      queue.stop()

      const alphaHistory = queue.getHistory({ name: 'alpha' })
      expect(alphaHistory).toHaveLength(2)
      expect(alphaHistory.every((h) => h.name === 'alpha')).toBe(true)
    })

    it('respects limit option', async () => {
      queue.register('limited', async () => {})

      for (let i = 0; i < 10; i++) {
        queue.enqueue({ name: 'limited' })
      }

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 300))
      queue.stop()

      const history = queue.getHistory({ limit: 3 })
      expect(history).toHaveLength(3)
    })

    it('returns most recent jobs first (DESC order)', async () => {
      queue.register('ordered', async () => {})

      queue.enqueue({ name: 'ordered', payload: { seq: 1 } })
      queue.enqueue({ name: 'ordered', payload: { seq: 2 } })
      queue.enqueue({ name: 'ordered', payload: { seq: 3 } })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 200))
      queue.stop()

      const history = queue.getHistory()
      // Most recent (highest id) first
      expect(history[0]!.id).toBeGreaterThan(history[1]!.id)
      expect(history[1]!.id).toBeGreaterThan(history[2]!.id)
    })

    it('parses payload JSON in history results', async () => {
      queue.register('with-payload', async () => {})
      queue.enqueue({ name: 'with-payload', payload: { nested: { deep: true } } })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      const history = queue.getHistory({ name: 'with-payload' })
      expect(history[0]!.payload).toEqual({ nested: { deep: true } })
    })

    it('returns empty array when no jobs exist', () => {
      const history = queue.getHistory()
      expect(history).toEqual([])
    })
  })

  describe('stop', () => {
    it('stops the polling loop', async () => {
      let callCount = 0
      queue.register('counting', async () => {
        callCount++
      })

      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 50))
      queue.stop()

      // Enqueue a new job after stopping — it should NOT be processed
      queue.enqueue({ name: 'counting' })
      await new Promise((r) => setTimeout(r, 100))

      const history = queue.getHistory({ name: 'counting' })
      const completed = history.filter((h) => h.status === 'completed')
      const pending = history.filter((h) => h.status === 'pending')
      expect(pending).toHaveLength(1) // The job enqueued after stop
    })

    it('is safe to call stop multiple times', () => {
      queue.start({ pollIntervalMs: 100 })
      expect(() => {
        queue.stop()
        queue.stop()
        queue.stop()
      }).not.toThrow()
    })

    it('can restart after stopping', async () => {
      queue.register('restart', async () => {})

      queue.start({ pollIntervalMs: 10 })
      queue.stop()

      queue.enqueue({ name: 'restart' })
      queue.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      queue.stop()

      const history = queue.getHistory({ name: 'restart' })
      expect(history.some((h) => h.status === 'completed')).toBe(true)
    })
  })

  describe('logger', () => {
    it('uses custom logger when provided', async () => {
      const logs: string[] = []
      const customLogger = {
        info: (msg: string) => logs.push(msg),
        error: (msg: string) => logs.push(msg),
      }

      const q = createJobQueue(db, { logger: customLogger })
      q.register('logged', async () => {})
      q.enqueue({ name: 'logged' })

      q.start({ pollIntervalMs: 10 })
      await new Promise((r) => setTimeout(r, 100))
      q.stop()

      expect(logs.some((l) => l.includes('Enqueued'))).toBe(true)
      expect(logs.some((l) => l.includes('Completed'))).toBe(true)
    })
  })
})
