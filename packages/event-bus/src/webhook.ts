import { createHmac } from 'node:crypto'
import type { WebhookOptions, WebhookResult } from './types.js'

/**
 * Deliver an event via HTTP POST with HMAC-SHA256 signature and retry.
 *
 * - POSTs JSON to the given URL
 * - Includes X-Event-Type and X-Signature headers
 * - Retries with exponential backoff (500ms, 1s, 2s, ...) on failure
 * - Returns { success, statusCode, attempts }
 */
export async function deliverWebhook(options: WebhookOptions): Promise<WebhookResult> {
  const { url, event, payload, secret, retries = 3 } = options
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(body).digest('hex')

  let lastStatusCode: number | null = null

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Type': event,
          'X-Signature': signature,
        },
        body,
      })

      lastStatusCode = response.status

      if (response.ok) {
        return { success: true, statusCode: response.status, attempts: attempt }
      }

      // Don't retry on 4xx (client errors) — they won't succeed on retry
      if (response.status >= 400 && response.status < 500) {
        return { success: false, statusCode: response.status, attempts: attempt }
      }
    } catch {
      // Network error — will retry
      lastStatusCode = null
    }

    // Exponential backoff before next attempt (skip if this was the last attempt)
    if (attempt <= retries) {
      const delayMs = 500 * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return { success: false, statusCode: lastStatusCode, attempts: retries + 1 }
}
