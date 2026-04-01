import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNotifier } from '../notify.js'
import { sendEmail } from '../email.js'
import type { EmailConfig, NotificationPayload } from '../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_CONFIG: EmailConfig = {
  provider: 'resend',
  apiKey: 'test-api-key-123',
  from: 'noreply@example.com',
}

const EMAIL_PAYLOAD: NotificationPayload = {
  channel: 'email',
  to: 'user@example.com',
  subject: 'Hello',
  body: '<p>World</p>',
}

function mockFetchOk(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function mockFetchFail(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  })
}

function mockFetchNetworkError(message: string) {
  return vi.fn().mockRejectedValue(new Error(message))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createNotifier', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns a notifier with a send method', () => {
    const notifier = createNotifier({})
    expect(notifier).toBeDefined()
    expect(typeof notifier.send).toBe('function')
  })

  // ---- Email channel routing ------------------------------------------------

  it('send with email channel calls Resend API with correct URL, headers, and body', async () => {
    const fakeFetch = mockFetchOk({ id: 'msg_001' })
    vi.stubGlobal('fetch', fakeFetch)

    const notifier = createNotifier({ email: EMAIL_CONFIG })
    await notifier.send(EMAIL_PAYLOAD)

    expect(fakeFetch).toHaveBeenCalledOnce()

    const [url, options] = fakeFetch.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(options.method).toBe('POST')
    expect(options.headers['Authorization']).toBe('Bearer test-api-key-123')
    expect(options.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(options.body)
    expect(body).toEqual({
      from: 'noreply@example.com',
      to: ['user@example.com'],
      subject: 'Hello',
      html: '<p>World</p>',
    })
  })

  it('send with email returns { success: true, id } on 200', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: 'msg_abc' }))

    const notifier = createNotifier({ email: EMAIL_CONFIG })
    const result = await notifier.send(EMAIL_PAYLOAD)

    expect(result).toEqual({ success: true, id: 'msg_abc' })
  })

  it('send with email returns { success: false, error } on non-200', async () => {
    vi.stubGlobal('fetch', mockFetchFail(422, '{"message":"Invalid email"}'))

    const notifier = createNotifier({ email: EMAIL_CONFIG })
    const result = await notifier.send(EMAIL_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.error).toContain('422')
    expect(result.error).toContain('Invalid email')
  })

  it('send with email returns { success: false, error } on network error', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError('DNS resolution failed'))

    const notifier = createNotifier({ email: EMAIL_CONFIG })
    const result = await notifier.send(EMAIL_PAYLOAD)

    expect(result).toEqual({ success: false, error: 'DNS resolution failed' })
  })

  it('send with unconfigured email returns { success: false, error }', async () => {
    const notifier = createNotifier({})
    const result = await notifier.send(EMAIL_PAYLOAD)

    expect(result).toEqual({ success: false, error: 'Email channel not configured' })
  })

  // ---- SMS channel ----------------------------------------------------------

  it('send with sms channel throws "not implemented"', async () => {
    const notifier = createNotifier({})
    await expect(
      notifier.send({ channel: 'sms', to: '+1234567890', subject: 'Hi', body: 'Hey' })
    ).rejects.toThrow('SMS channel not implemented yet')
  })

  // ---- Push channel ---------------------------------------------------------

  it('send with unconfigured push returns { success: false, error }', async () => {
    const notifier = createNotifier({})
    const result = await notifier.send({
      channel: 'push',
      to: 'device-token-xyz',
      subject: 'Alert',
      body: 'Something happened',
    })

    expect(result).toEqual({ success: false, error: 'Push channel not configured' })
  })

  // ---- Unknown channel ------------------------------------------------------

  it('send with unknown channel throws', async () => {
    const notifier = createNotifier({})
    await expect(
      notifier.send({ channel: 'carrier-pigeon' as any, to: 'x', subject: 'x', body: 'x' })
    ).rejects.toThrow('Unknown notification channel: carrier-pigeon')
  })
})

// ---------------------------------------------------------------------------
// sendEmail (direct function tests)
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('sends correctly shaped request to Resend', async () => {
    const fakeFetch = mockFetchOk({ id: 'direct_001' })
    vi.stubGlobal('fetch', fakeFetch)

    const result = await sendEmail(EMAIL_CONFIG, EMAIL_PAYLOAD)

    expect(result).toEqual({ success: true, id: 'direct_001' })
    expect(fakeFetch).toHaveBeenCalledOnce()

    const [url, options] = fakeFetch.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(options.method).toBe('POST')
    expect(options.headers['Authorization']).toBe(`Bearer ${EMAIL_CONFIG.apiKey}`)
  })

  it('returns failure with status code on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(500, 'Internal Server Error'))

    const result = await sendEmail(EMAIL_CONFIG, EMAIL_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Resend 500: Internal Server Error')
  })

  it('returns failure with error message on fetch exception', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError('ECONNREFUSED'))

    const result = await sendEmail(EMAIL_CONFIG, EMAIL_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('handles non-Error throw gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'))

    const result = await sendEmail(EMAIL_CONFIG, EMAIL_PAYLOAD)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Unknown email error')
  })

  it('returns success without id when response has no id field', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}))

    const result = await sendEmail(EMAIL_CONFIG, EMAIL_PAYLOAD)

    expect(result.success).toBe(true)
    expect(result.id).toBeUndefined()
  })

  it('wraps to field in an array', async () => {
    const fakeFetch = mockFetchOk({ id: 'x' })
    vi.stubGlobal('fetch', fakeFetch)

    await sendEmail(EMAIL_CONFIG, {
      channel: 'email',
      to: 'single@user.com',
      subject: 'Test',
      body: 'Body',
    })

    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    expect(body.to).toEqual(['single@user.com'])
  })

  it('sends body as html field', async () => {
    const fakeFetch = mockFetchOk({ id: 'x' })
    vi.stubGlobal('fetch', fakeFetch)

    await sendEmail(EMAIL_CONFIG, {
      channel: 'email',
      to: 'a@b.com',
      subject: 'S',
      body: '<h1>Rich</h1>',
    })

    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    expect(body.html).toBe('<h1>Rich</h1>')
  })
})
