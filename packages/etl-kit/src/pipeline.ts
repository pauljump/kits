import type { PipelineConfig, PipelineResult, Logger } from './types.js'

const defaultLogger: Logger = {
  info: (msg, ...args) => console.log(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
}

/**
 * Orchestrate a fetch -> transform -> load pipeline with logging and timing.
 *
 * Usage:
 *   const result = await createPipeline({
 *     name: 'stuywatch-listings',
 *     fetch: async () => fetchWithRetry('https://...').then(r => r.json()),
 *     transform: (raw) => raw.map(normalize),
 *     load: (items) => db.insertMany(items),
 *   })
 */
export async function createPipeline<TRaw, TTransformed>(
  config: PipelineConfig<TRaw, TTransformed>
): Promise<PipelineResult<TTransformed>> {
  const log = config.logger ?? defaultLogger
  const start = Date.now()

  log.info(`[${config.name}] Starting pipeline`)

  // Fetch
  log.info(`[${config.name}] Fetching data...`)
  let raw: TRaw
  try {
    raw = await config.fetch()
  } catch (err) {
    log.error(`[${config.name}] Fetch failed: ${err}`)
    throw err
  }

  // Transform
  log.info(`[${config.name}] Transforming data...`)
  let transformed: TTransformed
  try {
    transformed = await config.transform(raw)
  } catch (err) {
    log.error(`[${config.name}] Transform failed: ${err}`)
    throw err
  }

  // Load
  log.info(`[${config.name}] Loading data...`)
  try {
    await config.load(transformed)
  } catch (err) {
    log.error(`[${config.name}] Load failed: ${err}`)
    throw err
  }

  const durationMs = Date.now() - start
  log.info(`[${config.name}] Pipeline complete in ${durationMs}ms`)

  return {
    data: transformed,
    name: config.name,
    durationMs,
  }
}
