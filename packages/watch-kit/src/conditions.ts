/**
 * Pre-built conditions for common watch patterns.
 *
 * These are convenience wrappers — users can always write their own
 * condition functions for custom logic.
 */

import type { Condition, WatchEvent } from './types.js'

/** Triggers on any new item. */
export function onAdded<T>(name?: string): Condition<T> {
  return {
    name: name ?? 'on-added',
    fn: (event: WatchEvent<T>) => event.type === 'added',
  }
}

/** Triggers when an item is removed (after grace period if configured). */
export function onRemoved<T>(name?: string): Condition<T> {
  return {
    name: name ?? 'on-removed',
    fn: (event: WatchEvent<T>) => event.type === 'removed',
  }
}

/** Triggers when any tracked field changes. */
export function onChanged<T>(name?: string): Condition<T> {
  return {
    name: name ?? 'on-changed',
    fn: (event: WatchEvent<T>) => event.type === 'changed',
  }
}

/** Triggers when a specific field changes. */
export function onFieldChanged<T>(field: keyof T & string, name?: string): Condition<T> {
  return {
    name: name ?? `on-${field}-changed`,
    fn: (event: WatchEvent<T>) =>
      event.type === 'changed' && (event.changedFields?.includes(field) ?? false),
  }
}

/**
 * Triggers when a numeric field crosses a threshold.
 * Direction: 'above' = triggers when current > threshold, 'below' = current < threshold.
 */
export function onThreshold<T>(
  field: keyof T & string,
  threshold: number,
  direction: 'above' | 'below',
  name?: string,
): Condition<T> {
  return {
    name: name ?? `on-${field}-${direction}-${threshold}`,
    fn: (event: WatchEvent<T>) => {
      if (event.type !== 'changed' && event.type !== 'added') return false
      const value = event.current?.[field]
      if (typeof value !== 'number') return false
      return direction === 'above' ? value > threshold : value < threshold
    },
  }
}

/**
 * Triggers when a field's value decreases (e.g., price drop).
 */
export function onDecrease<T>(field: keyof T & string, name?: string): Condition<T> {
  return {
    name: name ?? `on-${field}-decrease`,
    fn: (event: WatchEvent<T>) => {
      if (event.type !== 'changed') return false
      const curr = event.current?.[field]
      const prev = event.previous?.[field]
      if (typeof curr !== 'number' || typeof prev !== 'number') return false
      return curr < prev
    },
  }
}

/**
 * Triggers when a field's value increases.
 */
export function onIncrease<T>(field: keyof T & string, name?: string): Condition<T> {
  return {
    name: name ?? `on-${field}-increase`,
    fn: (event: WatchEvent<T>) => {
      if (event.type !== 'changed') return false
      const curr = event.current?.[field]
      const prev = event.previous?.[field]
      if (typeof curr !== 'number' || typeof prev !== 'number') return false
      return curr > prev
    },
  }
}

/** Combines multiple conditions with AND logic. */
export function allOf<T>(conditions: Condition<T>[], name?: string): Condition<T> {
  return {
    name: name ?? `all-of(${conditions.map(c => c.name).join(', ')})`,
    fn: (event: WatchEvent<T>) => conditions.every(c => c.fn(event)),
  }
}

/** Combines multiple conditions with OR logic. */
export function anyOf<T>(conditions: Condition<T>[], name?: string): Condition<T> {
  return {
    name: name ?? `any-of(${conditions.map(c => c.name).join(', ')})`,
    fn: (event: WatchEvent<T>) => conditions.some(c => c.fn(event)),
  }
}
