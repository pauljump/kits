import type { EmailConfig, NotificationPayload, SendResult } from './types.js'

/** Send an email via Resend. */
export async function sendEmail(
  config: EmailConfig,
  payload: NotificationPayload
): Promise<SendResult> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.body,
      }),
    })

    if (res.ok) {
      const data = await res.json() as { id?: string }
      return { success: true, id: data.id }
    }

    const error = await res.text()
    return { success: false, error: `Resend ${res.status}: ${error}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown email error'
    return { success: false, error: message }
  }
}
