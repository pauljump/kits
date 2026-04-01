/**
 * @pauljump/payments-kit
 *
 * Provider-agnostic payments abstraction extracted from StuyWatch.
 * Currently supports Stripe. Designed so future providers (e.g. Paddle,
 * LemonSqueezy) can be added without changing consumer code.
 *
 * Usage:
 *   import { createPayments } from '@pauljump/payments-kit'
 *
 *   const payments = createPayments({
 *     provider: 'stripe',
 *     secretKey: process.env.STRIPE_SECRET_KEY!,
 *     webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
 *   })
 *
 *   const { url } = await payments.createCheckout({
 *     priceId: 'price_xxx',
 *     successUrl: '/success',
 *     cancelUrl: '/cancel',
 *   })
 */

import type Stripe from 'stripe'
import type { PaymentsConfig, PaymentsClient } from './types.js'
import { createStripeClient } from './stripe.js'
import { createCheckoutSession, createBillingPortalSession } from './checkout.js'
import { verifyWebhookSignature } from './webhooks.js'

// Re-export all types for consumers
export type {
  PaymentsConfig,
  PaymentsClient,
  CheckoutOptions,
  CheckoutResult,
  BillingPortalOptions,
  BillingPortalResult,
  WebhookEvent,
} from './types.js'

/**
 * Create a payments client.
 *
 * This is the main entry point. Pass your provider config and get back
 * a client with checkout, billing portal, and webhook methods.
 */
export function createPayments(config: PaymentsConfig): PaymentsClient {
  if (config.provider !== 'stripe') {
    throw new Error(`Unsupported payment provider: ${config.provider}`)
  }

  const stripe: Stripe = createStripeClient({ secretKey: config.secretKey })

  return {
    async createCheckout(options) {
      return createCheckoutSession(stripe, options)
    },

    async createBillingPortal(options) {
      return createBillingPortalSession(stripe, options)
    },

    verifyWebhook(body, signature) {
      if (!config.webhookSecret) {
        throw new Error('payments-kit: webhookSecret is required to verify webhooks')
      }
      return verifyWebhookSignature(stripe, body, signature, config.webhookSecret)
    },

    get provider() {
      return stripe
    },
  }
}
