import { z } from 'zod'

/** Schema for a single event definition — maps an event name to its payload shape. */
export type EventDef<T = unknown> = {
  name: string
  schema?: z.ZodType<T>
}

/** Handler function that receives a typed event payload. */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>

/** Configuration for createEventBus(). */
export type BusConfig = {
  /** If true, log emit/subscribe activity to console. Default: false. */
  debug?: boolean
  /** Maximum listeners per event before warning. Default: 10. */
  maxListeners?: number
}

/** Result from a webhook delivery attempt. */
export type WebhookResult = {
  success: boolean
  statusCode: number | null
  attempts: number
}

/** Options for deliverWebhook(). */
export type WebhookOptions = {
  /** URL to POST the event to. */
  url: string
  /** Event type name (sent as X-Event-Type header). */
  event: string
  /** JSON-serializable payload. */
  payload: unknown
  /** Shared secret for HMAC-SHA256 signature (sent as X-Signature header). */
  secret: string
  /** Number of retry attempts on failure. Default: 3. */
  retries?: number
}
