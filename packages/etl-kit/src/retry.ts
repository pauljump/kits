import type { FetchOptions } from './types.js'

/**
 * Fetch a URL with exponential backoff retries and timeout.
 *
 * Returns the Response object so callers can handle JSON, text, streams, etc.
 * For JSON specifically, use: `const data = await (await fetchWithRetry(url)).json()`
 */
export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const {
    retries = 3,
    backoffMs = 1000,
    timeoutMs = 10_000,
    method = 'GET',
    headers = {},
    body,
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(typeof body === 'object' && body !== null ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: typeof body === 'object' ? JSON.stringify(body) : body,
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return response
    } catch (err) {
      clearTimeout(timer)
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt < retries) {
        const delay = backoffMs * Math.pow(2, attempt)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw lastError!
}
