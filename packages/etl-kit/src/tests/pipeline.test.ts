import { describe, it, expect, vi } from 'vitest'
import { createPipeline } from '../pipeline.js'
import type { Logger } from '../types.js'

function createMockLogger(): Logger & {
  messages: { level: string; msg: string }[]
} {
  const messages: { level: string; msg: string }[] = []
  return {
    messages,
    info: vi.fn((msg: string) => messages.push({ level: 'info', msg })),
    warn: vi.fn((msg: string) => messages.push({ level: 'warn', msg })),
    error: vi.fn((msg: string) => messages.push({ level: 'error', msg })),
  }
}

describe('createPipeline', () => {
  it('executes fetch -> transform -> load in order', async () => {
    const order: string[] = []

    await createPipeline({
      name: 'order-test',
      fetch: async () => {
        order.push('fetch')
        return [1, 2, 3]
      },
      transform: (raw) => {
        order.push('transform')
        return raw.map((n) => n * 2)
      },
      load: (data) => {
        order.push('load')
        // Verify load receives transformed data
        expect(data).toEqual([2, 4, 6])
      },
      logger: createMockLogger(),
    })

    expect(order).toEqual(['fetch', 'transform', 'load'])
  })

  it('returns timing, data, and pipeline name', async () => {
    const result = await createPipeline({
      name: 'timing-test',
      fetch: async () => ({ raw: true }),
      transform: (raw) => ({ transformed: true, source: raw }),
      load: () => {},
      logger: createMockLogger(),
    })

    expect(result.name).toBe('timing-test')
    expect(result.data).toEqual({ transformed: true, source: { raw: true } })
    expect(typeof result.durationMs).toBe('number')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('logs phase names including pipeline name', async () => {
    const logger = createMockLogger()

    await createPipeline({
      name: 'log-test',
      fetch: async () => 'raw',
      transform: (raw) => raw.toUpperCase(),
      load: () => {},
      logger,
    })

    const infoMessages = logger.messages
      .filter((m) => m.level === 'info')
      .map((m) => m.msg)

    // Should log: Starting, Fetching, Transforming, Loading, Complete
    expect(infoMessages.length).toBe(5)
    expect(infoMessages[0]).toContain('[log-test]')
    expect(infoMessages[0]).toContain('Starting')
    expect(infoMessages[1]).toContain('Fetching')
    expect(infoMessages[2]).toContain('Transforming')
    expect(infoMessages[3]).toContain('Loading')
    expect(infoMessages[4]).toContain('complete')
  })

  it('throws on fetch error and logs it', async () => {
    const logger = createMockLogger()

    await expect(
      createPipeline({
        name: 'fetch-fail',
        fetch: async () => {
          throw new Error('Network down')
        },
        transform: (raw) => raw,
        load: () => {},
        logger,
      })
    ).rejects.toThrow('Network down')

    const errorMessages = logger.messages.filter((m) => m.level === 'error')
    expect(errorMessages.length).toBe(1)
    expect(errorMessages[0].msg).toContain('Fetch failed')
    expect(errorMessages[0].msg).toContain('fetch-fail')
  })

  it('throws on transform error and logs it', async () => {
    const logger = createMockLogger()

    await expect(
      createPipeline({
        name: 'transform-fail',
        fetch: async () => 'raw-data',
        transform: () => {
          throw new Error('Bad data format')
        },
        load: () => {},
        logger,
      })
    ).rejects.toThrow('Bad data format')

    const errorMessages = logger.messages.filter((m) => m.level === 'error')
    expect(errorMessages.length).toBe(1)
    expect(errorMessages[0].msg).toContain('Transform failed')
    expect(errorMessages[0].msg).toContain('transform-fail')
  })

  it('throws on load error and logs it', async () => {
    const logger = createMockLogger()

    await expect(
      createPipeline({
        name: 'load-fail',
        fetch: async () => 'data',
        transform: (raw) => raw,
        load: () => {
          throw new Error('DB write failed')
        },
        logger,
      })
    ).rejects.toThrow('DB write failed')

    const errorMessages = logger.messages.filter((m) => m.level === 'error')
    expect(errorMessages.length).toBe(1)
    expect(errorMessages[0].msg).toContain('Load failed')
  })

  it('works with async transform and load', async () => {
    const result = await createPipeline({
      name: 'async-test',
      fetch: async () => [10, 20],
      transform: async (raw) => {
        await new Promise((r) => setTimeout(r, 1))
        return raw.map((n) => n + 1)
      },
      load: async (data) => {
        await new Promise((r) => setTimeout(r, 1))
        expect(data).toEqual([11, 21])
      },
      logger: createMockLogger(),
    })

    expect(result.data).toEqual([11, 21])
  })

  it('uses default logger (console) when none provided', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createPipeline({
      name: 'default-logger',
      fetch: async () => 'data',
      transform: (raw) => raw,
      load: () => {},
    })

    expect(consoleSpy).toHaveBeenCalled()
    const firstCall = consoleSpy.mock.calls[0][0]
    expect(firstCall).toContain('[default-logger]')

    consoleSpy.mockRestore()
  })
})
