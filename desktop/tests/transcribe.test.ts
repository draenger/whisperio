import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args)
}))

// Helper: create a mock net.request that resolves with given status + body
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
  Notification: class MockNotification {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

import { transcribeAudio } from '../src/main/transcribe'

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when API key is empty', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: '', transcriptionPrompt: '' })
    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'No OpenAI API key configured'
    )
  })

  it('builds correct multipart form data with file, model, and prompt', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: 'My prompt' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio-data'), 'recording.webm')

    const writtenBody = mockReq.write.mock.calls[0][0] as Buffer
    const bodyStr = writtenBody.toString()
    expect(bodyStr).toContain('name="file"')
    expect(bodyStr).toContain('filename="recording.webm"')
    expect(bodyStr).toContain('name="model"')
    expect(bodyStr).toContain('gpt-4o-transcribe')
    expect(bodyStr).toContain('name="prompt"')
    expect(bodyStr).toContain('My prompt')
  })

  it('sets Authorization header with Bearer token', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-mykey', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hi' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')
    expect(mockReq.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer sk-mykey')
  })

  it('throws on non-200 status code', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(401, '{"error":"unauthorized"}')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'OpenAI API error 401'
    )
  })

  it('throws on unparseable JSON response', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, 'not-json')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'Failed to parse response'
    )
  })

  it('returns text from valid response', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'Hello world' }))
    mockNetRequest.mockReturnValue(mockReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'test.webm')
    expect(result).toBe('Hello world')
  })

  it('sends no prompt when transcriptionPrompt is empty', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).not.toContain('name="prompt"')
  })

  it('throws when ElevenLabs API key is empty', async () => {
    mockLoadSettings.mockReturnValue({ sttProvider: 'elevenlabs', elevenlabsApiKey: '' })
    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'No ElevenLabs API key configured'
    )
  })

  it('calls ElevenLabs API with correct URL, headers, and body when provider is elevenlabs', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'elevenlabs',
      elevenlabsApiKey: 'xi-test-key',
      customVocabulary: 'git, GitHub, Docker'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'transcribed text' }))
    mockNetRequest.mockReturnValue(mockReq)

    const result = await transcribeAudio(Buffer.from('audio-data'), 'recording.webm')

    expect(result).toBe('transcribed text')
    expect(mockNetRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://api.elevenlabs.io/v1/speech-to-text'
    })
    expect(mockReq.setHeader).toHaveBeenCalledWith('xi-api-key', 'xi-test-key')

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).toContain('name="file"')
    expect(bodyStr).toContain('filename="recording.webm"')
    expect(bodyStr).toContain('name="model_id"')
    expect(bodyStr).toContain('scribe_v2')
    expect(bodyStr.match(/name="keyterms"/g)?.length).toBe(3)
    expect(bodyStr).toContain('git')
    expect(bodyStr).toContain('GitHub')
    expect(bodyStr).toContain('Docker')
  })

  it('throws on non-200 ElevenLabs response', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'elevenlabs',
      elevenlabsApiKey: 'xi-test-key',
      customVocabulary: ''
    })
    const mockReq = createMockNetRequest(403, '{"error":"forbidden"}')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'ElevenLabs API error 403'
    )
  })
})
