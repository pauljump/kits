/**
 * payments-kit types — provider-agnostic payment abstractions.
 *
 * Designed for future providers but only Stripe implemented today.
 */

/** Configuration for creating a payments client. */
export interface PaymentsConfig {
  /** Payment provider. Only 'stripe' supported today. */
  provider: 'stripe'
  /** Provider secret/API key. */
  secretKey: string
  /** Webhook signing secret for verifying inbound events. */
  webhookSecret?: string
}

/** Options for creating a checkout session. */
export interface CheckoutOptions {
  /** The price ID to charge (e.g. Stripe price_xxx). */
  priceId: string
  /** URL to redirect on successful payment. */
  successUrl: string
  /** URL to redirect on cancelled payment. */
  cancelUrl: string
  /** Existing customer ID (if known). */
  customerId?: string
  /** Customer email (used if no customerId). */
  customerEmail?: string
  /** Checkout mode. Defaults to 'subscription'. */
  mode?: 'subscription' | 'payment'
  /** Arbitrary metadata attached to the session. */
  metadata?: Record<string, string>
}

/** Result from creating a checkout session. */
export interface CheckoutResult {
  /** The checkout session ID. */
  sessionId: string
  /** The URL to redirect the customer to. */
  url: string
}

/** Options for creating a billing portal session. */
export interface BillingPortalOptions {
  /** The customer ID to open the portal for. */
  customerId: string
  /** URL to return to after the portal session. */
  returnUrl: string
}

/** Result from creating a billing portal session. */
export interface BillingPortalResult {
  /** The URL to redirect the customer to. */
  url: string
}

/** A verified webhook event from the payment provider. */
export interface WebhookEvent {
  /** Provider-specific event ID. */
  id: string
  /** Event type string (e.g. 'checkout.session.completed'). */
  type: string
  /** The event payload — provider-specific shape. */
  data: Record<string, unknown>
  /** The raw provider event object for advanced use cases. */
  raw: unknown
}

/** The payments client interface — what createPayments() returns. */
export interface PaymentsClient {
  /** Create a checkout session. */
  createCheckout(options: CheckoutOptions): Promise<CheckoutResult>
  /** Create a billing portal session for an existing customer. */
  createBillingPortal(options: BillingPortalOptions): Promise<BillingPortalResult>
  /** Verify a webhook signature and return the parsed event. */
  verifyWebhook(body: string | Buffer, signature: string): WebhookEvent
  /** Access the underlying provider client (e.g. Stripe instance). */
  readonly provider: unknown
}
