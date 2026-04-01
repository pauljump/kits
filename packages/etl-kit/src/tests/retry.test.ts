import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithRetry } from '../retry.js'

describe('fetchWithRetry', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function okResponse(body: unknown = { ok: true }) {
    return new Response(JSON.stringify(body), { status: 200, statusText: 'OK' })
  }

  function errorResponse(status = 500) {
    return new Response('Server Error', { status, statusText: 'Internal Server Error' })
  }

  it('returns response on success', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ data: 'hello' }))

    const resp = await fetchWithRetry('https://example.com/api')
    expect(resp.ok).toBe(true)

    const json = await resp.json()
    expect(json).toEqual({ data: 'hello' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries on failure then succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(okResponse())

    const resp = await fetchWithRetry('https://example.com/api', {
      retries: 2,
      backoffMs: 10,
    })

    expect(resp.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on non-ok HTTP status', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse())

    const resp = await fetchWithRetry('https://example.com/api', {
      retries: 2,
      backoffMs: 10,
    })

    expect(resp.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('respects retry count — stops after retries + 1 attempts', async () => {
    mockFetch.mockRejectedValue(new Error('Always fails'))

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 2, backoffMs: 10 })
    ).rejects.toThrow('Always fails')

    // 1 initial + 2 retries = 3 total attempts
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('throws after all retries exhausted', async () => {
    mockFetch.mockRejectedValue(new Error('Persistent failure'))

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 0, backoffMs: 10 })
    ).rejects.toThrow('Persistent failure')

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws the last error message when all retries fail', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('First error'))
      .mockRejectedValueOnce(new Error('Second error'))
      .mockRejectedValueOnce(new Error('Third error'))

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 2, backoffMs: 10 })
    ).rejects.toThrow('Third error')
  })

  it('POST requests with object body include Content-Type header', async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await fetchWithRetry('https://example.com/api', {
      method: 'POST',
      body: { key: 'value' },
      retries: 0,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('object body is JSON.stringified', async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    const bodyObj = { name: 'test', count: 42 }
    await fetchWithRetry('https://example.com/api', {
      method: 'POST',
      body: bodyObj,
      retries: 0,
    })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.body).toBe(JSON.stringify(bodyObj))
  })

  it('string body is passed through without Content-Type', async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await fetchWithRetry('https://example.com/api', {
      method: 'POST',
      body: 'raw-string-body',
      retries: 0,
    })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.body).toBe('raw-string-body')
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('custom headers are forwarded', async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await fetchWithRetry('https://example.com/api', {
      headers: { Authorization: 'Bearer abc123' },
      retries: 0,
    })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['Authorization']).toBe('Bearer abc123')
  })

  it('uses GET method by default', async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await fetchWithRetry('https://example.com/api', { retries: 0 })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.method).toBe('GET')
  })

  it('passes an AbortSignal for timeout', async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await fetchWithRetry('https://example.com/api', {
      timeoutMs: 5000,
      retries: 0,
    })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
