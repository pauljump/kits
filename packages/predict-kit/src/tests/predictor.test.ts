import { describe, it, expect, vi } from 'vitest'
import { createPredictor } from '../predictor.js'
import type { Observation } from '../types.js'

// Simple domain for testing: predict weather outcome based on season and pressure
interface WeatherInput {
  season: string
  pressure: 'high' | 'low' | 'normal'
}

function makePredictor(overrides?: {
  confidence?: { high: number; medium: number }
  fallback?: Record<string, number>
}) {
  return createPredictor<WeatherInput>({
    dimensions: {
      season: (d) => d.season,
      pressure: (d) => d.pressure,
    },
    outcomes: ['rain', 'sun', 'clouds'],
    ...overrides,
  })
}

function obs(season: string, pressure: 'high' | 'low' | 'normal', outcome: string): Observation<WeatherInput> {
  return { data: { season, pressure }, outcome }
}

describe('createPredictor', () => {
  it('returns a predictor with the expected API', () => {
    const p = makePredictor()
    expect(p).toHaveProperty('learn')
    expect(p).toHaveProperty('predict')
    expect(p).toHaveProperty('getPatterns')
    expect(p).toHaveProperty('getObservationCount')
    expect(p).toHaveProperty('reset')
  })
})

describe('learn', () => {
  it('accepts observations without error', () => {
    const p = makePredictor()
    expect(() =>
      p.learn([obs('winter', 'low', 'rain'), obs('summer', 'high', 'sun')])
    ).not.toThrow()
  })

  it('can be called multiple times (additive)', () => {
    const p = makePredictor()
    p.learn([obs('winter', 'low', 'rain')])
    p.learn([obs('winter', 'low', 'rain')])
    expect(p.getObservationCount()).toBe(2)
  })
})

describe('predict', () => {
  it('returns fallback probabilities when no data exists for a pattern', () => {
    const p = makePredictor({
      fallback: { rain: 50, sun: 30, clouds: 20 },
    })
    const result = p.predict({ season: 'spring', pressure: 'normal' })
    expect(result.probabilities).toEqual({ rain: 50, sun: 30, clouds: 20 })
    expect(result.sampleSize).toBe(0)
  })

  it('returns equal distribution when no fallback is specified', () => {
    const p = makePredictor()
    const result = p.predict({ season: 'spring', pressure: 'normal' })
    // 3 outcomes: 100/3 = 33 each, remainder 1 goes to first
    expect(result.probabilities).toEqual({ rain: 34, sun: 33, clouds: 33 })
  })

  it('returns learned probabilities after training', () => {
    const p = makePredictor()
    // 3 rain, 1 sun for winter/low
    p.learn([
      obs('winter', 'low', 'rain'),
      obs('winter', 'low', 'rain'),
      obs('winter', 'low', 'rain'),
      obs('winter', 'low', 'sun'),
    ])
    const result = p.predict({ season: 'winter', pressure: 'low' })
    expect(result.probabilities.rain).toBe(75)
    expect(result.probabilities.sun).toBe(25)
    // clouds should get 0 (remainder: 100 - 75 - 25 = 0)
    expect(result.probabilities.clouds).toBe(0)
    expect(result.sampleSize).toBe(4)
  })

  it('probabilities always sum to 100', () => {
    const p = makePredictor()
    // 3 outcomes with uneven splits to test rounding
    p.learn([
      obs('fall', 'normal', 'rain'),
      obs('fall', 'normal', 'sun'),
      obs('fall', 'normal', 'clouds'),
    ])
    const result = p.predict({ season: 'fall', pressure: 'normal' })
    const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0)
    expect(sum).toBe(100)
  })

  it('probabilities sum to 100 with uneven distribution', () => {
    const p = makePredictor()
    // 7 observations, hard to divide evenly into percentages
    p.learn([
      obs('spring', 'high', 'rain'),
      obs('spring', 'high', 'rain'),
      obs('spring', 'high', 'rain'),
      obs('spring', 'high', 'sun'),
      obs('spring', 'high', 'sun'),
      obs('spring', 'high', 'clouds'),
      obs('spring', 'high', 'clouds'),
    ])
    const result = p.predict({ season: 'spring', pressure: 'high' })
    const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0)
    expect(sum).toBe(100)
  })

  it('mostLikely matches the highest probability outcome', () => {
    const p = makePredictor()
    p.learn([
      obs('summer', 'high', 'sun'),
      obs('summer', 'high', 'sun'),
      obs('summer', 'high', 'sun'),
      obs('summer', 'high', 'rain'),
    ])
    const result = p.predict({ season: 'summer', pressure: 'high' })
    expect(result.mostLikely).toBe('sun')
  })

  it('returns the correct patternKey', () => {
    const p = makePredictor()
    const result = p.predict({ season: 'winter', pressure: 'low' })
    expect(result.patternKey).toBe('season:winter|pressure:low')
  })
})

describe('confidence', () => {
  it('is low with few observations', () => {
    const p = makePredictor({ confidence: { high: 10, medium: 5 } })
    p.learn([obs('winter', 'low', 'rain')])
    const result = p.predict({ season: 'winter', pressure: 'low' })
    expect(result.confidence).toBe('low')
  })

  it('is medium with moderate observations', () => {
    const p = makePredictor({ confidence: { high: 10, medium: 5 } })
    const observations = Array.from({ length: 5 }, () => obs('winter', 'low', 'rain'))
    p.learn(observations)
    const result = p.predict({ season: 'winter', pressure: 'low' })
    expect(result.confidence).toBe('medium')
  })

  it('is high with many observations', () => {
    const p = makePredictor({ confidence: { high: 10, medium: 5 } })
    const observations = Array.from({ length: 10 }, () => obs('winter', 'low', 'rain'))
    p.learn(observations)
    const result = p.predict({ season: 'winter', pressure: 'low' })
    expect(result.confidence).toBe('high')
  })

  it('uses default thresholds (high=10, medium=5) when not specified', () => {
    const p = makePredictor()
    // 4 observations → low
    p.learn(Array.from({ length: 4 }, () => obs('winter', 'low', 'rain')))
    expect(p.predict({ season: 'winter', pressure: 'low' }).confidence).toBe('low')

    // add 1 more → 5 → medium
    p.learn([obs('winter', 'low', 'rain')])
    expect(p.predict({ season: 'winter', pressure: 'low' }).confidence).toBe('medium')

    // add 5 more → 10 → high
    p.learn(Array.from({ length: 5 }, () => obs('winter', 'low', 'rain')))
    expect(p.predict({ season: 'winter', pressure: 'low' }).confidence).toBe('high')
  })

  it('is low when no data exists (sampleSize 0)', () => {
    const p = makePredictor()
    const result = p.predict({ season: 'winter', pressure: 'low' })
    expect(result.confidence).toBe('low')
    expect(result.sampleSize).toBe(0)
  })
})

describe('getPatterns', () => {
  it('returns empty object before any learning', () => {
    const p = makePredictor()
    expect(p.getPatterns()).toEqual({})
  })

  it('returns internal buckets after learning', () => {
    const p = makePredictor()
    p.learn([obs('winter', 'low', 'rain'), obs('winter', 'low', 'sun')])
    const patterns = p.getPatterns()
    const key = 'season:winter|pressure:low'
    expect(patterns[key]).toBeDefined()
    expect(patterns[key]!.total).toBe(2)
    expect(patterns[key]!.counts.rain).toBe(1)
    expect(patterns[key]!.counts.sun).toBe(1)
    expect(patterns[key]!.counts.clouds).toBe(0)
  })

  it('creates separate buckets for different dimension combinations', () => {
    const p = makePredictor()
    p.learn([obs('winter', 'low', 'rain'), obs('summer', 'high', 'sun')])
    const patterns = p.getPatterns()
    expect(Object.keys(patterns)).toHaveLength(2)
    expect(patterns['season:winter|pressure:low']).toBeDefined()
    expect(patterns['season:summer|pressure:high']).toBeDefined()
  })
})

describe('getObservationCount', () => {
  it('starts at zero', () => {
    const p = makePredictor()
    expect(p.getObservationCount()).toBe(0)
  })

  it('tracks total observations across all buckets', () => {
    const p = makePredictor()
    p.learn([obs('winter', 'low', 'rain'), obs('summer', 'high', 'sun')])
    expect(p.getObservationCount()).toBe(2)
    p.learn([obs('fall', 'normal', 'clouds')])
    expect(p.getObservationCount()).toBe(3)
  })

  it('does not count skipped unknown outcomes', () => {
    const p = makePredictor()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    p.learn([obs('winter', 'low', 'rain'), obs('winter', 'low', 'tornado')])
    expect(p.getObservationCount()).toBe(1)
    spy.mockRestore()
  })
})

describe('reset', () => {
  it('clears all learned data', () => {
    const p = makePredictor()
    p.learn([obs('winter', 'low', 'rain'), obs('summer', 'high', 'sun')])
    expect(p.getObservationCount()).toBe(2)

    p.reset()
    expect(p.getObservationCount()).toBe(0)
    expect(p.getPatterns()).toEqual({})
  })

  it('allows re-learning after reset', () => {
    const p = makePredictor()
    p.learn([obs('winter', 'low', 'rain')])
    p.reset()
    p.learn([obs('summer', 'high', 'sun')])
    expect(p.getObservationCount()).toBe(1)
    const result = p.predict({ season: 'summer', pressure: 'high' })
    expect(result.probabilities.sun).toBe(100)
  })
})

describe('unknown outcomes', () => {
  it('skips unknown outcomes with a console warning', () => {
    const p = makePredictor()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    p.learn([obs('winter', 'low', 'tornado')])

    expect(spy).toHaveBeenCalledWith(
      '[predict-kit] Unknown outcome "tornado" — skipping'
    )
    expect(p.getObservationCount()).toBe(0)
    spy.mockRestore()
  })

  it('processes valid observations alongside unknown ones', () => {
    const p = makePredictor()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    p.learn([
      obs('winter', 'low', 'rain'),
      obs('winter', 'low', 'tornado'),
      obs('winter', 'low', 'sun'),
    ])

    expect(p.getObservationCount()).toBe(2)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
