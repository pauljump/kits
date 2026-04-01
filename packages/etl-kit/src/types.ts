/** Options for fetchWithRetry */
export interface FetchOptions {
  /** Number of retries on failure. Defaults to 3. */
  retries?: number
  /** Initial backoff delay in ms. Doubles each retry. Defaults to 1000. */
  backoffMs?: number
  /** Request timeout in ms. Defaults to 10000 (10s). */
  timeoutMs?: number
  /** HTTP method. Defaults to 'GET'. */
  method?: string
  /** Request headers. */
  headers?: Record<string, string>
  /** Request body (automatically stringified if object). */
  body?: string | Record<string, unknown>
}

/** Logger interface — compatible with Fastify logger and console */
export interface Logger {
  info: (msg: string, ...args: unknown[]) => void
  warn: (msg: string, ...args: unknown[]) => void
  error: (msg: string, ...args: unknown[]) => void
}

/** Configuration for createPipeline */
export interface PipelineConfig<TRaw, TTransformed> {
  /** Pipeline name — used in log messages */
  name: string
  /** Fetch raw data from source */
  fetch: () => Promise<TRaw>
  /** Transform raw data into the shape you want to store */
  transform: (raw: TRaw) => TTransformed | Promise<TTransformed>
  /** Load transformed data into your destination (DB, file, API) */
  load: (data: TTransformed) => void | Promise<void>
  /** Optional logger. Defaults to console. */
  logger?: Logger
}

/** Result from a pipeline run */
export interface PipelineResult<T> {
  /** The transformed data that was loaded */
  data: T
  /** Pipeline name */
  name: string
  /** Duration in milliseconds */
  durationMs: number
}

