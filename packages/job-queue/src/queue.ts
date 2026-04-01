import type Database from 'better-sqlite3'
import { nextCronDate } from './cron-parse.js'
import type {
  JobDef,
  EnqueueOptions,
  JobRun,
  QueueStartConfig,
  QueueConfig,
  HistoryOptions,
  JobHandler,
} from './types.js'

const DEFAULT_POLL_MS = 5000
const DEFAULT_MAX_RETRIES = 3

export function createJobQueue(db: Database.Database, config?: QueueConfig) {
  const handlers = new Map<string, JobHandler>()
  const logger = config?.logger ?? { info: console.log, error: console.error }
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let maxRetries = DEFAULT_MAX_RETRIES

  // Prepared statements (lazy-init after first call)
  const stmts = {
    upsertDef: db.prepare(`
      INSERT INTO job_definitions (name, cron, payload, enabled, nextRunAt)
      VALUES (@name, @cron, @payload, @enabled, @nextRunAt)
      ON CONFLICT(name) DO UPDATE SET
        cron = @cron,
        payload = @payload,
        enabled = @enabled,
        nextRunAt = @nextRunAt
    `),
    insertRun: db.prepare(`
      INSERT INTO job_runs (name, status, payload, runAt)
      VALUES (@name, 'pending', @payload, @runAt)
    `),
    getDueJobs: db.prepare(`
      SELECT id, name, payload, attempts FROM job_runs
      WHERE status = 'pending' AND runAt <= @now
      ORDER BY runAt ASC
      LIMIT 50
    `),
    markRunning: db.prepare(`
      UPDATE job_runs SET status = 'running', startedAt = @now, attempts = attempts + 1
      WHERE id = @id
    `),
    markCompleted: db.prepare(`
      UPDATE job_runs SET status = 'completed', completedAt = @now
      WHERE id = @id
    `),
    markFailed: db.prepare(`
      UPDATE job_runs SET status = 'failed', error = @error, completedAt = @now
      WHERE id = @id
    `),
    markPendingRetry: db.prepare(`
      UPDATE job_runs SET status = 'pending', error = @error
      WHERE id = @id
    `),
    updateDefLastRun: db.prepare(`
      UPDATE job_definitions SET lastRunAt = @now, nextRunAt = @nextRunAt
      WHERE name = @name
    `),
    getHistory: db.prepare(`
      SELECT id, name, status, payload, startedAt, completedAt, error, attempts
      FROM job_runs
      ORDER BY id DESC
      LIMIT @limit
    `),
    getHistoryByName: db.prepare(`
      SELECT id, name, status, payload, startedAt, completedAt, error, attempts
      FROM job_runs
      WHERE name = @name
      ORDER BY id DESC
      LIMIT @limit
    `),
    getDef: db.prepare(`
      SELECT name, cron, payload, enabled, nextRunAt FROM job_definitions
      WHERE name = @name AND enabled = 1
    `),
  }

  function nowISO(): string {
    return new Date().toISOString()
  }

  function register(name: string, handler: JobHandler): void {
    handlers.set(name, handler)
  }

  function schedule(def: JobDef): void {
    const next = nextCronDate(def.cron)
    stmts.upsertDef.run({
      name: def.name,
      cron: def.cron,
      payload: JSON.stringify(def.payload ?? {}),
      enabled: (def.enabled ?? true) ? 1 : 0,
      nextRunAt: next.toISOString(),
    })
    // Also enqueue the first run
    stmts.insertRun.run({
      name: def.name,
      payload: JSON.stringify(def.payload ?? {}),
      runAt: next.toISOString(),
    })
    logger.info(`[job-queue] Scheduled "${def.name}" — next run: ${next.toISOString()}`)
  }

  function enqueue(opts: EnqueueOptions): void {
    const runAt = opts.runAt ?? new Date()
    stmts.insertRun.run({
      name: opts.name,
      payload: JSON.stringify(opts.payload ?? {}),
      runAt: runAt.toISOString(),
    })
    logger.info(`[job-queue] Enqueued "${opts.name}" — runAt: ${runAt.toISOString()}`)
  }

  async function processDueJobs(): Promise<void> {
    const now = nowISO()
    const dueJobs = stmts.getDueJobs.all({ now }) as Array<{
      id: number
      name: string
      payload: string
      attempts: number
    }>

    for (const job of dueJobs) {
      const handler = handlers.get(job.name)
      if (!handler) {
        logger.error(`[job-queue] No handler registered for "${job.name}" — skipping`)
        stmts.markFailed.run({ id: job.id, error: 'No handler registered', now: nowISO() })
        continue
      }

      stmts.markRunning.run({ id: job.id, now: nowISO() })

      try {
        const payload = JSON.parse(job.payload) as Record<string, unknown>
        await handler(payload)
        stmts.markCompleted.run({ id: job.id, now: nowISO() })
        logger.info(`[job-queue] Completed "${job.name}" (run #${job.id})`)

        // If this is a recurring job, schedule the next run
        const def = stmts.getDef.get({ name: job.name }) as {
          cron: string | null
          payload: string
          nextRunAt: string
        } | undefined

        if (def?.cron) {
          const next = nextCronDate(def.cron)
          stmts.updateDefLastRun.run({
            name: job.name,
            now: nowISO(),
            nextRunAt: next.toISOString(),
          })
          stmts.insertRun.run({
            name: job.name,
            payload: def.payload,
            runAt: next.toISOString(),
          })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        const attempts = job.attempts + 1 // markRunning already incremented

        if (attempts < maxRetries) {
          stmts.markPendingRetry.run({ id: job.id, error: errorMsg })
          logger.error(`[job-queue] Failed "${job.name}" (attempt ${attempts}/${maxRetries}) — will retry`)
        } else {
          stmts.markFailed.run({ id: job.id, error: errorMsg, now: nowISO() })
          logger.error(`[job-queue] Failed "${job.name}" after ${attempts} attempts: ${errorMsg}`)
        }
      }
    }
  }

  function start(startConfig?: QueueStartConfig): void {
    const interval = startConfig?.pollIntervalMs ?? DEFAULT_POLL_MS
    maxRetries = startConfig?.maxRetries ?? DEFAULT_MAX_RETRIES

    if (pollTimer) {
      logger.info('[job-queue] Already running — stopping previous poller')
      stop()
    }

    logger.info(`[job-queue] Started polling every ${interval}ms`)

    // Run immediately, then on interval
    void processDueJobs()
    pollTimer = setInterval(() => {
      void processDueJobs()
    }, interval)
  }

  function stop(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
      logger.info('[job-queue] Stopped')
    }
  }

  function getHistory(opts?: HistoryOptions): JobRun[] {
    const limit = opts?.limit ?? 50
    let rows: unknown[]

    if (opts?.name) {
      rows = stmts.getHistoryByName.all({ name: opts.name, limit })
    } else {
      rows = stmts.getHistory.all({ limit })
    }

    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as number,
      name: row.name as string,
      status: row.status as JobRun['status'],
      payload: row.payload ? JSON.parse(row.payload as string) as Record<string, unknown> : null,
      startedAt: (row.startedAt as string) ?? null,
      completedAt: (row.completedAt as string) ?? null,
      error: (row.error as string) ?? null,
      attempts: row.attempts as number,
    }))
  }

  return {
    register,
    schedule,
    enqueue,
    start,
    stop,
    getHistory,
  }
}
