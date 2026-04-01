/**
 * Segmented pattern predictor.
 *
 * Learns outcome probabilities by segmenting observations across
 * user-defined dimensions. Each unique combination of dimension values
 * creates a "pattern bucket" that tallies outcomes independently.
 *
 * Example: for StuyWatch, dimensions are property × bedrooms × DOM bucket × price level.
 * A bucket like "Stuytown|2br|30+days|mid" might have 47 observations showing
 * 68% decrease, 12% increase, 20% stable.
 *
 * For tee times, dimensions might be course × dayOfWeek × timeSlot × daysOut.
 * A bucket like "Bethpage|Saturday|morning|3-6days" might show
 * 40% reopened, 45% stayed booked, 15% available.
 */

import type {
  PredictorConfig,
  Observation,
  Prediction,
  PatternBucket,
  Predictor,
} from './types.js'

export function createPredictor<T>(config: PredictorConfig<T>): Predictor<T> {
  const patterns: Record<string, PatternBucket> = {}
  let observationCount = 0

  const confidenceHigh = config.confidence?.high ?? 10
  const confidenceMedium = config.confidence?.medium ?? 5

  // Build fallback probabilities
  const fallback: Record<string, number> = config.fallback ? { ...config.fallback } : {}
  if (Object.keys(fallback).length === 0) {
    // Equal distribution if no fallback specified
    const equal = Math.floor(100 / config.outcomes.length)
    for (const outcome of config.outcomes) {
      fallback[outcome] = equal
    }
    // Give remainder to first outcome
    const first = config.outcomes[0]
    if (first) fallback[first] = (fallback[first] ?? 0) + (100 - equal * config.outcomes.length)
  }

  function buildKey(data: T): string {
    const parts: string[] = []
    for (const [name, fn] of Object.entries(config.dimensions)) {
      parts.push(`${name}:${fn(data)}`)
    }
    return parts.join('|')
  }

  function getConfidence(sampleSize: number): 'high' | 'medium' | 'low' {
    if (sampleSize >= confidenceHigh) return 'high'
    if (sampleSize >= confidenceMedium) return 'medium'
    return 'low'
  }

  return {
    learn(observations: Observation<T>[]): void {
      for (const obs of observations) {
        if (!config.outcomes.includes(obs.outcome)) {
          console.warn(`[predict-kit] Unknown outcome "${obs.outcome}" — skipping`)
          continue
        }

        const key = buildKey(obs.data)

        if (!patterns[key]) {
          const counts: Record<string, number> = {}
          for (const outcome of config.outcomes) counts[outcome] = 0
          patterns[key] = { counts, total: 0 }
        }

        const bucket = patterns[key]!
        bucket.counts[obs.outcome] = (bucket.counts[obs.outcome] ?? 0) + 1
        bucket.total++
        observationCount++
      }
    },

    predict(data: T): Prediction {
      const key = buildKey(data)
      const bucket = patterns[key]

      let probabilities: Record<string, number>
      let sampleSize: number

      if (bucket && bucket.total > 0) {
        probabilities = {}
        let sum = 0
        const outcomes = config.outcomes

        // Calculate percentages for all but last outcome
        for (let i = 0; i < outcomes.length - 1; i++) {
          const outcome = outcomes[i]!
          const pct = Math.round(((bucket.counts[outcome] ?? 0) / bucket.total) * 100)
          probabilities[outcome] = pct
          sum += pct
        }
        // Last outcome gets the remainder (ensures sum = 100)
        const lastOutcome = outcomes[outcomes.length - 1]!
        probabilities[lastOutcome] = 100 - sum
        sampleSize = bucket.total
      } else {
        probabilities = { ...fallback }
        sampleSize = 0
      }

      // Find most likely outcome
      let mostLikely = config.outcomes[0] ?? 'unknown'
      let maxProb = 0
      for (const [outcome, prob] of Object.entries(probabilities)) {
        if (prob > maxProb) {
          maxProb = prob
          mostLikely = outcome
        }
      }

      return {
        probabilities,
        mostLikely,
        confidence: getConfidence(sampleSize),
        sampleSize,
        patternKey: key,
      }
    },

    getPatterns(): Record<string, PatternBucket> {
      return patterns
    },

    getObservationCount(): number {
      return observationCount
    },

    reset(): void {
      for (const key of Object.keys(patterns)) delete patterns[key]
      observationCount = 0
    },
  }
}
