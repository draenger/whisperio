import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args)
}))

const mockNotifyInfo = vi.fn()
vi.mock('../src/main/errorHandler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/errorHandler')>()
  return {
    ...actual,
    notifyInfo: (...args: unknown[]) => mockNotifyInfo(...args),
    notifyError: vi.fn()
  }
})

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

describe('fallback auto-retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses fallback when primary fails and fallback is enabled with valid key', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      elevenlabsApiKey: 'xi-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: true
    })

    // First call (OpenAI) fails, second call (ElevenLabs) succeeds
    const failReq = createMockNetRequest(500, '{"error":"internal"}')
    const successReq = createMockNetRequest(200, JSON.stringify({ text: 'fallback result' }))
    mockNetRequest.mockReturnValueOnce(failReq).mockReturnValueOnce(successReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'test.webm')
    expect(result).toBe('fallback result')
  })

  it('throws primary error when fallback is disabled', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      elevenlabsApiKey: 'xi-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: false
    })

    const failReq = createMockNetRequest(500, '{"error":"internal"}')
    mockNetRequest.mockReturnValue(failReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'OpenAI API error 500'
    )
  })

  it('throws primary error when fallback key is empty', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      elevenlabsApiKey: '',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: true
    })

    const failReq = createMockNetRequest(500, '{"error":"internal"}')
    mockNetRequest.mockReturnValue(failReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'OpenAI API error 500'
    )
  })

  it('throws primary error when both providers fail', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      elevenlabsApiKey: 'xi-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: true
    })

    const failReq1 = createMockNetRequest(500, '{"error":"openai down"}')
    const failReq2 = createMockNetRequest(503, '{"error":"elevenlabs down"}')
    mockNetRequest.mockReturnValueOnce(failReq1).mockReturnValueOnce(failReq2)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'OpenAI API error 500'
    )
  })

  it('does not try fallback when primary succeeds', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      elevenlabsApiKey: 'xi-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: true
    })

    const successReq = createMockNetRequest(200, JSON.stringify({ text: 'primary result' }))
    mockNetRequest.mockReturnValue(successReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'test.webm')
    expect(result).toBe('primary result')
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
    expect(mockNotifyInfo).not.toHaveBeenCalled()
  })

  it('sends notification when falling back', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      elevenlabsApiKey: 'xi-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: true
    })

    const failReq = createMockNetRequest(500, '{"error":"internal"}')
    const successReq = createMockNetRequest(200, JSON.stringify({ text: 'fallback text' }))
    mockNetRequest.mockReturnValueOnce(failReq).mockReturnValueOnce(successReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')

    expect(mockNotifyInfo).toHaveBeenCalledWith(
      'Whisperio',
      'OpenAI failed. Trying ElevenLabs...'
    )
  })

  it('falls back from ElevenLabs to OpenAI (bidirectional)', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'elevenlabs',
      openaiApiKey: 'sk-test',
      elevenlabsApiKey: 'xi-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: true
    })

    const failReq = createMockNetRequest(500, '{"error":"elevenlabs down"}')
    const successReq = createMockNetRequest(200, JSON.stringify({ text: 'openai fallback' }))
    mockNetRequest.mockReturnValueOnce(failReq).mockReturnValueOnce(successReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'test.webm')
    expect(result).toBe('openai fallback')
    expect(mockNotifyInfo).toHaveBeenCalledWith(
      'Whisperio',
      'ElevenLabs failed. Trying OpenAI...'
    )
  })
})
