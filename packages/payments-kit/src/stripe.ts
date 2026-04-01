/**
 * Stripe client wrapper.
 *
 * Thin layer over the stripe npm package — creates and configures a
 * Stripe instance with sensible defaults.
 */

import Stripe from 'stripe'

export interface StripeClientOptions {
  secretKey: string
}

export function createStripeClient(options: StripeClientOptions): Stripe {
  return new Stripe(options.secretKey)
}
