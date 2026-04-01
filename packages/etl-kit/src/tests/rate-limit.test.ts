import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RateLimiter } from '../rate-limit.js'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows immediate call when tokens are available', async () => {
    const limiter = new RateLimiter({ maxPerSecond: 5 })

    const start = Date.now()
    await limiter.wait()
    const elapsed = Date.now() - start

    // Should resolve immediately (0ms with fake timers)
    expect(elapsed).toBe(0)
  })

  it('allows multiple calls up to the token limit without waiting', async () => {
    const limiter = new RateLimiter({ maxPerSecond: 3 })

    // All 3 tokens should be available immediately
    const start = Date.now()
    await limiter.wait()
    await limiter.wait()
    await limiter.wait()
    const elapsed = Date.now() - start

    expect(elapsed).toBe(0)
  })

  it('delays when tokens are exhausted', async () => {
    const limiter = new RateLimiter({ maxPerSecond: 2 })

    // Consume both tokens
    await limiter.wait()
    await limiter.wait()

    // Third call should need to wait for a token refill
    const waitPromise = limiter.wait()

    // Advance time enough for a token to refill (1 token per 500ms at 2/sec)
    await vi.advanceTimersByTimeAsync(500)

    await waitPromise // Should resolve after time advance
  })

  it('refills tokens over time', async () => {
    const limiter = new RateLimiter({ maxPerSecond: 10 })

    // Drain all 10 tokens
    for (let i = 0; i < 10; i++) {
      await limiter.wait()
    }

    // Advance 1 full second — should refill all 10 tokens
    await vi.advanceTimersByTimeAsync(1000)

    // Should be able to consume tokens immediately again
    const start = Date.now()
    await limiter.wait()
    const elapsed = Date.now() - start

    expect(elapsed).toBe(0)
  })

  it('maxPerSecond of 1 allows 1 call per second', async () => {
    const limiter = new RateLimiter({ maxPerSecond: 1 })

    // First call is immediate
    await limiter.wait()

    // Second call should need ~1000ms
    const waitPromise = limiter.wait()
    await vi.advanceTimersByTimeAsync(1000)
    await waitPromise
  })
})
