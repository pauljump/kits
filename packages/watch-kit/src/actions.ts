/**
 * Pre-built actions for common watch patterns.
 *
 * Actions run when conditions match triggered events.
 * These are convenience wrappers — users can write custom action functions.
 */

import type { Action, WatchEvent, WatcherMeta } from './types.js'

/**
 * Log triggered events to console.
 * Useful for debugging and development.
 */
export function logAction<T>(name?: string): Action<T> {
  return {
    name: name ?? 'log',
    fn: (events: WatchEvent<T>[], watcher: WatcherMeta) => {
      for (const event of events) {
        const detail = event.type === 'changed'
          ? ` (fields: ${event.changedFields?.join(', ')})`
          : ''
        console.log(`[watch-kit] ${watcher.name}: ${event.type} "${event.key}"${detail}`)
      }
    },
  }
}

/**
 * Call a callback with triggered events.
 * The simplest way to wire watch-kit to any downstream system.
 */
export function callbackAction<T>(
  callback: (events: WatchEvent<T>[], watcher: WatcherMeta) => Promise<void> | void,
  name?: string,
): Action<T> {
  return {
    name: name ?? 'callback',
    fn: callback,
  }
}

/**
 * Emit events to an EventEmitter-like object.
 * Works with Node's EventEmitter or any object with an emit(event, ...args) method.
 */
export function emitAction<T>(
  emitter: { emit: (event: string, ...args: unknown[]) => unknown },
  eventPrefix?: string,
  name?: string,
): Action<T> {
  const prefix = eventPrefix ?? 'watch'
  return {
    name: name ?? 'emit',
    fn: (events: WatchEvent<T>[], watcher: WatcherMeta) => {
      for (const event of events) {
        emitter.emit(`${prefix}:${event.type}`, event, watcher)
      }
      if (events.length > 0) {
        emitter.emit(`${prefix}:triggered`, events, watcher)
      }
    },
  }
}
