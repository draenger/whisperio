import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('active-win', () => ({ default: vi.fn() }))

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...a: unknown[]) => mockLoadSettings(...a),
  getActiveVocabulary: () => ''
}))

const mockEnsure = vi.fn()
vi.mock('../src/main/localServer', () => ({
  getServerStatus: () => ({ status: 'stopped', model: null, port: 8178, platform: 'win32' }),
  ensureManagedServerForUrl: (...a: unknown[]) => mockEnsure(...a)
}))

vi.mock('../src/main/errorHandler', async (orig) => {
  const actual = await orig<typeof import('../src/main/errorHandler')>()
  return { ...actual, notifyInfo: vi.fn(), notifyError: vi.fn() }
})

function createMockNetRequest(statusCode: number, body: string) {
  const rl: Record<string, ((...a: unknown[]) => void)[]> = {}
  const sl: Record<string, ((...a: unknown[]) => void)[]> = {}
  const res = {
    statusCode,
    on(e: string, h: (...a: unknown[]) => void) {
      ;(sl[e] ||= []).push(h)
    }
  }
  const req = {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        for (const h of rl['response'] || []) h(res)
        queueMicrotask(() => {
          for (const h of sl['data'] || []) h(Buffer.from(body))
          for (const h of sl['end'] || []) h()
        })
      })
    }),
    on(e: string, h: (...a: unknown[]) => void) {
      ;(rl[e] ||= []).push(h)
      return req
    }
  }
  return req
}

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  net: { request: (...a: unknown[]) => mockNetRequest(...a) },
  Notification: class {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { transcribeAudio } from '../src/main/transcribe'

const base = {
  sttProvider: 'selfhosted',
  openaiBaseUrl: 'http://127.0.0.1:8178',
  whisperModel: 'ggml-base',
  transcriptionPrompt: ''
}

describe('selfhosted ensure is best-effort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls ensure and then sends the request', async () => {
    mockEnsure.mockResolvedValue(undefined)
    mockLoadSettings.mockReturnValue(base)
    mockNetRequest.mockReturnValue(createMockNetRequest(200, JSON.stringify({ text: 'ok' })))
    expect(await transcribeAudio(Buffer.from('a'), 'r.webm', null, WAV)).toBe('ok')
    expect(mockEnsure).toHaveBeenCalledWith('http://127.0.0.1:8178', 'ggml-base')
  })

  it('still sends the request when ensure throws', async () => {
    mockEnsure.mockRejectedValue(new Error('spawn failed'))
    mockLoadSettings.mockReturnValue(base)
    mockNetRequest.mockReturnValue(createMockNetRequest(200, JSON.stringify({ text: 'user server' })))
    expect(await transcribeAudio(Buffer.from('a'), 'r.webm', null, WAV)).toBe('user server')
    expect(mockNetRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://127.0.0.1:8178/inference' })
    )
  })

  it('falls through to the next provider when ensure and the request both fail', async () => {
    mockEnsure.mockRejectedValue(new Error('spawn failed'))
    mockLoadSettings.mockReturnValue({
      ...base,
      providerChain: ['selfhosted', 'openai'],
      openaiApiKey: 'sk-test',
      fallbackEnabled: true
    })
    mockNetRequest
      .mockReturnValueOnce(createMockNetRequest(500, '{"error":"down"}'))
      .mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'openai fallback' })))
    expect(await transcribeAudio(Buffer.from('a'), 'r.webm', null, WAV)).toBe('openai fallback')
    expect(mockNetRequest).toHaveBeenCalledTimes(2)
  })
})

// A WAV rendition: the self-hosted (whisper.cpp) provider is skipped without one (see audioFormat.ts).
const WAV = { buffer: Buffer.from("w"), filename: "audio.wav" }
