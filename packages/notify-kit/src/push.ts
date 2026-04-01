/**
 * Send push notifications via Apple Push Notification service (APNs).
 *
 * Uses HTTP/2 with JWT auth — zero external dependencies.
 * Node's native `http2` module + `crypto` for JWT signing.
 *
 * APNs flow:
 * 1. Sign a JWT with your .p8 key (ES256)
 * 2. POST to api.push.apple.com/3/device/{token}
 * 3. Payload: { aps: { alert: { title, body }, sound: "default" } }
 *
 * The JWT is cached for 50 minutes (APNs allows 60 min max).
 */

import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'
import http2 from 'node:http2'
import type { PushConfig, NotificationPayload, SendResult } from './types.js'

const APNS_HOST_PROD = 'https://api.push.apple.com'
const APNS_HOST_SANDBOX = 'https://api.sandbox.push.apple.com'
const JWT_TTL_MS = 50 * 60 * 1000 // 50 minutes (APNs max is 60)

// JWT cache per config to avoid re-signing on every push
let cachedJwt: { token: string; expiresAt: number; keyId: string } | null = null

function createApnsJwt(config: PushConfig): string {
  const now = Math.floor(Date.now() / 1000)

  // Return cached JWT if still valid
  if (cachedJwt && cachedJwt.keyId === config.keyId && cachedJwt.expiresAt > Date.now()) {
    return cachedJwt.token
  }

  // Read the .p8 key file
  const key = readFileSync(config.keyPath, 'utf8')

  // JWT Header
  const header = Buffer.from(JSON.stringify({
    alg: 'ES256',
    kid: config.keyId,
  })).toString('base64url')

  // JWT Claims
  const claims = Buffer.from(JSON.stringify({
    iss: config.teamId,
    iat: now,
  })).toString('base64url')

  // Sign with ES256
  const signer = createSign('SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(key, 'base64url')

  const jwt = `${header}.${claims}.${signature}`

  // Cache it
  cachedJwt = {
    token: jwt,
    keyId: config.keyId,
    expiresAt: Date.now() + JWT_TTL_MS,
  }

  return jwt
}

/**
 * Send a push notification via APNs HTTP/2.
 *
 * @param config - APNs configuration (keyId, teamId, bundleId, keyPath)
 * @param payload - Notification payload (to = device token, subject = title, body = message)
 * @param sandbox - Use sandbox endpoint (default: false for production)
 */
export async function sendPush(
  config: PushConfig,
  payload: NotificationPayload,
  sandbox?: boolean,
): Promise<SendResult> {
  const jwt = createApnsJwt(config)
  const host = sandbox ? APNS_HOST_SANDBOX : APNS_HOST_PROD
  const deviceToken = payload.to
  const path = `/3/device/${deviceToken}`

  const apnsPayload = JSON.stringify({
    aps: {
      alert: {
        title: payload.subject,
        body: payload.body,
      },
      sound: 'default',
    },
  })

  return new Promise<SendResult>((resolve) => {
    const client = http2.connect(host)

    client.on('error', (err) => {
      client.close()
      resolve({ success: false, error: `HTTP/2 connection error: ${err.message}` })
    })

    const req = client.request({
      ':method': 'POST',
      ':path': path,
      'authorization': `bearer ${jwt}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    })

    let responseData = ''
    let statusCode = 0

    req.on('response', (headers) => {
      statusCode = headers[':status'] as number
    })

    req.on('data', (chunk: Buffer) => {
      responseData += chunk.toString()
    })

    req.on('end', () => {
      client.close()

      if (statusCode === 200) {
        resolve({ success: true, id: deviceToken })
      } else {
        let errorMsg = `APNs returned ${statusCode}`
        try {
          const parsed = JSON.parse(responseData)
          if (parsed.reason) errorMsg = `APNs ${statusCode}: ${parsed.reason}`
        } catch { /* use default message */ }
        resolve({ success: false, error: errorMsg })
      }
    })

    req.on('error', (err) => {
      client.close()
      resolve({ success: false, error: `APNs request error: ${err.message}` })
    })

    req.write(apnsPayload)
    req.end()
  })
}
