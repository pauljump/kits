import { describe, it, expect } from 'vitest'
import type { WatchEvent } from '../types.js'
import {
  onAdded,
  onRemoved,
  onChanged,
  onFieldChanged,
  onThreshold,
  onDecrease,
  onIncrease,
  allOf,
  anyOf,
} from '../conditions.js'

interface TestItem {
  name: string
  price: number
  stock: number
}

function makeEvent(overrides: Partial<WatchEvent<TestItem>> & { type: WatchEvent<TestItem>['type'] }): WatchEvent<TestItem> {
  return {
    key: 'item-1',
    current: { name: 'Widget', price: 100, stock: 10 },
    previous: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

// ── onAdded ──

describe('onAdded', () => {
  const cond = onAdded<TestItem>()

  it('triggers for added events', () => {
    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(true)
  })

  it('does not trigger for other event types', () => {
    expect(cond.fn(makeEvent({ type: 'removed' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'changed' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'unchanged' }))).toBe(false)
  })

  it('uses default name when none provided', () => {
    expect(cond.name).toBe('on-added')
  })

  it('uses custom name when provided', () => {
    expect(onAdded<TestItem>('new-listing').name).toBe('new-listing')
  })
})

// ── onRemoved ──

describe('onRemoved', () => {
  const cond = onRemoved<TestItem>()

  it('triggers for removed events', () => {
    expect(cond.fn(makeEvent({ type: 'removed', current: null }))).toBe(true)
  })

  it('does not trigger for other event types', () => {
    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'changed' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'unchanged' }))).toBe(false)
  })

  it('has correct default name', () => {
    expect(cond.name).toBe('on-removed')
  })
})

// ── onChanged ──

describe('onChanged', () => {
  const cond = onChanged<TestItem>()

  it('triggers for changed events', () => {
    expect(cond.fn(makeEvent({ type: 'changed', changedFields: ['price'] }))).toBe(true)
  })

  it('does not trigger for other event types', () => {
    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'removed' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'unchanged' }))).toBe(false)
  })
})

// ── onFieldChanged ──

describe('onFieldChanged', () => {
  const cond = onFieldChanged<TestItem>('price')

  it('triggers when the specific field is in changedFields', () => {
    const event = makeEvent({
      type: 'changed',
      changedFields: ['price', 'stock'],
      previous: { name: 'Widget', price: 50, stock: 10 },
    })
    expect(cond.fn(event)).toBe(true)
  })

  it('does not trigger when the field is not in changedFields', () => {
    const event = makeEvent({
      type: 'changed',
      changedFields: ['stock'],
      previous: { name: 'Widget', price: 100, stock: 5 },
    })
    expect(cond.fn(event)).toBe(false)
  })

  it('does not trigger for non-changed event types', () => {
    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'removed' }))).toBe(false)
  })

  it('does not trigger when changedFields is undefined', () => {
    expect(cond.fn(makeEvent({ type: 'changed' }))).toBe(false)
  })

  it('has correct default name', () => {
    expect(cond.name).toBe('on-price-changed')
  })
})

// ── onThreshold ──

describe('onThreshold', () => {
  describe('above', () => {
    const cond = onThreshold<TestItem>('price', 500, 'above')

    it('triggers when value is above threshold on changed event', () => {
      const event = makeEvent({
        type: 'changed',
        current: { name: 'Widget', price: 600, stock: 10 },
        previous: { name: 'Widget', price: 400, stock: 10 },
        changedFields: ['price'],
      })
      expect(cond.fn(event)).toBe(true)
    })

    it('triggers when value is above threshold on added event', () => {
      const event = makeEvent({
        type: 'added',
        current: { name: 'Widget', price: 600, stock: 10 },
      })
      expect(cond.fn(event)).toBe(true)
    })

    it('does not trigger when value equals threshold', () => {
      const event = makeEvent({
        type: 'changed',
        current: { name: 'Widget', price: 500, stock: 10 },
        changedFields: ['price'],
      })
      expect(cond.fn(event)).toBe(false)
    })

    it('does not trigger when value is below threshold', () => {
      const event = makeEvent({
        type: 'changed',
        current: { name: 'Widget', price: 200, stock: 10 },
        changedFields: ['price'],
      })
      expect(cond.fn(event)).toBe(false)
    })

    it('does not trigger for removed/unchanged events', () => {
      expect(cond.fn(makeEvent({ type: 'removed' }))).toBe(false)
      expect(cond.fn(makeEvent({ type: 'unchanged' }))).toBe(false)
    })
  })

  describe('below', () => {
    const cond = onThreshold<TestItem>('stock', 5, 'below')

    it('triggers when value is below threshold', () => {
      const event = makeEvent({
        type: 'changed',
        current: { name: 'Widget', price: 100, stock: 2 },
        changedFields: ['stock'],
      })
      expect(cond.fn(event)).toBe(true)
    })

    it('does not trigger when value equals threshold', () => {
      const event = makeEvent({
        type: 'changed',
        current: { name: 'Widget', price: 100, stock: 5 },
        changedFields: ['stock'],
      })
      expect(cond.fn(event)).toBe(false)
    })

    it('does not trigger when value is above threshold', () => {
      const event = makeEvent({
        type: 'changed',
        current: { name: 'Widget', price: 100, stock: 10 },
        changedFields: ['stock'],
      })
      expect(cond.fn(event)).toBe(false)
    })
  })

  it('does not trigger when field is not a number', () => {
    const cond = onThreshold<TestItem>('name', 5, 'above')
    const event = makeEvent({
      type: 'changed',
      current: { name: 'Widget', price: 100, stock: 10 },
      changedFields: ['name'],
    })
    expect(cond.fn(event)).toBe(false)
  })

  it('has correct default name', () => {
    expect(onThreshold<TestItem>('price', 500, 'above').name).toBe('on-price-above-500')
  })
})

// ── onDecrease ──

describe('onDecrease', () => {
  const cond = onDecrease<TestItem>('price')

  it('triggers when value decreases', () => {
    const event = makeEvent({
      type: 'changed',
      current: { name: 'Widget', price: 80, stock: 10 },
      previous: { name: 'Widget', price: 100, stock: 10 },
      changedFields: ['price'],
    })
    expect(cond.fn(event)).toBe(true)
  })

  it('does not trigger when value increases', () => {
    const event = makeEvent({
      type: 'changed',
      current: { name: 'Widget', price: 120, stock: 10 },
      previous: { name: 'Widget', price: 100, stock: 10 },
      changedFields: ['price'],
    })
    expect(cond.fn(event)).toBe(false)
  })

  it('does not trigger when value stays the same', () => {
    const event = makeEvent({
      type: 'changed',
      current: { name: 'Widget', price: 100, stock: 10 },
      previous: { name: 'Widget', price: 100, stock: 10 },
      changedFields: ['stock'],
    })
    expect(cond.fn(event)).toBe(false)
  })

  it('does not trigger for non-changed events', () => {
    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'removed' }))).toBe(false)
  })

  it('does not trigger when field is not a number', () => {
    const nameCond = onDecrease<TestItem>('name')
    const event = makeEvent({
      type: 'changed',
      current: { name: 'A', price: 100, stock: 10 },
      previous: { name: 'B', price: 100, stock: 10 },
      changedFields: ['name'],
    })
    expect(nameCond.fn(event)).toBe(false)
  })

  it('has correct default name', () => {
    expect(cond.name).toBe('on-price-decrease')
  })
})

// ── onIncrease ──

describe('onIncrease', () => {
  const cond = onIncrease<TestItem>('stock')

  it('triggers when value increases', () => {
    const event = makeEvent({
      type: 'changed',
      current: { name: 'Widget', price: 100, stock: 20 },
      previous: { name: 'Widget', price: 100, stock: 10 },
      changedFields: ['stock'],
    })
    expect(cond.fn(event)).toBe(true)
  })

  it('does not trigger when value decreases', () => {
    const event = makeEvent({
      type: 'changed',
      current: { name: 'Widget', price: 100, stock: 5 },
      previous: { name: 'Widget', price: 100, stock: 10 },
      changedFields: ['stock'],
    })
    expect(cond.fn(event)).toBe(false)
  })

  it('does not trigger for non-changed events', () => {
    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(false)
  })

  it('has correct default name', () => {
    expect(cond.name).toBe('on-stock-increase')
  })
})

// ── allOf ──

describe('allOf', () => {
  it('requires all conditions to be true', () => {
    const cond = allOf<TestItem>([
      onChanged(),
      onFieldChanged('price'),
    ])

    // Both match
    const event = makeEvent({
      type: 'changed',
      changedFields: ['price'],
      previous: { name: 'Widget', price: 50, stock: 10 },
    })
    expect(cond.fn(event)).toBe(true)
  })

  it('returns false if any condition is false', () => {
    const cond = allOf<TestItem>([
      onChanged(),
      onFieldChanged('price'),
    ])

    // Changed but not the price field
    const event = makeEvent({
      type: 'changed',
      changedFields: ['stock'],
      previous: { name: 'Widget', price: 100, stock: 5 },
    })
    expect(cond.fn(event)).toBe(false)
  })

  it('returns false when event type does not match any condition', () => {
    const cond = allOf<TestItem>([onAdded(), onRemoved()])
    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(false)
  })

  it('has correct default name', () => {
    const cond = allOf<TestItem>([onChanged('c1'), onFieldChanged('price', 'c2')])
    expect(cond.name).toBe('all-of(c1, c2)')
  })

  it('uses custom name when provided', () => {
    const cond = allOf<TestItem>([onChanged()], 'my-combo')
    expect(cond.name).toBe('my-combo')
  })
})

// ── anyOf ──

describe('anyOf', () => {
  it('triggers if any condition is true', () => {
    const cond = anyOf<TestItem>([onAdded(), onRemoved()])

    expect(cond.fn(makeEvent({ type: 'added' }))).toBe(true)
    expect(cond.fn(makeEvent({ type: 'removed' }))).toBe(true)
  })

  it('returns false if no conditions match', () => {
    const cond = anyOf<TestItem>([onAdded(), onRemoved()])
    expect(cond.fn(makeEvent({ type: 'changed' }))).toBe(false)
    expect(cond.fn(makeEvent({ type: 'unchanged' }))).toBe(false)
  })

  it('has correct default name', () => {
    const cond = anyOf<TestItem>([onAdded('a'), onRemoved('r')])
    expect(cond.name).toBe('any-of(a, r)')
  })

  it('uses custom name when provided', () => {
    const cond = anyOf<TestItem>([onAdded()], 'any-change')
    expect(cond.name).toBe('any-change')
  })
})

// ── Edge cases ──

describe('edge cases', () => {
  it('onThreshold handles null current gracefully', () => {
    const cond = onThreshold<TestItem>('price', 100, 'above')
    const event = makeEvent({ type: 'removed', current: null })
    expect(cond.fn(event)).toBe(false)
  })

  it('onDecrease handles null previous gracefully', () => {
    const cond = onDecrease<TestItem>('price')
    const event = makeEvent({ type: 'changed', previous: null, changedFields: ['price'] })
    expect(cond.fn(event)).toBe(false)
  })

  it('onIncrease handles null current gracefully', () => {
    const cond = onIncrease<TestItem>('price')
    const event = makeEvent({ type: 'changed', current: null, changedFields: ['price'] })
    expect(cond.fn(event)).toBe(false)
  })
})
