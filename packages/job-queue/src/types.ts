import type Database from 'better-sqlite3'

/** Status of a job run */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

/** Definition for scheduling a recurring job */
export interface JobDef {
  /** Unique name identifying this job type */
  name: string
  /** Cron expression (5-field: minute hour day month weekday) */
  cron: string
  /** JSON-serializable payload passed to the handler */
  payload?: Record<string, unknown>
  /** Whether this job definition is enabled (default true) */
  enabled?: boolean
}

/** Options for enqueuing a one-time job */
export interface EnqueueOptions {
  /** Job name (must match a registered handler) */
  name: string
  /** JSON-serializable payload */
  payload?: Record<string, unknown>
  /** When to run (defaults to now) */
  runAt?: Date
}

/** A row from job_runs */
export interface JobRun {
  id: number
  name: string
  status: JobStatus
  payload: Record<string, unknown> | null
  startedAt: string | null
  completedAt: string | null
  error: string | null
  attempts: number
}

/** Config for queue.start() */
export interface QueueStartConfig {
  /** How often to poll for due jobs (ms). Default 5000 */
  pollIntervalMs?: number
  /** Max retry attempts for failed jobs. Default 3 */
  maxRetries?: number
}

/** Config for createJobQueue() */
export interface QueueConfig {
  /** Optional logger. Defaults to console */
  logger?: {
    info: (msg: string) => void
    error: (msg: string) => void
  }
}

/** History query options */
export interface HistoryOptions {
  name?: string
  limit?: number
}

/** Job handler function */
export type JobHandler = (payload: Record<string, unknown>) => Promise<void>

export type { Database }
