/**
 * Token-bucket rate limiter for respecting external API rate limits.
 *
 * Usage:
 *   const limiter = new RateLimiter({ maxPerSecond: 5 })
 *   for (const url of urls) {
 *     await limiter.wait()
 *     await fetch(url)
 *   }
 */
export class RateLimiter {
  private tokens: number
  private maxTokens: number
  private refillRate: number // tokens per ms
  private lastRefill: number

  constructor(options: { maxPerSecond: number }) {
    this.maxTokens = options.maxPerSecond
    this.tokens = options.maxPerSecond
    this.refillRate = options.maxPerSecond / 1000
    this.lastRefill = Date.now()
  }

  /** Refill tokens based on elapsed time */
  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }

  /** Wait until a token is available, then consume it */
  async wait(): Promise<void> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // Calculate how long until we have a token
    const deficit = 1 - this.tokens
    const waitMs = Math.ceil(deficit / this.refillRate)
    await new Promise(r => setTimeout(r, waitMs))

    this.refill()
    this.tokens -= 1
  }
}
