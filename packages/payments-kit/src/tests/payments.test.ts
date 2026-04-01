import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the stripe module before any imports that use it
vi.mock('stripe', () => {
  const mockStripeInstance = {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  }

  const StripeMock = vi.fn(() => mockStripeInstance)

  return { default: StripeMock, __mockInstance: mockStripeInstance }
})

import { createPayments } from '../index.js'
import { createStripeClient } from '../stripe.js'
import { createCheckoutSession, createBillingPortalSession } from '../checkout.js'
import { verifyWebhookSignature } from '../webhooks.js'
import StripeMock from 'stripe'

function getMockStripeInstance() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (StripeMock as any).__mockInstance ?? (StripeMock as any)()
}

// ---------------------------------------------------------------------------
// createPayments — factory
// ---------------------------------------------------------------------------
describe('createPayments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a client when provider is "stripe"', () => {
    const client = createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_fake',
    })

    expect(client).toBeDefined()
    expect(typeof client.createCheckout).toBe('function')
    expect(typeof client.createBillingPortal).toBe('function')
    expect(typeof client.verifyWebhook).toBe('function')
  })

  it('throws for an unknown provider', () => {
    expect(() =>
      createPayments({
        provider: 'paypal' as any,
        secretKey: 'key',
      }),
    ).toThrow('Unsupported payment provider: paypal')
  })

  it('exposes the underlying Stripe instance via provider', () => {
    const client = createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_fake',
    })

    // provider should be the mock Stripe instance
    expect(client.provider).toBeDefined()
    expect(client.provider).toBe(getMockStripeInstance())
  })

  it('passes the secret key to the Stripe constructor', () => {
    createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_specific_key',
    })

    expect(StripeMock).toHaveBeenCalledWith('sk_test_specific_key')
  })
})

// ---------------------------------------------------------------------------
// createStripeClient
// ---------------------------------------------------------------------------
describe('createStripeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a Stripe instance', () => {
    const stripe = createStripeClient({ secretKey: 'sk_test_123' })
    expect(stripe).toBeDefined()
    expect(StripeMock).toHaveBeenCalledWith('sk_test_123')
  })
})

// ---------------------------------------------------------------------------
// verifyWebhook — error when webhookSecret missing
// ---------------------------------------------------------------------------
describe('verifyWebhook (via client)', () => {
  it('throws when webhookSecret is not configured', () => {
    const client = createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_fake',
      // no webhookSecret
    })

    expect(() => client.verifyWebhook('body', 'sig_header')).toThrow(
      'payments-kit: webhookSecret is required to verify webhooks',
    )
  })

  it('delegates to stripe.webhooks.constructEvent when webhookSecret is set', () => {
    const mockInstance = getMockStripeInstance()
    const fakeEvent = {
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123', amount_total: 2000 } },
    }
    mockInstance.webhooks.constructEvent.mockReturnValue(fakeEvent)

    const client = createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_fake',
      webhookSecret: 'whsec_test',
    })

    const result = client.verifyWebhook('raw_body', 'sig_header_value')

    expect(mockInstance.webhooks.constructEvent).toHaveBeenCalledWith(
      'raw_body',
      'sig_header_value',
      'whsec_test',
    )
    expect(result).toEqual({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: { id: 'cs_123', amount_total: 2000 },
      raw: fakeEvent,
    })
  })

  it('propagates errors from constructEvent', () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Webhook signature verification failed')
    })

    const client = createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_fake',
      webhookSecret: 'whsec_test',
    })

    expect(() => client.verifyWebhook('tampered_body', 'bad_sig')).toThrow(
      'Webhook signature verification failed',
    )
  })
})

// ---------------------------------------------------------------------------
// verifyWebhookSignature — standalone function
// ---------------------------------------------------------------------------
describe('verifyWebhookSignature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a WebhookEvent mapped from the Stripe event', () => {
    const mockInstance = getMockStripeInstance()
    const fakeEvent = {
      id: 'evt_abc',
      type: 'invoice.paid',
      data: { object: { customer: 'cus_xyz', amount_paid: 5000 } },
    }
    mockInstance.webhooks.constructEvent.mockReturnValue(fakeEvent)

    const result = verifyWebhookSignature(
      mockInstance as any,
      'body_content',
      'sig_value',
      'whsec_secret',
    )

    expect(result).toEqual({
      id: 'evt_abc',
      type: 'invoice.paid',
      data: { customer: 'cus_xyz', amount_paid: 5000 },
      raw: fakeEvent,
    })
  })

  it('accepts Buffer body', () => {
    const mockInstance = getMockStripeInstance()
    const fakeEvent = {
      id: 'evt_buf',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123' } },
    }
    mockInstance.webhooks.constructEvent.mockReturnValue(fakeEvent)

    const body = Buffer.from('raw webhook body')
    const result = verifyWebhookSignature(
      mockInstance as any,
      body,
      'sig',
      'whsec_test',
    )

    expect(mockInstance.webhooks.constructEvent).toHaveBeenCalledWith(
      body,
      'sig',
      'whsec_test',
    )
    expect(result.id).toBe('evt_buf')
  })
})

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------
describe('createCheckoutSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a subscription checkout session by default', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_123',
      url: 'https://checkout.stripe.com/pay/cs_123',
    })

    const result = await createCheckoutSession(mockInstance as any, {
      priceId: 'price_abc',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    })

    expect(mockInstance.checkout.sessions.create).toHaveBeenCalledWith({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: 'price_abc', quantity: 1 }],
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      metadata: undefined,
    })

    expect(result).toEqual({
      sessionId: 'cs_123',
      url: 'https://checkout.stripe.com/pay/cs_123',
    })
  })

  it('uses "payment" mode when specified', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_456',
      url: 'https://checkout.stripe.com/pay/cs_456',
    })

    await createCheckoutSession(mockInstance as any, {
      priceId: 'price_xyz',
      successUrl: '/success',
      cancelUrl: '/cancel',
      mode: 'payment',
    })

    expect(mockInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'payment' }),
    )
  })

  it('passes customerId when provided', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_cust',
      url: 'https://checkout.stripe.com/cs_cust',
    })

    await createCheckoutSession(mockInstance as any, {
      priceId: 'price_abc',
      successUrl: '/success',
      cancelUrl: '/cancel',
      customerId: 'cus_existing',
    })

    expect(mockInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    )
  })

  it('passes customerEmail when customerId is not provided', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_email',
      url: 'https://checkout.stripe.com/cs_email',
    })

    await createCheckoutSession(mockInstance as any, {
      priceId: 'price_abc',
      successUrl: '/success',
      cancelUrl: '/cancel',
      customerEmail: 'user@example.com',
    })

    expect(mockInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'user@example.com' }),
    )
  })

  it('prefers customerId over customerEmail', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_both',
      url: 'https://checkout.stripe.com/cs_both',
    })

    await createCheckoutSession(mockInstance as any, {
      priceId: 'price_abc',
      successUrl: '/success',
      cancelUrl: '/cancel',
      customerId: 'cus_123',
      customerEmail: 'user@example.com',
    })

    const callArgs = mockInstance.checkout.sessions.create.mock.calls[0][0]
    expect(callArgs.customer).toBe('cus_123')
    expect(callArgs.customer_email).toBeUndefined()
  })

  it('passes metadata through', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_meta',
      url: 'https://checkout.stripe.com/cs_meta',
    })

    await createCheckoutSession(mockInstance as any, {
      priceId: 'price_abc',
      successUrl: '/success',
      cancelUrl: '/cancel',
      metadata: { userId: 'u_123', plan: 'pro' },
    })

    expect(mockInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { userId: 'u_123', plan: 'pro' } }),
    )
  })

  it('returns empty string url when Stripe returns null url', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_null_url',
      url: null,
    })

    const result = await createCheckoutSession(mockInstance as any, {
      priceId: 'price_abc',
      successUrl: '/success',
      cancelUrl: '/cancel',
    })

    expect(result.url).toBe('')
  })
})

// ---------------------------------------------------------------------------
// createBillingPortalSession
// ---------------------------------------------------------------------------
describe('createBillingPortalSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a billing portal session', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.billingPortal.sessions.create.mockResolvedValue({
      url: 'https://billing.stripe.com/session/bp_123',
    })

    const result = await createBillingPortalSession(mockInstance as any, {
      customerId: 'cus_456',
      returnUrl: 'https://example.com/account',
    })

    expect(mockInstance.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_456',
      return_url: 'https://example.com/account',
    })

    expect(result).toEqual({
      url: 'https://billing.stripe.com/session/bp_123',
    })
  })
})

// ---------------------------------------------------------------------------
// Client integration — createCheckout and createBillingPortal delegate
// ---------------------------------------------------------------------------
describe('client method delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createCheckout delegates to checkout.sessions.create', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_via_client',
      url: 'https://checkout.stripe.com/cs_via_client',
    })

    const client = createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_fake',
    })

    const result = await client.createCheckout({
      priceId: 'price_test',
      successUrl: '/ok',
      cancelUrl: '/nope',
    })

    expect(result.sessionId).toBe('cs_via_client')
    expect(result.url).toBe('https://checkout.stripe.com/cs_via_client')
    expect(mockInstance.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it('createBillingPortal delegates to billingPortal.sessions.create', async () => {
    const mockInstance = getMockStripeInstance()
    mockInstance.billingPortal.sessions.create.mockResolvedValue({
      url: 'https://billing.stripe.com/portal',
    })

    const client = createPayments({
      provider: 'stripe',
      secretKey: 'sk_test_fake',
    })

    const result = await client.createBillingPortal({
      customerId: 'cus_789',
      returnUrl: '/account',
    })

    expect(result.url).toBe('https://billing.stripe.com/portal')
    expect(mockInstance.billingPortal.sessions.create).toHaveBeenCalledTimes(1)
  })
})
