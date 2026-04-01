/** Supported notification channels. */
export type NotificationChannel = 'email' | 'sms' | 'push'

/** Payload for sending a notification. */
export interface NotificationPayload {
  channel: NotificationChannel
  to: string
  subject: string
  body: string
}

/** Configuration for the email channel. */
export interface EmailConfig {
  provider: 'resend'
  apiKey: string
  from: string
}

/** Configuration for future SMS channel. */
export interface SmsConfig {
  provider: 'resend'
  from: string
  apiKey: string
}

/** Configuration for APNs push channel. */
export interface PushConfig {
  provider: 'apns'
  /** APNs auth key ID (from Apple Developer portal → Keys). */
  keyId: string
  /** Your Apple Developer Team ID. */
  teamId: string
  /** App bundle identifier (e.g., "com.myapp.app"). */
  bundleId: string
  /** Path to the .p8 APNs auth key file. */
  keyPath: string
}

/** Top-level notifier configuration. */
export interface NotifyConfig {
  email?: EmailConfig
  sms?: SmsConfig
  push?: PushConfig
}

/** Result of a send operation. */
export interface SendResult {
  success: boolean
  id?: string
  error?: string
}
