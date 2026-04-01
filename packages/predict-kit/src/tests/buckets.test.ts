import { describe, it, expect } from 'vitest'
import { numericBucket, dayOfWeek, timeOfDay, daysOutBucket, domBucket } from '../buckets.js'

describe('numericBucket', () => {
  it('returns correct labels for breakpoints', () => {
    const bucket = numericBucket([100, 500], ['low', 'mid', 'high'])
    expect(bucket(50)).toBe('low')
    expect(bucket(99)).toBe('low')
    expect(bucket(100)).toBe('mid')
    expect(bucket(250)).toBe('mid')
    expect(bucket(499)).toBe('mid')
    expect(bucket(500)).toBe('high')
    expect(bucket(1000)).toBe('high')
  })

  it('handles single breakpoint', () => {
    const bucket = numericBucket([0], ['negative', 'non-negative'])
    expect(bucket(-5)).toBe('negative')
    expect(bucket(0)).toBe('non-negative')
    expect(bucket(100)).toBe('non-negative')
  })

  it('handles edge values exactly at breakpoints', () => {
    const bucket = numericBucket([10, 20, 30], ['a', 'b', 'c', 'd'])
    expect(bucket(9)).toBe('a')
    expect(bucket(10)).toBe('b')
    expect(bucket(19)).toBe('b')
    expect(bucket(20)).toBe('c')
    expect(bucket(29)).toBe('c')
    expect(bucket(30)).toBe('d')
  })

  it('throws when label count does not match breakpoints + 1', () => {
    expect(() => numericBucket([10, 20], ['a', 'b'])).toThrow(
      'Need 3 labels for 2 breakpoints'
    )
    expect(() => numericBucket([10], ['a', 'b', 'c'])).toThrow(
      'Need 2 labels for 1 breakpoints'
    )
  })

  it('throws with zero breakpoints and wrong label count', () => {
    expect(() => numericBucket([], ['a', 'b'])).toThrow(
      'Need 1 labels for 0 breakpoints'
    )
  })

  it('works with zero breakpoints and one label', () => {
    const bucket = numericBucket([], ['everything'])
    expect(bucket(0)).toBe('everything')
    expect(bucket(999)).toBe('everything')
  })
})

describe('dayOfWeek', () => {
  it('returns correct day string from Date object', () => {
    // 2026-04-01 is a Wednesday
    const wed = new Date(2026, 3, 1) // months are 0-indexed
    expect(dayOfWeek(wed)).toBe('Wed')
  })

  it('returns correct day for each day of the week', () => {
    const expected = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    // 2026-03-29 is a Sunday
    const sunday = new Date(2026, 2, 29)
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday.getTime() + i * 86400000)
      expect(dayOfWeek(d)).toBe(expected[i])
    }
  })

  it('accepts ISO string input', () => {
    // Note: ISO string parsing uses UTC, getDay() uses local time
    // Use a Date object to verify consistency
    const dateStr = '2026-04-01T12:00:00Z'
    const dateObj = new Date(dateStr)
    expect(dayOfWeek(dateStr)).toBe(dayOfWeek(dateObj))
  })
})

describe('timeOfDay', () => {
  it('returns early for hours before 9', () => {
    expect(timeOfDay(0)).toBe('early')
    expect(timeOfDay(5)).toBe('early')
    expect(timeOfDay(8)).toBe('early')
  })

  it('returns morning for hours 9-11', () => {
    expect(timeOfDay(9)).toBe('morning')
    expect(timeOfDay(10)).toBe('morning')
    expect(timeOfDay(11)).toBe('morning')
  })

  it('returns midday for hours 12-14', () => {
    expect(timeOfDay(12)).toBe('midday')
    expect(timeOfDay(13)).toBe('midday')
    expect(timeOfDay(14)).toBe('midday')
  })

  it('returns afternoon for hours 15-17', () => {
    expect(timeOfDay(15)).toBe('afternoon')
    expect(timeOfDay(16)).toBe('afternoon')
    expect(timeOfDay(17)).toBe('afternoon')
  })

  it('returns evening for hours 18+', () => {
    expect(timeOfDay(18)).toBe('evening')
    expect(timeOfDay(21)).toBe('evening')
    expect(timeOfDay(23)).toBe('evening')
  })
})

describe('daysOutBucket', () => {
  it('returns same-day for 0', () => {
    expect(daysOutBucket(0)).toBe('same-day')
  })

  it('returns 1-2days for 1-2', () => {
    expect(daysOutBucket(1)).toBe('1-2days')
    expect(daysOutBucket(2)).toBe('1-2days')
  })

  it('returns 3-6days for 3-6', () => {
    expect(daysOutBucket(3)).toBe('3-6days')
    expect(daysOutBucket(6)).toBe('3-6days')
  })

  it('returns 1-2weeks for 7-13', () => {
    expect(daysOutBucket(7)).toBe('1-2weeks')
    expect(daysOutBucket(13)).toBe('1-2weeks')
  })

  it('returns 2weeks+ for 14+', () => {
    expect(daysOutBucket(14)).toBe('2weeks+')
    expect(daysOutBucket(30)).toBe('2weeks+')
    expect(daysOutBucket(100)).toBe('2weeks+')
  })
})

describe('domBucket', () => {
  it('returns 0-6 for days 0-6', () => {
    expect(domBucket(0)).toBe('0-6')
    expect(domBucket(3)).toBe('0-6')
    expect(domBucket(6)).toBe('0-6')
  })

  it('returns 7-29 for days 7-29', () => {
    expect(domBucket(7)).toBe('7-29')
    expect(domBucket(15)).toBe('7-29')
    expect(domBucket(29)).toBe('7-29')
  })

  it('returns 30+ for days 30+', () => {
    expect(domBucket(30)).toBe('30+')
    expect(domBucket(60)).toBe('30+')
    expect(domBucket(365)).toBe('30+')
  })
})
