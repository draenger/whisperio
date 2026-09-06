import { vi, describe, it, expect, beforeEach } from 'vitest'

// Helper: create a mock net.request that resolves with given status + body
// (mirrors tests/transcribe.test.ts's createMockNetRequest)
function createMockNetRequest(statusCode: number, body: string) {
  const requestListeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  const responseListeners: Record<string, ((...args: unknown[]) => void)[]> = {}

  const mockResponse = {
    statusCode,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!responseListeners[event]) responseListeners[event] = []
      responseListeners[event].push(handler)
    }
  }

  const mockRequest = {
    setHeader: vi.fn(),
    write: vi.fn(),
    abort: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        for (const h of requestListeners['response'] || []) h(mockResponse)
        queueMicrotask(() => {
          for (const h of responseListeners['data'] || []) h(Buffer.from(body))
          for (const h of responseListeners['end'] || []) h()
        })
      })
    }),
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!requestListeners[event]) requestListeners[event] = []
      requestListeners[event].push(handler)
      return mockRequest
    }
  }

  return mockRequest
}

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  net: {
    request: (...args: unknown[]) => mockNetRequest(...args)
  },
  app: {
    isPackaged: false
  },
  Notification: class MockNotification {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

import { mistralTranscribe, DEFAULT_MISTRAL_MODEL } from '../src/main/llm/mistral'

describe('mistralTranscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts to the Mistral audio/transcriptions endpoint', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await mistralTranscribe('mk-test', Buffer.from('audio-data'), 'recording.webm', '', '', 'auto')

    expect(mockNetRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://api.mistral.ai/v1/audio/transcriptions'
    })
  })

  it('builds multipart body with file, model, prompt, and language', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await mistralTranscribe(
      'mk-test',
      Buffer.from('audio-data'),
      'recording.webm',
      'My prompt',
      'voxtral-mini-latest',
      'en'
    )

    const writtenBody = mockReq.write.mock.calls[0][0] as Buffer
    const bodyStr = writtenBody.toString()
    expect(bodyStr).toContain('name="file"')
    expect(bodyStr).toContain('filename="recording.webm"')
    expect(bodyStr).toContain('Content-Type: audio/webm')
    expect(bodyStr).toContain('name="model"')
    expect(bodyStr).toContain('voxtral-mini-latest')
    expect(bodyStr).toContain('name="prompt"')
    expect(bodyStr).toContain('My prompt')
    expect(bodyStr).toContain('name="language"')
    expect(bodyStr).toContain('en')
  })

  it('falls back to the default model when none is given', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await mistralTranscribe('mk-test', Buffer.from('audio'), 'a.webm', '', '  ', 'auto')

    const writtenBody = mockReq.write.mock.calls[0][0] as Buffer
    expect(writtenBody.toString()).toContain(DEFAULT_MISTRAL_MODEL)
  })

  it('omits prompt and language fields when not provided', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hi' }))
    mockNetRequest.mockReturnValue(mockReq)

    await mistralTranscribe('mk-test', Buffer.from('audio'), 'a.webm', '', '', 'auto')

    const writtenBody = mockReq.write.mock.calls[0][0] as Buffer
    const bodyStr = writtenBody.toString()
    expect(bodyStr).not.toContain('name="prompt"')
    expect(bodyStr).not.toContain('name="language"')
  })

  it('sets the Authorization header with the given API key', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hi' }))
    mockNetRequest.mockReturnValue(mockReq)

    await mistralTranscribe('mk-mykey', Buffer.from('audio'), 'a.webm', '', '', 'auto')
    expect(mockReq.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer mk-mykey')
    expect(mockReq.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringContaining('multipart/form-data; boundary=')
    )
  })

  it('rejects with an auth error when the key is missing/invalid (401)', async () => {
    const mockReq = createMockNetRequest(401, '{"error":"unauthorized"}')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(
      mistralTranscribe('', Buffer.from('audio'), 'a.webm', '', '', 'auto')
    ).rejects.toThrow('Mistral API error 401')
  })

  it('rejects on non-200 status codes', async () => {
    const mockReq = createMockNetRequest(500, 'server error')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(
      mistralTranscribe('mk-test', Buffer.from('audio'), 'a.webm', '', '', 'auto')
    ).rejects.toThrow('Mistral API error 500')
  })

  it('rejects on unparseable JSON response', async () => {
    const mockReq = createMockNetRequest(200, 'not-json')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(
      mistralTranscribe('mk-test', Buffer.from('audio'), 'a.webm', '', '', 'auto')
    ).rejects.toThrow('Failed to parse transcription response')
  })

  it('resolves with the transcribed text on success', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'transcribed text' }))
    mockNetRequest.mockReturnValue(mockReq)

    const result = await mistralTranscribe('mk-test', Buffer.from('audio'), 'a.webm', '', '', 'auto')
    expect(result).toBe('transcribed text')
  })

  it('rejects when the request itself errors', async () => {
    const onCalls: Record<string, ((...a: unknown[]) => void)[]> = {}
    const req = {
      setHeader: vi.fn(),
      write: vi.fn(),
      abort: vi.fn(),
      end: vi.fn(),
      on(event: string, handler: (...a: unknown[]) => void) {
        if (!onCalls[event]) onCalls[event] = []
        onCalls[event].push(handler)
        return req
      }
    }
    mockNetRequest.mockReturnValue(req)

    const promise = mistralTranscribe('mk-test', Buffer.from('audio'), 'a.webm', '', '', 'auto')
    queueMicrotask(() => {
      for (const h of onCalls['error'] || []) h(new Error('socket hang up'))
    })
    await expect(promise).rejects.toThrow('socket hang up')
  })
})

// Regression test for the "Multipart Content-Disposition fields built from
// unsanitized filename/prompt/vocab strings" finding (mirrors the equivalent
// describe block in tests/transcribe.test.ts): `filename` arrives straight
// from the renderer over the `dictation:transcribe` IPC handler with no
// validation, and prompt/language are similarly untrusted — a `"` or a raw
// CR/LF in any of them used to break out of the intended header/field and
// inject extra headers or multipart parts into the outbound request.
describe('multipart field sanitization (header/body injection fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('escapes a double-quote and strips CR/LF from filename so it cannot break out of the Content-Disposition header or inject extra parts', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    const maliciousFilename =
      'evil".webm"\r\nContent-Disposition: form-data; name="hacked"\r\n\r\ninjected-value\r\n--injected-boundary--'

    await mistralTranscribe('mk-test', Buffer.from('audio'), maliciousFilename, '', '', 'auto')

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).not.toContain('\r\nContent-Disposition: form-data; name="hacked"')
    expect(bodyStr).not.toContain('name="hacked"')
    expect(bodyStr).toContain('evil\\".webm\\"')
  })

  it('strips CR/LF from a CR/LF-laden prompt and language before they reach the multipart body', async () => {
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    const maliciousPrompt = 'term\r\nContent-Disposition: form-data; name="hacked"\r\n\r\ninjected'
    const maliciousLanguage = 'en\r\nContent-Disposition: form-data; name="hacked2"\r\n\r\ninjected2'

    await mistralTranscribe('mk-test', Buffer.from('audio'), 'rec.webm', maliciousPrompt, '', maliciousLanguage)

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).not.toContain('\r\nContent-Disposition: form-data; name="hacked"')
    expect(bodyStr).not.toContain('\r\nContent-Disposition: form-data; name="hacked2"')
  })
})
