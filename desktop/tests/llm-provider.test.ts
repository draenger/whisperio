import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  OpenAICompatibleProvider,
  AnthropicProvider,
  isLocalHost,
  selectProvider,
  type LLMProvider,
  type Clock
} from '../src/main/llm/provider'

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

describe('isLocalHost', () => {
  const cases: [string, boolean][] = [
    ['localhost', true],
    ['127.0.0.1', true],
    ['127.255.1.2', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['[::1]', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['192.168.1.1', true],
    ['192.168.0.254', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['myserver.local', true],
    ['172.15.255.255', false],
    ['172.32.0.1', false],
    ['192.169.1.1', false],
    ['9.9.9.9', false],
    ['api.openai.com', false],
    ['api.anthropic.com', false],
    ['8.8.8.8', false],
    ['example.com', false]
  ]

  it.each(cases)('classifies %s as local=%s', (host, expected) => {
    expect(isLocalHost(host)).toBe(expected)
  })
})

describe('OpenAICompatibleProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies loopback baseUrl as local and hosted baseUrl as remote', () => {
    const local = new OpenAICompatibleProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'llama3' })
    const remote = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })
    expect(local.isLocal).toBe(true)
    expect(remote.isLocal).toBe(false)
  })

  it('posts to {baseUrl}/v1/chat/completions with Bearer auth when apiKey is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'cleaned text' } }] }))

    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    })

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
      maxTokens: 500
    })

    expect(result).toBe('cleaned text')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
      max_tokens: 500
    })
  })

  it('strips a trailing slash from baseUrl and does not send Authorization when no apiKey (local server)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))

    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/',
      model: 'llama3'
    })

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('omits temperature/maxTokens from the body when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] })
  })

  it('passes the AbortSignal through to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })
    const controller = new AbortController()

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('propagates abort as a rejection when the signal fires', async () => {
    const abortError = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValue(abortError)
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toBe(abortError)
  })

  it('throws on non-OK HTTP response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 401))
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('HTTP 401')
  })

  it('throws when the response has no message content', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }))
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      'no content'
    )
  })

  describe('HTTPS enforcement', () => {
    it('rejects an http:// baseUrl on a public host', () => {
      expect(
        () => new OpenAICompatibleProvider({ baseUrl: 'http://api.example.com', model: 'gpt-4o-mini' })
      ).toThrow(/https/i)
    })

    it('allows http:// on a loopback host', () => {
      expect(
        () => new OpenAICompatibleProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'llama3' })
      ).not.toThrow()
    })

    it('allows http:// on a private LAN host', () => {
      expect(
        () => new OpenAICompatibleProvider({ baseUrl: 'http://192.168.1.50:11434', model: 'llama3' })
      ).not.toThrow()
    })

    it('allows a public https:// baseUrl', () => {
      expect(
        () => new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })
      ).not.toThrow()
    })
  })

  describe('usage passthrough', () => {
    it('calls onUsage with prompt/completion tokens when the response includes usage', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 12, completion_tokens: 34 }
        })
      )
      const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })
      const onUsage = vi.fn()

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }], onUsage })

      expect(onUsage).toHaveBeenCalledWith({
        provider: 'openai-compatible',
        promptTokens: 12,
        completionTokens: 34
      })
    })

    it('does not call onUsage when the response has no usage field', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
      const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' })
      const onUsage = vi.fn()

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }], onUsage })

      expect(onUsage).not.toHaveBeenCalled()
    })
  })

  describe('available() caching', () => {
    it('caches the result for ~30s using an injected clock, then re-checks', async () => {
      const clock = makeClock(0)
      fetchMock.mockResolvedValue(jsonResponse({}))
      const provider = new OpenAICompatibleProvider({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3',
        clock
      })

      expect(await provider.available()).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/models')

      clock.advance(10_000)
      expect(await provider.available()).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1) // still cached

      clock.advance(21_000) // total 31s since first check
      expect(await provider.available()).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2) // cache expired, re-checked
    })

    it('returns false and caches false when the reachability check throws (offline)', async () => {
      const clock = makeClock(0)
      fetchMock.mockRejectedValue(new Error('network down'))
      const provider = new OpenAICompatibleProvider({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3',
        clock
      })

      expect(await provider.available()).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      clock.advance(1_000)
      expect(await provider.available()).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns false when the reachability response is non-OK', async () => {
      const clock = makeClock(0)
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500))
      const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini', clock })

      expect(await provider.available()).toBe(false)
    })
  })
})

describe('AnthropicProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is never local', () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })
    expect(provider.isLocal).toBe(false)
  })

  it('posts to /v1/messages with x-api-key + anthropic-version, moving system into the system field', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'cleaned' }] }))

    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet' })
    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hello' }
      ],
      temperature: 0.1,
      maxTokens: 300
    })

    expect(result).toBe('cleaned')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-ant-test')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    expect(init.headers.Authorization).toBeUndefined()

    const body = JSON.parse(init.body)
    expect(body).toEqual({
      model: 'claude-3-5-sonnet',
      max_tokens: 300,
      temperature: 0.1,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }]
    })
  })

  it('defaults max_tokens when not provided and omits system when there is none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }))
    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(1024)
    expect(body.system).toBeUndefined()
  })

  it('joins multiple text content blocks', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ content: [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'part two' }] })
    )
    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toBe('part one part two')
  })

  it('passes the AbortSignal through to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }))
    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })
    const controller = new AbortController()

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('throws on non-OK HTTP response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 429))
    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('HTTP 429')
  })

  it('throws when no content blocks are returned', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [] }))
    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      'no content'
    )
  })

  it('caches available() using the injected clock', async () => {
    const clock = makeClock(0)
    fetchMock.mockResolvedValue(jsonResponse({}))
    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet', clock })

    expect(await provider.available()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clock.advance(29_000)
    expect(await provider.available()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clock.advance(2_000) // total 31s
    expect(await provider.available()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  describe('HTTPS enforcement', () => {
    it('rejects an http:// baseUrl override on a public host', () => {
      expect(
        () =>
          new AnthropicProvider({
            apiKey: 'sk-ant',
            model: 'claude-haiku-4-5',
            baseUrl: 'http://api.anthropic.com'
          })
      ).toThrow(/https/i)
    })

    it('allows an http:// baseUrl override on a loopback host', () => {
      expect(
        () =>
          new AnthropicProvider({
            apiKey: 'sk-ant',
            model: 'claude-haiku-4-5',
            baseUrl: 'http://127.0.0.1:4010'
          })
      ).not.toThrow()
    })

    it('allows the default (https) baseUrl', () => {
      expect(() => new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-haiku-4-5' })).not.toThrow()
    })
  })

  describe('usage passthrough', () => {
    it('calls onUsage with input/output tokens when the response includes usage', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          content: [{ type: 'text', text: 'cleaned' }],
          usage: { input_tokens: 20, output_tokens: 40 }
        })
      )
      const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })
      const onUsage = vi.fn()

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }], onUsage })

      expect(onUsage).toHaveBeenCalledWith({ provider: 'anthropic', promptTokens: 20, completionTokens: 40 })
    })

    it('does not call onUsage when the response has no usage field', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }))
      const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })
      const onUsage = vi.fn()

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }], onUsage })

      expect(onUsage).not.toHaveBeenCalled()
    })
  })
})

describe('selectProvider', () => {
  function fakeProvider(id: string, isLocal: boolean, available: boolean): LLMProvider {
    return {
      id,
      isLocal,
      complete: vi.fn(),
      available: vi.fn().mockResolvedValue(available)
    }
  }

  it('returns null when there are no candidates', async () => {
    expect(await selectProvider({}, [])).toBeNull()
  })

  it('picks the candidate matching aiProvider when it is available', async () => {
    const openai = fakeProvider('openai', false, true)
    const local = fakeProvider('local', true, true)

    const result = await selectProvider({ aiProvider: 'openai' }, [openai, local])
    expect(result).toBe(openai)
  })

  it('defaults to the first candidate when aiProvider is unset', async () => {
    const first = fakeProvider('openai', false, true)
    const second = fakeProvider('local', true, true)

    const result = await selectProvider({}, [first, second])
    expect(result).toBe(first)
  })

  it('falls back to a local candidate when the selected one is unavailable', async () => {
    const anthropic = fakeProvider('anthropic', false, false)
    const local = fakeProvider('ollama', true, true)

    const result = await selectProvider({ aiProvider: 'anthropic' }, [anthropic, local])
    expect(result).toBe(local)
  })

  it('returns null when the selected provider is unavailable and there is no local candidate', async () => {
    const openai = fakeProvider('openai', false, false)
    const anthropic = fakeProvider('anthropic', false, false)

    const result = await selectProvider({ aiProvider: 'openai' }, [openai, anthropic])
    expect(result).toBeNull()
  })

  it('falls back to local when aiProvider does not match any candidate', async () => {
    const openai = fakeProvider('openai', false, true)
    const local = fakeProvider('ollama', true, true)

    const result = await selectProvider({ aiProvider: 'unknown-id' }, [openai, local])
    expect(result).toBe(local)
  })
})
