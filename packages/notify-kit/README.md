# @pauljump/notify-kit

Notification abstraction layer for the monorepo. Unified interface for sending notifications across channels.

## MVP: Email via Resend

```typescript
import { createNotifier } from '@pauljump/notify-kit'

const notify = createNotifier({
  email: { provider: 'resend', apiKey: process.env.RESEND_API_KEY!, from: 'hello@app.com' }
})

await notify.send({
  channel: 'email',
  to: 'user@example.com',
  subject: 'Welcome',
  body: '<p>Hello!</p>'
})
```

## Channels

| Channel | Status | Provider |
|---------|--------|----------|
| email   | Implemented | Resend |
| sms     | Planned | Twilio |
| push    | Planned | APNs |

Unsupported channels throw a descriptive error.

## Secret Management

Store `RESEND_API_KEY` in GCP Secret Manager as a shared key (see cloud-run-deploy playbook). Reference it in any Cloud Run service that needs email.
