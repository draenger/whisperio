import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  getActiveVocabulary: (settings: { customVocabulary?: string }) =>
    settings.customVocabulary?.trim() || ''
}))

// Helper: create a mock net.request that resolves with given status + body
// (same shape as tests/transcribe.test.ts's helper).
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
  },
  app: {
    isPackaged: false
  }
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  transcribeConversation,
  getConfiguredDiarizingProvider
} from '../src/main/transcribe'

describe('getConfiguredDiarizingProvider', () => {
  it('returns null when no diarizing provider is configured', () => {
    expect(getConfiguredDiarizingProvider({} as never)).toBeNull()
  })

  it('prefers ElevenLabs over Deepgram and AssemblyAI', () => {
    expect(
      getConfiguredDiarizingProvider({
        elevenlabsApiKey: 'e',
        deepgramApiKey: 'd',
        assemblyaiApiKey: 'a'
      } as never)
    ).toBe('elevenlabs')
  })

  it('falls back to Deepgram when ElevenLabs is not configured', () => {
    expect(
      getConfiguredDiarizingProvider({ deepgramApiKey: 'd', assemblyaiApiKey: 'a' } as never)
    ).toBe('deepgram')
  })

  it('falls back to AssemblyAI when only it is configured', () => {
    expect(getConfiguredDiarizingProvider({ assemblyaiApiKey: 'a' } as never)).toBe('assemblyai')
  })
})

describe('transcribeConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws a "add a key" error when no diarizing provider is configured', async () => {
    mockLoadSettings.mockReturnValue({})
    await expect(transcribeConversation(Buffer.from('audio'), 'clip.webm')).rejects.toThrow(
      'Add an ElevenLabs, Deepgram or AssemblyAI key'
    )
  })

  it('maps ElevenLabs words into speaker segments when configured', async () => {
    mockLoadSettings.mockReturnValue({ elevenlabsApiKey: 'el-key', transcriptionLanguage: 'auto' })
    const body = JSON.stringify({
      text: 'Hi there',
      words: [
        { text: 'Hi', start: 0, end: 0.4, type: 'word', speaker_id: 'speaker_0' },
        { text: ' there', start: 0.4, end: 0.9, type: 'word', speaker_id: 'speaker_0' }
      ]
    })
    mockNetRequest.mockReturnValue(createMockNetRequest(200, body))

    const result = await transcribeConversation(Buffer.from('audio'), 'clip.webm')
    expect(result.segments).toEqual([{ speaker: 'speaker_0', start: 0, end: 0.9, text: 'Hi there' }])
    expect(result.text).toBe('Hi there')
  })

  it('maps Deepgram utterances into speaker segments when ElevenLabs is not configured', async () => {
    mockLoadSettings.mockReturnValue({ deepgramApiKey: 'dg-key', transcriptionLanguage: 'auto' })
    const body = JSON.stringify({
      results: {
        channels: [{ alternatives: [{ transcript: 'fallback' }] }],
        utterances: [{ speaker: 0, transcript: 'Hello world', start: 0, end: 1.2 }]
      }
    })
    mockNetRequest.mockReturnValue(createMockNetRequest(200, body))

    const result = await transcribeConversation(Buffer.from('audio'), 'clip.webm')
    expect(result.segments).toEqual([{ speaker: 'speaker_0', start: 0, end: 1.2, text: 'Hello world' }])
    expect(result.text).toBe('Hello world')
  })

  it('maps AssemblyAI utterances into speaker segments when only it is configured', async () => {
    mockLoadSettings.mockReturnValue({ assemblyaiApiKey: 'aai-key', transcriptionLanguage: 'auto' })
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ upload_url: 'https://x/upload' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: 'job-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: 'completed',
            text: 'Hi Anna',
            utterances: [{ speaker: 'A', text: 'Hi Anna', start: 0, end: 1000 }]
          })
      })

    const result = await transcribeConversation(Buffer.from('audio'), 'clip.webm')
    expect(result.segments).toEqual([{ speaker: 'speaker_a', start: 0, end: 1, text: 'Hi Anna' }])
    expect(result.text).toBe('Hi Anna')
  }, 10_000)

  it('falls back to the plain transcript when ElevenLabs returns no diarized words', async () => {
    mockLoadSettings.mockReturnValue({ elevenlabsApiKey: 'el-key', transcriptionLanguage: 'auto' })
    mockNetRequest.mockReturnValue(createMockNetRequest(200, JSON.stringify({ text: 'plain text' })))

    const result = await transcribeConversation(Buffer.from('audio'), 'clip.webm')
    expect(result.segments).toEqual([])
    expect(result.text).toBe('plain text')
  })

  it('propagates an ElevenLabs API error', async () => {
    mockLoadSettings.mockReturnValue({ elevenlabsApiKey: 'el-key', transcriptionLanguage: 'auto' })
    mockNetRequest.mockReturnValue(createMockNetRequest(401, '{"error":"unauthorized"}'))

    await expect(transcribeConversation(Buffer.from('audio'), 'clip.webm')).rejects.toThrow(
      'ElevenLabs API error 401'
    )
  })

  it('propagates a Deepgram API error', async () => {
    mockLoadSettings.mockReturnValue({ deepgramApiKey: 'dg-key', transcriptionLanguage: 'auto' })
    mockNetRequest.mockReturnValue(createMockNetRequest(500, '{"error":"boom"}'))

    await expect(transcribeConversation(Buffer.from('audio'), 'clip.webm')).rejects.toThrow(
      'Deepgram API error 500'
    )
  })

  it('falls back to the plain transcript when Deepgram returns no utterances', async () => {
    mockLoadSettings.mockReturnValue({ deepgramApiKey: 'dg-key', transcriptionLanguage: 'auto' })
    const body = JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'fallback text' }] }] } })
    mockNetRequest.mockReturnValue(createMockNetRequest(200, body))

    const result = await transcribeConversation(Buffer.from('audio'), 'clip.webm')
    expect(result.segments).toEqual([])
    expect(result.text).toBe('fallback text')
  })

  it('propagates an AssemblyAI upload error', async () => {
    mockLoadSettings.mockReturnValue({ assemblyaiApiKey: 'aai-key', transcriptionLanguage: 'auto' })
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{"error":"bad key"}' })

    await expect(transcribeConversation(Buffer.from('audio'), 'clip.webm')).rejects.toThrow(
      'AssemblyAI upload error 401'
    )
  })

  it('falls back to the plain transcript when AssemblyAI returns no utterances', async () => {
    mockLoadSettings.mockReturnValue({ assemblyaiApiKey: 'aai-key', transcriptionLanguage: 'auto' })
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ upload_url: 'https://x/upload' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: 'job-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ status: 'completed', text: 'fallback text' })
      })

    const result = await transcribeConversation(Buffer.from('audio'), 'clip.webm')
    expect(result.segments).toEqual([])
    expect(result.text).toBe('fallback text')
  }, 10_000)
})
