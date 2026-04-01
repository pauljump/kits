# @pauljump/payments-kit

Provider-agnostic payments abstraction for the monorepo. Extracted from StuyWatch's working Stripe integration.

## Quick start

```typescript
import { createPayments } from '@pauljump/payments-kit'

const payments = createPayments({
  provider: 'stripe',
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
})
```

## Checkout

```typescript
const { url, sessionId } = await payments.createCheckout({
  priceId: 'price_xxx',
  successUrl: 'https://app.com/success?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://app.com/pricing',
  customerEmail: 'user@example.com',
  mode: 'subscription', // or 'payment' for one-time
  metadata: { userId: '42' },
})
// Redirect user to `url`
```

## Billing portal

```typescript
const { url } = await payments.createBillingPortal({
  customerId: 'cus_xxx',
  returnUrl: 'https://app.com/account',
})
```

## Webhooks

```typescript
// In your Fastify/Express route handler:
try {
  const event = payments.verifyWebhook(rawBody, signatureHeader)

  switch (event.type) {
    case 'checkout.session.completed':
      // event.data has the session object
      break
    case 'customer.subscription.updated':
      // event.data has the subscription object
      break
    case 'customer.subscription.deleted':
      break
    case 'invoice.payment_failed':
      break
  }

  return { received: true }
} catch (err) {
  return reply.status(400).send({ error: 'Invalid webhook signature' })
}
```

## Direct provider access

If you need Stripe-specific APIs not covered by the abstraction:

```typescript
import Stripe from 'stripe'

const stripe = payments.provider as Stripe
const customer = await stripe.customers.retrieve('cus_xxx')
```

## Adding to a project

```bash
# In your project's package.json dependencies:
"@pauljump/payments-kit": "workspace:*"

# Then:
pnpm install
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Stripe webhook signing secret |
