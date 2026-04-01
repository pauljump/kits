/**
 * Webhook verification and event parsing.
 *
 * Extracted from stuywatch's webhook handler — verifies Stripe signatures
 * and returns a provider-agnostic WebhookEvent.
 */

import type Stripe from 'stripe'
import type { WebhookEvent } from './types.js'

/**
 * Verify a Stripe webhook signature and parse the event.
 *
 * Throws if the signature is invalid — callers should catch and return 400.
 */
export function verifyWebhookSignature(
  stripe: Stripe,
  body: string | Buffer,
  signature: string,
  webhookSecret: string,
): WebhookEvent {
  const event = stripe.webhooks.constructEvent(body, signature, webhookSecret)

  return {
    id: event.id,
    type: event.type,
    data: event.data.object as unknown as Record<string, unknown>,
    raw: event,
  }
}
