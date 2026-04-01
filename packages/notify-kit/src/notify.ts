import { sendEmail } from './email.js'
import { sendPush } from './push.js'
import type { NotifyConfig, NotificationPayload, SendResult } from './types.js'

/** A configured notifier instance with a send() method. */
export interface Notifier {
  send(payload: NotificationPayload): Promise<SendResult>
}

/**
 * Create a notifier with channel configurations.
 *
 * Usage:
 * ```ts
 * const notify = createNotifier({
 *   email: { provider: 'resend', apiKey: process.env.RESEND_API_KEY!, from: 'hello@app.com' }
 * })
 *
 * await notify.send({
 *   channel: 'email',
 *   to: 'user@example.com',
 *   subject: 'Welcome',
 *   body: '<p>Hello!</p>'
 * })
 * ```
 */
export function createNotifier(config: NotifyConfig): Notifier {
  return {
    async send(payload: NotificationPayload): Promise<SendResult> {
      switch (payload.channel) {
        case 'email': {
          if (!config.email) {
            return { success: false, error: 'Email channel not configured' }
          }
          return sendEmail(config.email, payload)
        }

        case 'sms':
          throw new Error('SMS channel not implemented yet')

        case 'push': {
          if (!config.push) {
            return { success: false, error: 'Push channel not configured' }
          }
          return sendPush(config.push, payload)
        }

        default:
          throw new Error(`Unknown notification channel: ${(payload as any).channel}`)
      }
    },
  }
}
