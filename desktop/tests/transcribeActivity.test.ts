import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  getActiveVocabulary: (settings: { customVocabulary?: string }) =>
    settings.customVocabulary?.trim() || ''
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

vi.mock('active-win', () => ({ default: vi.fn() }))

import { transcribeAudio } from '../src/main/transcribe'
import { onTranscriptionActivity } from '../src/main/dictation/watchdog'

describe('transcribeAudio watchdog activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      fallbackEnabled: false
    })
    mockNetRequest.mockReturnValue(createMockNetRequest(200, JSON.stringify({ text: 'hi' })))
  })

  it('notes activity for live dictation', async () => {
    const spy = vi.fn()
    const off = onTranscriptionActivity(spy)
    await transcribeAudio(Buffer.from('a'), 't.webm', null, { fromDictation: true })
    off()
    expect(spy).toHaveBeenCalled()
  })

  it('does not note activity for Reprocess / default callers', async () => {
    const spy = vi.fn()
    const off = onTranscriptionActivity(spy)
    await transcribeAudio(Buffer.from('a'), 't.webm', null)
    off()
    expect(spy).not.toHaveBeenCalled()
  })
})
