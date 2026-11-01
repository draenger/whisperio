import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

type Handler = (...args: unknown[]) => void

// Controllable net.request mock: tests choose how the request ends.
function createMockNetRequest(
  outcome:
    | { kind: 'response'; statusCode: number; body: string }
    | { kind: 'error'; error: Error }
    | { kind: 'redirect'; url: string }
    | { kind: 'hang' }
) {
  const requestListeners: Record<string, Handler[]> = {}
  const responseListeners: Record<string, Handler[]> = {}
  const emit = (l: Record<string, Handler[]>, e: string, ...a: unknown[]) => {
    for (const h of l[e] || []) h(...a)
  }
  const mockResponse = {
    statusCode: outcome.kind === 'response' ? outcome.statusCode : 0,
    on(event: string, handler: Handler) {
      ;(responseListeners[event] ||= []).push(handler)
    }
  }
  const mockRequest = {
    setHeader: vi.fn(),
    write: vi.fn(),
    abort: vi.fn(),
    followRedirect: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        if (outcome.kind === 'response') {
          emit(requestListeners, 'response', mockResponse)
          queueMicrotask(() => {
            emit(responseListeners, 'data', Buffer.from(outcome.body))
            emit(responseListeners, 'end')
          })
        } else if (outcome.kind === 'error') {
          emit(requestListeners, 'error', outcome.error)
        } else if (outcome.kind === 'redirect') {
          emit(requestListeners, 'redirect', 302, 'POST', outcome.url)
        }
      })
    }),
    on(event: string, handler: Handler) {
      ;(requestListeners[event] ||= []).push(handler)
      return mockRequest
    }
  }
  return mockRequest
}

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  net: { request: (...args: unknown[]) => mockNetRequest(...args) },
  app: { isPackaged: true },
  Notification: class MockNotification {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const mockHandleError = vi.fn()
vi.mock('../src/main/errorHandler', () => ({
  handleTranscriptionError: (...args: unknown[]) => mockHandleError(...args)
}))

import {
  deepgramTranscribe,
  deepgramTranscribeDiarized,
  DEFAULT_DEEPGRAM_MODEL
} from '../src/main/llm/deepgram'

const KEY = 'dg-SECRET-KEY-12345'
const okBody = (transcript: string) =>
  JSON.stringify({ results: { channels: [{ alternatives: [{ transcript }] }] } })

function lastUrl(): URL {
  const arg = mockNetRequest.mock.calls[mockNetRequest.mock.calls.length - 1][0] as { url: string }
  return new URL(arg.url)
}

describe('deepgramTranscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs to the listen endpoint with a guarded (manual) redirect policy', async () => {
    const req = createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('hi') })
    mockNetRequest.mockReturnValue(req)
    await deepgramTranscribe(KEY, Buffer.from('a'), '', 'auto')
    const opts = mockNetRequest.mock.calls[0][0]
    expect(opts.method).toBe('POST')
    expect(opts.redirect).toBe('manual')
    const u = lastUrl()
    expect(u.origin + u.pathname).toBe('https://api.deepgram.com/v1/listen')
  })

  it('sends Token auth and octet-stream content type, with raw audio as body', async () => {
    const req = createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('hi') })
    mockNetRequest.mockReturnValue(req)
    const audio = Buffer.from('raw-audio-bytes')
    await deepgramTranscribe(KEY, audio, 'nova-2', 'en')
    expect(req.setHeader).toHaveBeenCalledWith('Authorization', `Token ${KEY}`)
    expect(req.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream')
    expect(req.write).toHaveBeenCalledTimes(1)
    expect(req.write.mock.calls[0][0]).toBe(audio)
    expect(req.end).toHaveBeenCalledTimes(1)
  })

  it('puts model, smart_format and language in the query string', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('x') }))
    await deepgramTranscribe(KEY, Buffer.from('a'), 'nova-2', 'pl')
    const p = lastUrl().searchParams
    expect(p.get('model')).toBe('nova-2')
    expect(p.get('smart_format')).toBe('true')
    expect(p.get('language')).toBe('pl')
    expect(p.has('diarize')).toBe(false)
  })

  it('falls back to the default model for blank input and omits language for auto/empty', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('x') }))
    await deepgramTranscribe(KEY, Buffer.from('a'), '   ', 'auto')
    expect(lastUrl().searchParams.get('model')).toBe(DEFAULT_DEEPGRAM_MODEL)
    expect(lastUrl().searchParams.has('language')).toBe(false)

    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('x') }))
    await deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3', '')
    expect(lastUrl().searchParams.has('language')).toBe(false)
  })

  it('never puts the API key in the URL', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('x') }))
    await deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3', 'en')
    expect(mockNetRequest.mock.calls[0][0].url).not.toContain(KEY)
  })

  it('returns the first alternative transcript', async () => {
    mockNetRequest.mockReturnValue(
      createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('hello world') })
    )
    await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).resolves.toBe('hello world')
  })

  it('returns an empty string for an empty transcript (not an error)', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('') }))
    await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).resolves.toBe('')
    expect(mockHandleError).not.toHaveBeenCalled()
  })

  it.each([
    ['no channels', { results: { channels: [] } }],
    ['no results', {}],
    ['no alternatives', { results: { channels: [{ alternatives: [] }] } }]
  ])('throws "no transcript" when the response has %s', async (_n, payload) => {
    mockNetRequest.mockReturnValue(
      createMockNetRequest({ kind: 'response', statusCode: 200, body: JSON.stringify(payload) })
    )
    await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).rejects.toThrow('Deepgram returned no transcript')
    expect(mockHandleError).toHaveBeenCalledWith(expect.any(Error), 'deepgram')
  })

  it.each([401, 429, 500, 503])('maps HTTP %i to "Deepgram API error <status>" and reports it', async (status) => {
    mockNetRequest.mockReturnValue(
      createMockNetRequest({ kind: 'response', statusCode: status, body: JSON.stringify({ err_msg: 'nope' }) })
    )
    await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).rejects.toThrow(`Deepgram API error ${status}`)
    expect(mockHandleError).toHaveBeenCalledTimes(1)
    expect(mockHandleError.mock.calls[0][0].message).toBe(`Deepgram API error ${status}`)
    expect(mockHandleError.mock.calls[0][1]).toBe('deepgram')
  })

  it('rejects with a parse error on non-JSON 200 body', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: '<html>' }))
    await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).rejects.toThrow(
      'Failed to parse Deepgram response (HTTP 200)'
    )
  })

  it('propagates network errors and reports them', async () => {
    const netErr = new Error('net::ERR_CONNECTION_REFUSED')
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'error', error: netErr }))
    await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).rejects.toBe(netErr)
    expect(mockHandleError).toHaveBeenCalledWith(netErr, 'deepgram')
  })

  describe('redirect guard', () => {
    it('blocks a cross-host redirect: aborts, rejects, never follows', async () => {
      const req = createMockNetRequest({ kind: 'redirect', url: 'https://evil.example.org/steal' })
      mockNetRequest.mockReturnValue(req)
      await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).rejects.toThrow(/Blocked redirect.*different host/)
      expect(req.abort).toHaveBeenCalledTimes(1)
      expect(req.followRedirect).not.toHaveBeenCalled()
      expect(mockHandleError).toHaveBeenCalledWith(expect.any(Error), 'deepgram')
    })

    it('blocks an https -> http downgrade', async () => {
      const req = createMockNetRequest({ kind: 'redirect', url: 'http://api.deepgram.com/v1/listen' })
      mockNetRequest.mockReturnValue(req)
      await expect(deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')).rejects.toThrow(/Blocked redirect/)
      expect(req.followRedirect).not.toHaveBeenCalled()
    })

    it('follows a same-host https redirect', async () => {
      const req = createMockNetRequest({ kind: 'redirect', url: 'https://api.deepgram.com/v1/listen?x=1' })
      mockNetRequest.mockReturnValue(req)
      // Never settles on its own after a followed redirect; just let the tick run.
      const p = deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')
      p.catch(() => {})
      await new Promise((r) => setTimeout(r, 0))
      expect(req.followRedirect).toHaveBeenCalledTimes(1)
      expect(req.abort).not.toHaveBeenCalled()
    })
  })

  describe('request timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('aborts and rejects after 45s with no response', async () => {
      const req = createMockNetRequest({ kind: 'hang' })
      mockNetRequest.mockReturnValue(req)
      const p = deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3')
      const assertion = expect(p).rejects.toThrow('Deepgram transcription request timed out after 45s')
      await vi.advanceTimersByTimeAsync(44_999)
      expect(req.abort).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2)
      await assertion
      expect(req.abort).toHaveBeenCalledTimes(1)
    })
  })

  describe('secret hygiene', () => {
    it('keeps the API key out of every error message and log', async () => {
      const logs: string[] = []
      const spies = (['log', 'error', 'warn', 'info'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
          logs.push(a.map(String).join(' '))
        })
      )
      const cases = [
        createMockNetRequest({ kind: 'response', statusCode: 401, body: '{"err":"bad"}' }),
        createMockNetRequest({ kind: 'response', statusCode: 500, body: 'oops' }),
        createMockNetRequest({ kind: 'response', statusCode: 200, body: 'garbage' }),
        createMockNetRequest({ kind: 'response', statusCode: 200, body: '{}' }),
        createMockNetRequest({ kind: 'error', error: new Error('socket hang up') }),
        createMockNetRequest({ kind: 'redirect', url: 'https://evil.example.org/' })
      ]
      const messages: string[] = []
      for (const c of cases) {
        mockNetRequest.mockReturnValue(c)
        try {
          await deepgramTranscribe(KEY, Buffer.from('a'), 'nova-3', 'en')
        } catch (e) {
          messages.push((e as Error).message)
        }
      }
      spies.forEach((s) => s.mockRestore())
      expect(messages).toHaveLength(cases.length)
      for (const m of messages) expect(m).not.toContain(KEY)
      for (const call of mockHandleError.mock.calls) expect((call[0] as Error).message).not.toContain(KEY)
      for (const l of logs) expect(l).not.toContain(KEY)
    })
  })
})

describe('deepgramTranscribeDiarized', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests diarize + utterances in addition to the base params', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: '{}' }))
    await deepgramTranscribeDiarized(KEY, Buffer.from('a'), 'nova-2', 'de')
    const p = lastUrl().searchParams
    expect(p.get('diarize')).toBe('true')
    expect(p.get('utterances')).toBe('true')
    expect(p.get('model')).toBe('nova-2')
    expect(p.get('language')).toBe('de')
    expect(p.get('smart_format')).toBe('true')
  })

  it('maps utterances to speaker segments and joins their text', async () => {
    const body = JSON.stringify({
      results: {
        channels: [{ alternatives: [{ transcript: 'fallback' }] }],
        utterances: [
          { speaker: 0, transcript: ' Hello ', start: 0, end: 1.5 },
          { speaker: 1, transcript: '   ', start: 1.5, end: 2 },
          { speaker: 1, transcript: 'Hi there', start: 2, end: 3 }
        ]
      }
    })
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body }))
    const r = await deepgramTranscribeDiarized(KEY, Buffer.from('a'), 'nova-3')
    expect(r.segments).toEqual([
      { speaker: 'speaker_0', start: 0, end: 1.5, text: 'Hello' },
      { speaker: 'speaker_1', start: 2, end: 3, text: 'Hi there' }
    ])
    expect(r.text).toBe('Hello Hi there')
  })

  it('falls back to the plain transcript when utterances are empty or missing', async () => {
    mockNetRequest.mockReturnValue(
      createMockNetRequest({ kind: 'response', statusCode: 200, body: okBody('plain text') })
    )
    await expect(deepgramTranscribeDiarized(KEY, Buffer.from('a'), 'nova-3')).resolves.toEqual({
      segments: [],
      text: 'plain text'
    })
  })

  it('returns empty text and segments for an empty response', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 200, body: '{}' }))
    await expect(deepgramTranscribeDiarized(KEY, Buffer.from('a'), 'nova-3')).resolves.toEqual({
      segments: [],
      text: ''
    })
  })

  it('maps HTTP errors and network errors like the plain variant', async () => {
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'response', statusCode: 429, body: 'slow down' }))
    await expect(deepgramTranscribeDiarized(KEY, Buffer.from('a'), 'nova-3')).rejects.toThrow('Deepgram API error 429')
    const e = new Error('ENOTFOUND')
    mockNetRequest.mockReturnValue(createMockNetRequest({ kind: 'error', error: e }))
    await expect(deepgramTranscribeDiarized(KEY, Buffer.from('a'), 'nova-3')).rejects.toBe(e)
  })
})
