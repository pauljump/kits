/**
 * predict-kit types.
 *
 * The core abstraction: given observations segmented by user-defined dimensions,
 * learn outcome probabilities and predict future outcomes with confidence scoring.
 *
 * Design:
 * - Dimensions are functions that extract a segment key from an observation
 * - Outcomes are string labels (e.g., 'increase', 'decrease', 'stable')
 * - The predictor is domain-agnostic — StuyWatch, tee times, camp waitlists all use the same engine
 * - Heuristics are optional overrides layered on top of learned patterns
 */

/** Extracts a segment value from an observation. */
export type DimensionFn<T> = (observation: T) => string

/** Configuration for creating a predictor. */
export interface PredictorConfig<T> {
  /** Named dimension extractors. Each produces a segment value from an observation. */
  dimensions: Record<string, DimensionFn<T>>
  /** The set of possible outcomes (e.g., ['increase', 'decrease', 'stable']). */
  outcomes: string[]
  /** Sample size thresholds for confidence levels. */
  confidence?: { high: number; medium: number }
  /** Fallback probabilities (percentages, must sum to 100) when no pattern exists. */
  fallback?: Record<string, number>
}

/** A single observation used for training. Observation data + which outcome occurred. */
export interface Observation<T> {
  data: T
  outcome: string
}

/** Internal tally for a pattern bucket. */
export interface PatternBucket {
  counts: Record<string, number>
  total: number
}

/** Result of a prediction. */
export interface Prediction {
  /** Probability for each outcome (percentages, sum to 100). */
  probabilities: Record<string, number>
  /** Which outcome is most likely. */
  mostLikely: string
  /** Confidence based on sample size. */
  confidence: 'high' | 'medium' | 'low'
  /** Number of observations in the matching pattern bucket. */
  sampleSize: number
  /** The pattern key that was matched (for debugging). */
  patternKey: string
}

/** A trained predictor instance. */
export interface Predictor<T> {
  /** Train on historical observations. Can be called multiple times (additive). */
  learn(observations: Observation<T>[]): void
  /** Predict outcome probabilities for a new observation. */
  predict(data: T): Prediction
  /** Get the raw pattern buckets (for inspection/debugging). */
  getPatterns(): Record<string, PatternBucket>
  /** Get total number of observations learned. */
  getObservationCount(): number
  /** Reset all learned patterns. */
  reset(): void
}
