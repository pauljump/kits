import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEventBus } from '../bus.js'

describe('createEventBus', () => {
  let bus: ReturnType<typeof createEventBus>

  beforeEach(() => {
    bus = createEventBus()
  })

  describe('on()', () => {
    it('subscribes and handler receives events', async () => {
      const handler = vi.fn()
      bus.on('test.event', handler)

      await bus.emit('test.event', { foo: 'bar' })

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' })
    })

    it('returns an unsubscribe function', async () => {
      const handler = vi.fn()
      const unsub = bus.on('test.event', handler)

      unsub()
      await bus.emit('test.event', { foo: 'bar' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('multiple handlers receive the same event', async () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      bus.on('test.event', h1)
      bus.on('test.event', h2)

      await bus.emit('test.event', 42)

      expect(h1).toHaveBeenCalledWith(42)
      expect(h2).toHaveBeenCalledWith(42)
    })
  })

  describe('emit()', () => {
    it('calls all handlers concurrently via Promise.allSettled', async () => {
      const order: number[] = []
      const h1 = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10))
        order.push(1)
      })
      const h2 = vi.fn(async () => {
        order.push(2)
      })
      bus.on('test.event', h1)
      bus.on('test.event', h2)

      await bus.emit('test.event', null)

      // h2 finishes before h1 because they run concurrently
      expect(order).toEqual([2, 1])
      expect(h1).toHaveBeenCalledOnce()
      expect(h2).toHaveBeenCalledOnce()
    })

    it('does nothing if no listeners exist', async () => {
      // Should not throw
      await bus.emit('nonexistent', { data: true })
    })
  })

  describe('off()', () => {
    it('unsubscribes a handler', async () => {
      const handler = vi.fn()
      bus.on('test.event', handler)

      bus.off('test.event', handler)
      await bus.emit('test.event', 'payload')

      expect(handler).not.toHaveBeenCalled()
    })

    it('only removes the specified handler', async () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      bus.on('test.event', h1)
      bus.on('test.event', h2)

      bus.off('test.event', h1)
      await bus.emit('test.event', 'payload')

      expect(h1).not.toHaveBeenCalled()
      expect(h2).toHaveBeenCalledWith('payload')
    })

    it('is safe to call with unknown event', () => {
      const handler = vi.fn()
      // Should not throw
      bus.off('unknown', handler)
    })
  })

  describe('clear()', () => {
    it('removes all listeners when called with no args', async () => {
      bus.on('a', vi.fn())
      bus.on('b', vi.fn())
      bus.on('c', vi.fn())

      expect(bus.listenerCount()).toBe(3)

      bus.clear()

      expect(bus.listenerCount()).toBe(0)
    })

    it('removes only the specified event listeners when called with event name', async () => {
      const hA = vi.fn()
      const hB = vi.fn()
      bus.on('a', hA)
      bus.on('b', hB)

      bus.clear('a')

      expect(bus.listenerCount('a')).toBe(0)
      expect(bus.listenerCount('b')).toBe(1)

      await bus.emit('a', 'data')
      await bus.emit('b', 'data')

      expect(hA).not.toHaveBeenCalled()
      expect(hB).toHaveBeenCalledWith('data')
    })
  })

  describe('listenerCount()', () => {
    it('returns 0 for event with no listeners', () => {
      expect(bus.listenerCount('nope')).toBe(0)
    })

    it('returns correct count per event', () => {
      bus.on('a', vi.fn())
      bus.on('a', vi.fn())
      bus.on('b', vi.fn())

      expect(bus.listenerCount('a')).toBe(2)
      expect(bus.listenerCount('b')).toBe(1)
    })

    it('returns total count across all events when no event specified', () => {
      bus.on('a', vi.fn())
      bus.on('a', vi.fn())
      bus.on('b', vi.fn())

      expect(bus.listenerCount()).toBe(3)
    })

    it('decrements after off()', () => {
      const handler = vi.fn()
      bus.on('a', handler)
      bus.on('a', vi.fn())

      expect(bus.listenerCount('a')).toBe(2)

      bus.off('a', handler)

      expect(bus.listenerCount('a')).toBe(1)
    })
  })

  describe('error handling', () => {
    it('sync handler throw propagates (not caught by Promise.allSettled)', async () => {
      // Note: synchronous throws in handlers happen during .map() before
      // Promise.allSettled can wrap them — this is a known edge case.
      // Use async handlers to get proper error isolation.
      const h1 = vi.fn(() => {
        throw new Error('handler 1 exploded')
      })

      bus.on('test.event', h1)

      await expect(bus.emit('test.event', 'data')).rejects.toThrow('handler 1 exploded')
    })

    it('async handler errors do not prevent other handlers from running', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const h1 = vi.fn(async () => {
        throw new Error('handler 1 exploded')
      })
      const h2 = vi.fn()
      const h3 = vi.fn()

      bus.on('test.event', h1)
      bus.on('test.event', h2)
      bus.on('test.event', h3)

      await bus.emit('test.event', 'data')

      expect(h1).toHaveBeenCalledWith('data')
      expect(h2).toHaveBeenCalledWith('data')
      expect(h3).toHaveBeenCalledWith('data')

      expect(errorSpy).toHaveBeenCalledOnce()
      expect(errorSpy.mock.calls[0][0]).toContain('handler error')

      errorSpy.mockRestore()
    })

    it('async handler rejection does not prevent other handlers', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const h1 = vi.fn(async () => {
        throw new Error('async failure')
      })
      const h2 = vi.fn()

      bus.on('test.event', h1)
      bus.on('test.event', h2)

      await bus.emit('test.event', 'data')

      expect(h2).toHaveBeenCalledWith('data')
      expect(errorSpy).toHaveBeenCalled()

      errorSpy.mockRestore()
    })
  })

  describe('maxListeners warning', () => {
    it('warns when listener count reaches maxListeners', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const smallBus = createEventBus({ maxListeners: 2 })

      smallBus.on('test', vi.fn())
      smallBus.on('test', vi.fn())
      expect(warnSpy).not.toHaveBeenCalled()

      // Third listener exceeds maxListeners of 2
      smallBus.on('test', vi.fn())
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0][0]).toContain('Possible leak')

      warnSpy.mockRestore()
    })

    it('does not warn when under the limit', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const largeBus = createEventBus({ maxListeners: 100 })

      for (let i = 0; i < 50; i++) {
        largeBus.on('test', vi.fn())
      }

      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('uses default maxListeners of 10', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      for (let i = 0; i < 10; i++) {
        bus.on('test', vi.fn())
      }
      expect(warnSpy).not.toHaveBeenCalled()

      // 11th listener should trigger warning
      bus.on('test', vi.fn())
      expect(warnSpy).toHaveBeenCalledOnce()

      warnSpy.mockRestore()
    })
  })

  describe('debug mode', () => {
    it('logs subscribe and emit when debug is true', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const debugBus = createEventBus({ debug: true })

      debugBus.on('test', vi.fn())
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('subscribed to "test"'))

      await debugBus.emit('test', { x: 1 })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('emit "test"'), { x: 1 })

      logSpy.mockRestore()
    })
  })
})
