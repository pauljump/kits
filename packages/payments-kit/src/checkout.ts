/**
 * Checkout + billing portal session helpers.
 *
 * Extracted from stuywatch/api/src/routes/stripe.ts — the same patterns
 * that power StuyWatch payments, made reusable.
 */

import type Stripe from 'stripe'
import type {
  CheckoutOptions,
  CheckoutResult,
  BillingPortalOptions,
  BillingPortalResult,
} from './types.js'

/**
 * Create a Stripe Checkout session.
 *
 * Maps our provider-agnostic CheckoutOptions to Stripe's API.
 */
export async function createCheckoutSession(
  stripe: Stripe,
  options: CheckoutOptions,
): Promise<CheckoutResult> {
  const session = await stripe.checkout.sessions.create({
    mode: options.mode ?? 'subscription',
    payment_method_types: ['card'],
    ...(options.customerId
      ? { customer: options.customerId }
      : options.customerEmail
        ? { customer_email: options.customerEmail }
        : {}),
    line_items: [
      {
        price: options.priceId,
        quantity: 1,
      },
    ],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    metadata: options.metadata,
  })

  return {
    sessionId: session.id,
    url: session.url ?? '',
  }
}

/**
 * Create a Stripe Billing Portal session.
 *
 * Lets existing customers manage subscriptions, update payment methods, etc.
 */
export async function createBillingPortalSession(
  stripe: Stripe,
  options: BillingPortalOptions,
): Promise<BillingPortalResult> {
  const session = await stripe.billingPortal.sessions.create({
    customer: options.customerId,
    return_url: options.returnUrl,
  })

  return {
    url: session.url,
  }
}
