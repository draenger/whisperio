import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ReplicateProvider, type Clock } from '../src/main/llm/provider'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response
}

function makeClock(startMs: number): Clock & { advance(ms: number): void } {
  let now = startMs
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    }
  }
}

describe('ReplicateProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is never local and defaults id to "replicate"', () => {
    const provider = new ReplicateProvider({
      apiKey: 'r8-test',
      model: 'meta/meta-llama-3-8b-instruct'
    })
    expect(provider.isLocal).toBe(false)
    expect(provider.id).toBe('replicate')
  })

  it('posts to {baseUrl}/v1/models/{owner}/{name}/predictions with Bearer auth and Prefer: wait', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['cleaned', ' text'], status: 'succeeded' }))

    const provider = new ReplicateProvider({
      apiKey: 'r8-test-key',
      model: 'meta/meta-llama-3-8b-instruct'
    })

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }]
    })

    expect(result).toBe('cleaned text')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.replicate.com/v1/models/meta/meta-llama-3-8b-instruct/predictions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer r8-test-key')
    expect(init.headers.Prefer).toBe('wait=60')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('maps messages -> input.prompt / input.system_prompt (system joined separately from the rest)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'] }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await provider.complete({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'part one' },
        { role: 'assistant', content: 'part two' }
      ]
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.input.system_prompt).toBe('You are helpful.')
    expect(body.input.prompt).toBe('part one\n\npart two')
  })

  it('omits system_prompt when there is no system message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'] }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.input.system_prompt).toBeUndefined()
    expect(body.input.prompt).toBe('hi')
  })

  it('passes temperature and maxTokens through as input.temperature/input.max_tokens when provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'] }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      maxTokens: 400
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.input.temperature).toBe(0.3)
    expect(body.input.max_tokens).toBe(400)
  })

  it('omits temperature/max_tokens from input when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'] }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.input.temperature).toBeUndefined()
    expect(body.input.max_tokens).toBeUndefined()
  })

  it('joins an output array of strings', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['Hel', 'lo', ' world'] }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toBe('Hello world')
  })

  it('accepts a plain string output too', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: 'already a string' }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toBe('already a string')
  })

  it('respects a custom waitSeconds', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'] }))
    const provider = new ReplicateProvider({
      apiKey: 'r8',
      model: 'meta/meta-llama-3-8b-instruct',
      waitSeconds: 30
    })

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toBe('wait=30')
  })

  it('passes the AbortSignal through to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'] }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })
    const controller = new AbortController()

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('propagates abort as a rejection when the signal fires', async () => {
    const abortError = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValue(abortError)
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toBe(abortError)
  })

  it('throws on non-OK HTTP response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 401))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      'HTTP 401'
    )
  })

  it('throws with the API error message when the prediction body reports an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'model overloaded', status: 'failed' }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      'model overloaded'
    )
  })

  it('throws when there is no output', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: [], status: 'succeeded' }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      'no output'
    )
  })

  it('reports predict_time via onUsage when present', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'], metrics: { predict_time: 1.23 } }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })
    const onUsage = vi.fn()

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }], onUsage })

    expect(onUsage).toHaveBeenCalledWith({ provider: 'replicate', predictTimeSeconds: 1.23 })
  })

  it('does not call onUsage when metrics are absent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: ['ok'] }))
    const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })
    const onUsage = vi.fn()

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }], onUsage })

    expect(onUsage).not.toHaveBeenCalled()
  })

  describe('HTTPS enforcement', () => {
    it('rejects an http:// baseUrl on a public host', () => {
      expect(
        () =>
          new ReplicateProvider({
            apiKey: 'r8',
            model: 'meta/meta-llama-3-8b-instruct',
            baseUrl: 'http://api.replicate.com'
          })
      ).toThrow(/https/i)
    })

    it('allows http:// on a loopback host (e.g. a test proxy)', () => {
      expect(
        () =>
          new ReplicateProvider({
            apiKey: 'r8',
            model: 'meta/meta-llama-3-8b-instruct',
            baseUrl: 'http://127.0.0.1:4000'
          })
      ).not.toThrow()
    })

    it('allows the default https baseUrl', () => {
      expect(
        () => new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })
      ).not.toThrow()
    })
  })

  describe('available() caching', () => {
    it('GETs {baseUrl}/v1/account with Bearer auth and caches via the injected clock', async () => {
      const clock = makeClock(0)
      fetchMock.mockResolvedValue(jsonResponse({}))
      const provider = new ReplicateProvider({
        apiKey: 'r8-test',
        model: 'meta/meta-llama-3-8b-instruct',
        clock
      })

      expect(await provider.available()).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.replicate.com/v1/account')
      expect(init.headers.Authorization).toBe('Bearer r8-test')

      clock.advance(10_000)
      expect(await provider.available()).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1) // still cached

      clock.advance(21_000) // total 31s
      expect(await provider.available()).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2) // cache expired
    })

    it('returns false when the reachability check throws (offline)', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))
      const provider = new ReplicateProvider({ apiKey: 'r8', model: 'meta/meta-llama-3-8b-instruct' })

      expect(await provider.available()).toBe(false)
    })
  })
})
