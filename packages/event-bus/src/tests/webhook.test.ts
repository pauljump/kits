import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { deliverWebhook } from '../webhook.js'

function makeResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `Status ${status}`,
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => makeResponse(status),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => ({}),
    text: async () => '',
    bytes: async () => new Uint8Array(),
  } as Response
}

describe('deliverWebhook', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const baseOpts = {
    url: 'https://example.com/webhook',
    event: 'order.created',
    payload: { orderId: 123 },
    secret: 'test-secret',
  }

  it('returns success on 200', async () => {
    fetchMock.mockResolvedValue(makeResponse(200))

    const result = await deliverWebhook(baseOpts)

    expect(result).toEqual({ success: true, statusCode: 200, attempts: 1 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('sends correct Content-Type header', async () => {
    fetchMock.mockResolvedValue(makeResponse(200))

    await deliverWebhook(baseOpts)

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('includes X-Event-Type header', async () => {
    fetchMock.mockResolvedValue(makeResponse(200))

    await deliverWebhook(baseOpts)

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Event-Type']).toBe('order.created')
  })

  it('includes X-Signature header with correct HMAC-SHA256', async () => {
    fetchMock.mockResolvedValue(makeResponse(200))

    await deliverWebhook(baseOpts)

    const body = JSON.stringify(baseOpts.payload)
    const expectedSig = createHmac('sha256', baseOpts.secret).update(body).digest('hex')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Signature']).toBe(expectedSig)
  })

  it('sends JSON-serialized payload as body', async () => {
    fetchMock.mockResolvedValue(makeResponse(200))

    await deliverWebhook(baseOpts)

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe(JSON.stringify(baseOpts.payload))
  })

  it('POSTs to the correct URL', async () => {
    fetchMock.mockResolvedValue(makeResponse(200))

    await deliverWebhook(baseOpts)

    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/webhook')
  })

  describe('retry behavior', () => {
    it('retries on 5xx errors', async () => {
      fetchMock
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(502))
        .mockResolvedValueOnce(makeResponse(200))

      const promise = deliverWebhook({ ...baseOpts, retries: 3 })

      // Advance past first backoff (500ms)
      await vi.advanceTimersByTimeAsync(500)
      // Advance past second backoff (1000ms)
      await vi.advanceTimersByTimeAsync(1000)

      const result = await promise

      expect(result).toEqual({ success: true, statusCode: 200, attempts: 3 })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('does NOT retry on 4xx errors', async () => {
      fetchMock.mockResolvedValue(makeResponse(422))

      const result = await deliverWebhook({ ...baseOpts, retries: 3 })

      expect(result).toEqual({ success: false, statusCode: 422, attempts: 1 })
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('does NOT retry on 400', async () => {
      fetchMock.mockResolvedValue(makeResponse(400))

      const result = await deliverWebhook({ ...baseOpts, retries: 2 })

      expect(result).toEqual({ success: false, statusCode: 400, attempts: 1 })
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('retries on network errors', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce(makeResponse(200))

      const promise = deliverWebhook({ ...baseOpts, retries: 3 })

      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(1000)

      const result = await promise

      expect(result).toEqual({ success: true, statusCode: 200, attempts: 3 })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('returns failure after exhausting all retries', async () => {
      fetchMock.mockResolvedValue(makeResponse(503))

      const promise = deliverWebhook({ ...baseOpts, retries: 2 })

      // 3 total attempts: initial + 2 retries
      // Backoff: 500ms, then 1000ms
      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(1000)

      const result = await promise

      expect(result).toEqual({ success: false, statusCode: 503, attempts: 3 })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('returns null statusCode when all attempts are network errors', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))

      const promise = deliverWebhook({ ...baseOpts, retries: 1 })

      await vi.advanceTimersByTimeAsync(500)

      const result = await promise

      expect(result).toEqual({ success: false, statusCode: null, attempts: 2 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('defaults to 3 retries (4 total attempts)', async () => {
      fetchMock.mockResolvedValue(makeResponse(500))

      const promise = deliverWebhook(baseOpts)

      // 4 total attempts with backoffs: 500ms, 1000ms, 2000ms
      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)

      const result = await promise

      expect(result.attempts).toBe(4)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('returns attempt count on success after retries', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(makeResponse(200))

      const promise = deliverWebhook({ ...baseOpts, retries: 3 })

      await vi.advanceTimersByTimeAsync(500)

      const result = await promise

      expect(result.attempts).toBe(2)
      expect(result.success).toBe(true)
    })
  })

  describe('retries: 0', () => {
    it('makes exactly one attempt with retries: 0', async () => {
      fetchMock.mockResolvedValue(makeResponse(500))

      const result = await deliverWebhook({ ...baseOpts, retries: 0 })

      expect(result).toEqual({ success: false, statusCode: 500, attempts: 1 })
      expect(fetchMock).toHaveBeenCalledOnce()
    })
  })
})
