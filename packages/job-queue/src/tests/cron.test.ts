import { describe, it, expect } from 'vitest'
import { parseCron, nextCronDate } from '../cron-parse.js'

describe('parseCron', () => {
  it('parses "* * * * *" (every minute)', () => {
    const fields = parseCron('* * * * *')
    expect(fields.minute).toHaveLength(60) // 0-59
    expect(fields.minute[0]).toBe(0)
    expect(fields.minute[59]).toBe(59)
    expect(fields.hour).toHaveLength(24) // 0-23
    expect(fields.day).toHaveLength(31) // 1-31
    expect(fields.month).toHaveLength(12) // 1-12
    expect(fields.weekday).toHaveLength(7) // 0-6
  })

  it('parses "0 9 * * 1" (9am Monday)', () => {
    const fields = parseCron('0 9 * * 1')
    expect(fields.minute).toEqual([0])
    expect(fields.hour).toEqual([9])
    expect(fields.day).toHaveLength(31)
    expect(fields.month).toHaveLength(12)
    expect(fields.weekday).toEqual([1])
  })

  it('parses exact values', () => {
    const fields = parseCron('30 12 15 6 3')
    expect(fields.minute).toEqual([30])
    expect(fields.hour).toEqual([12])
    expect(fields.day).toEqual([15])
    expect(fields.month).toEqual([6])
    expect(fields.weekday).toEqual([3])
  })

  it('parses ranges like "1-5"', () => {
    const fields = parseCron('1-5 * * * *')
    expect(fields.minute).toEqual([1, 2, 3, 4, 5])
  })

  it('parses ranges in weekday field', () => {
    const fields = parseCron('0 9 * * 1-5')
    expect(fields.weekday).toEqual([1, 2, 3, 4, 5])
  })

  it('parses lists like "1,3,5"', () => {
    const fields = parseCron('1,3,5 * * * *')
    expect(fields.minute).toEqual([1, 3, 5])
  })

  it('parses lists in hour field', () => {
    const fields = parseCron('0 8,12,18 * * *')
    expect(fields.hour).toEqual([8, 12, 18])
  })

  it('parses steps like "*/15"', () => {
    const fields = parseCron('*/15 * * * *')
    expect(fields.minute).toEqual([0, 15, 30, 45])
  })

  it('parses steps with range like "1-30/5"', () => {
    const fields = parseCron('1-30/5 * * * *')
    expect(fields.minute).toEqual([1, 6, 11, 16, 21, 26])
  })

  it('parses "*/2" in hour field', () => {
    const fields = parseCron('0 */2 * * *')
    expect(fields.hour).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
  })

  it('parses combined list and range "1,10-12,20"', () => {
    const fields = parseCron('1,10-12,20 * * * *')
    expect(fields.minute).toEqual([1, 10, 11, 12, 20])
  })

  it('throws on too few fields', () => {
    expect(() => parseCron('* * *')).toThrow('expected 5 fields')
  })

  it('throws on too many fields', () => {
    expect(() => parseCron('* * * * * *')).toThrow('expected 5 fields')
  })

  it('throws on empty string', () => {
    expect(() => parseCron('')).toThrow('expected 5 fields')
  })

  it('throws on out-of-range values', () => {
    expect(() => parseCron('60 * * * *')).toThrow('Invalid value')
    expect(() => parseCron('* 25 * * *')).toThrow('Invalid value')
    expect(() => parseCron('* * 0 * *')).toThrow('Invalid value')
    expect(() => parseCron('* * * 13 *')).toThrow('Invalid value')
    expect(() => parseCron('* * * * 7')).toThrow('Invalid value')
  })

  it('throws on invalid range', () => {
    expect(() => parseCron('1-60 * * * *')).toThrow('Invalid range')
  })

  it('throws on invalid step', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow('Invalid step')
  })
})

describe('nextCronDate', () => {
  it('returns a date in the future', () => {
    const now = new Date()
    const next = nextCronDate('* * * * *', now)
    expect(next.getTime()).toBeGreaterThan(now.getTime())
  })

  it('returns the next minute for "* * * * *"', () => {
    const ref = new Date('2026-04-01T10:30:00.000Z')
    const next = nextCronDate('* * * * *', ref)
    expect(next.getTime()).toBe(new Date('2026-04-01T10:31:00.000Z').getTime())
  })

  it('finds the next occurrence at a specific minute', () => {
    // At 10:30, next "45 * * * *" should be 10:45 same day
    const ref = new Date('2026-04-01T10:30:00.000Z')
    const next = nextCronDate('45 * * * *', ref)
    expect(next.getMinutes()).toBe(45)
    expect(next.getTime()).toBeGreaterThan(ref.getTime())
  })

  it('wraps to the next hour if minute already passed', () => {
    // At XX:50, next "15 * * * *" should be (XX+1):15
    const ref = new Date()
    ref.setMinutes(50, 0, 0)
    const refHour = ref.getHours()
    const next = nextCronDate('15 * * * *', ref)
    expect(next.getMinutes()).toBe(15)
    // Should be the next hour (with wrapping at 24)
    expect(next.getHours()).toBe((refHour + 1) % 24)
  })

  it('finds the correct weekday', () => {
    // 2026-04-01 is a Wednesday (day 3). "0 9 * * 1" = Monday 9:00
    // Next Monday is 2026-04-06
    const ref = new Date('2026-04-01T10:00:00.000Z')
    const next = nextCronDate('0 9 * * 1', ref)
    expect(next.getDay()).toBe(1) // Monday
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  it('finds the correct month', () => {
    // "0 0 1 12 *" = midnight on Dec 1st
    const ref = new Date('2026-04-01T00:00:00.000Z')
    const next = nextCronDate('0 0 1 12 *', ref)
    expect(next.getMonth()).toBe(11) // December (0-indexed)
    expect(next.getDate()).toBe(1)
  })

  it('handles */15 step correctly', () => {
    const ref = new Date('2026-04-01T10:02:00.000Z')
    const next = nextCronDate('*/15 * * * *', ref)
    expect(next.getMinutes()).toBe(15)
  })

  it('returns a Date object', () => {
    const next = nextCronDate('* * * * *')
    expect(next).toBeInstanceOf(Date)
  })

  it('seconds are always zero', () => {
    const next = nextCronDate('* * * * *')
    expect(next.getSeconds()).toBe(0)
    expect(next.getMilliseconds()).toBe(0)
  })

  it('throws on invalid cron expression', () => {
    expect(() => nextCronDate('bad cron')).toThrow()
  })
})
