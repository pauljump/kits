/**
 * Common bucketing functions for dimensions.
 *
 * Bucketing turns continuous values into discrete segments.
 * These are reusable across domains — StuyWatch uses priceBucket,
 * tee times would use daysOutBucket, etc.
 */

/** Create a numeric range bucketer from breakpoints. */
export function numericBucket(breakpoints: number[], labels: string[]): (value: number) => string {
  if (labels.length !== breakpoints.length + 1) {
    throw new Error(`Need ${breakpoints.length + 1} labels for ${breakpoints.length} breakpoints`)
  }
  return (value: number): string => {
    for (let i = 0; i < breakpoints.length; i++) {
      if (value < breakpoints[i]!) return labels[i]!
    }
    return labels[labels.length - 1]!
  }
}

/** Bucket by day of week (from a Date or ISO string). */
export function dayOfWeek(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] ?? 'Unknown'
}

/** Bucket by time of day: morning, midday, afternoon, evening. */
export function timeOfDay(hour: number): string {
  if (hour < 9) return 'early'
  if (hour < 12) return 'morning'
  if (hour < 15) return 'midday'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/** Bucket days until an event. */
export const daysOutBucket = numericBucket(
  [1, 3, 7, 14],
  ['same-day', '1-2days', '3-6days', '1-2weeks', '2weeks+']
)

/** Bucket days on market (StuyWatch pattern). */
export const domBucket = numericBucket(
  [7, 30],
  ['0-6', '7-29', '30+']
)
