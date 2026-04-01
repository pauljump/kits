import type { BusConfig, EventHandler } from './types.js'

/**
 * Create an in-process event bus.
 *
 * Usage:
 * ```ts
 * const bus = createEventBus()
 * bus.on('listing.price_drop', async (payload) => { ... })
 * bus.emit('listing.price_drop', { listingId: 123, newPrice: 4200 })
 * ```
 */
export function createEventBus(config: BusConfig = {}) {
  const { debug = false, maxListeners = 10 } = config
  const listeners = new Map<string, Set<EventHandler<any>>>()

  function getOrCreate(event: string): Set<EventHandler<any>> {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    return set
  }

  return {
    /**
     * Subscribe to an event. Returns an unsubscribe function.
     */
    on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
      const set = getOrCreate(event)
      if (set.size >= maxListeners) {
        console.warn(
          `[event-bus] Warning: "${event}" has ${set.size} listeners (max ${maxListeners}). Possible leak.`
        )
      }
      set.add(handler as EventHandler<any>)
      if (debug) console.log(`[event-bus] subscribed to "${event}"`)

      return () => {
        this.off(event, handler)
      }
    },

    /**
     * Unsubscribe a handler from an event.
     */
    off<T = unknown>(event: string, handler: EventHandler<T>): void {
      const set = listeners.get(event)
      if (set) {
        set.delete(handler as EventHandler<any>)
        if (set.size === 0) listeners.delete(event)
        if (debug) console.log(`[event-bus] unsubscribed from "${event}"`)
      }
    },

    /**
     * Emit an event. All handlers run concurrently (Promise.allSettled).
     * Errors in individual handlers are logged but don't prevent other handlers from running.
     */
    async emit<T = unknown>(event: string, payload: T): Promise<void> {
      if (debug) console.log(`[event-bus] emit "${event}"`, payload)
      const set = listeners.get(event)
      if (!set || set.size === 0) return

      const results = await Promise.allSettled(
        [...set].map((handler) => handler(payload))
      )

      for (const result of results) {
        if (result.status === 'rejected') {
          console.error(`[event-bus] handler error on "${event}":`, result.reason)
        }
      }
    },

    /**
     * Remove all listeners, optionally for a specific event.
     */
    clear(event?: string): void {
      if (event) {
        listeners.delete(event)
      } else {
        listeners.clear()
      }
      if (debug) console.log(`[event-bus] cleared ${event ?? 'all events'}`)
    },

    /**
     * Get the count of listeners for an event (or total across all events).
     */
    listenerCount(event?: string): number {
      if (event) {
        return listeners.get(event)?.size ?? 0
      }
      let total = 0
      for (const set of listeners.values()) total += set.size
      return total
    },
  }
}

export type EventBus = ReturnType<typeof createEventBus>
