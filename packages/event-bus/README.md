# @pauljump/event-bus

Lightweight event bus for cross-project communication in the monorepo.

## In-process pub/sub

```ts
import { createEventBus } from '@pauljump/event-bus'

const bus = createEventBus()

// Subscribe — returns an unsubscribe function
const unsub = bus.on('listing.price_drop', async (payload) => {
  console.log(`Price dropped to ${payload.newPrice}`)
})

// Emit — all handlers run concurrently
await bus.emit('listing.price_drop', {
  listingId: 123,
  oldPrice: 4500,
  newPrice: 4200,
  userId: 1,
})

// Unsubscribe
unsub()
```

## Webhook delivery (cross-service)

```ts
import { deliverWebhook } from '@pauljump/event-bus'

const result = await deliverWebhook({
  url: 'https://other-service.run.app/webhooks/events',
  event: 'listing.price_drop',
  payload: { listingId: 123 },
  secret: 'shared-secret',
  retries: 3,
})

console.log(result) // { success: true, statusCode: 200, attempts: 1 }
```

### Webhook behavior

- POSTs JSON to the URL
- `X-Event-Type` header with the event name
- `X-Signature` header with HMAC-SHA256 of the body using the shared secret
- Retries with exponential backoff (500ms, 1s, 2s) on 5xx or network errors
- Does NOT retry on 4xx (client errors)

## Configuration

```ts
const bus = createEventBus({
  debug: true,        // Log emit/subscribe activity
  maxListeners: 20,   // Warn when exceeded (default: 10)
})
```

## API

| Method | Description |
|--------|-------------|
| `bus.on(event, handler)` | Subscribe. Returns unsubscribe function. |
| `bus.off(event, handler)` | Unsubscribe a specific handler. |
| `bus.emit(event, payload)` | Emit to all handlers (concurrent, errors isolated). |
| `bus.clear(event?)` | Remove listeners for one event or all. |
| `bus.listenerCount(event?)` | Count listeners for one event or total. |
| `deliverWebhook(options)` | HTTP POST with signature and retry. |
