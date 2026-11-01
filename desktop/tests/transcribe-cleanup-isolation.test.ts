import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// 'active-win' is not installed in every checkout; transcribe.ts -> context.ts imports it.
vi.mock('active-win', () => ({ default: vi.fn(async () => undefined) }))

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  getActiveVocabulary: () => ''
}))

vi.mock('../src/main/usageTracker', () => ({
  recordSTT: vi.fn(),
  estimateAudioSeconds: () => 1
}))

const { mockNotifyError, mockCleanup, mockSelect } = vi.hoisted(() => ({
  mockNotifyError: vi.fn(),
  mockCleanup: vi.fn(),
  mockSelect: vi.fn()
}))

vi.mock('../src/main/errorHandler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/errorHandler')>()
  return { ...actual, notifyInfo: vi.fn() }
})

vi.mock('../src/main/postprocess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/postprocess')>()
  return { ...actual, cleanupTranscription: (...a: unknown[]) => mockCleanup(...a) }
})

vi.mock('../src/main/llm/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/llm/provider')>()
  return { ...actual, selectProvider: (...a: unknown[]) => mockSelect(...a) }
})

// `macrotask` fires the response callbacks from setImmediate/setTimeout (like a
// native Electron net callback, outside any async context) instead of a microtask.
function createMockNetRequest(statusCode: number, body: string, macrotask = false) {
  const later = (fn: () => void): void => {
    if (macrotask) setImmediate(fn)
    else queueMicrotask(fn)
  }
  const reqL: Record<string, ((...a: unknown[]) => void)[]> = {}
  const resL: Record<string, ((...a: unknown[]) => void)[]> = {}
  const response = {
    statusCode,
    on(e: string, h: (...a: unknown[]) => void) {
      ;(resL[e] ||= []).push(h)
    }
  }
  const request: Record<string, unknown> = {
    setHeader: vi.fn(),
    write: vi.fn(),
    abort: vi.fn(),
    end: vi.fn(() => {
      later(() => {
        for (const h of reqL['response'] || []) h(response)
        later(() => {
          for (const h of resL['data'] || []) h(Buffer.from(body))
          for (const h of resL['end'] || []) h()
        })
      })
    }),
    on(e: string, h: (...a: unknown[]) => void) {
      ;(reqL[e] ||= []).push(h)
      return request
    }
  }
  return request
}

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  net: { request: (...a: unknown[]) => mockNetRequest(...a) },
  app: { getPath: () => '.' },
  Notification: class {
    static isSupported = () => true
    constructor(opts: { title: string; body: string }) {
      mockNotifyError(opts.title, opts.body)
    }
    show = vi.fn()
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import {
  transcribeAudio,
  buildCleanupCandidates,
  __resetCleanupCandidatesCacheForTests,
  CLEANUP_TIMEOUT_MS
} from '../src/main/transcribe'

const baseSettings = {
  sttProvider: 'openai',
  openaiApiKey: 'sk-test',
  elevenlabsApiKey: 'xi-test',
  transcriptionPrompt: '',
  customVocabulary: '',
  fallbackEnabled: true,
  cleanupAuto: true,
  cleanupMode: 'full'
}

describe('cleanup isolated from the STT chain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCleanupCandidatesCacheForTests()
    mockSelect.mockResolvedValue(null)
  })
  afterEach(() => vi.useRealTimers())

  it('cleanup throwing returns the raw transcript and does not call the next STT provider', async () => {
    mockLoadSettings.mockReturnValue(baseSettings)
    mockNetRequest.mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'raw text' })))
    mockCleanup.mockRejectedValue(new Error('boom'))

    const out = await transcribeAudio(Buffer.from('a'), 't.webm')

    expect(out).toBe('raw text')
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
    expect(mockNotifyError).not.toHaveBeenCalled()
  })

  it('selectProvider throwing is also fail-soft', async () => {
    mockLoadSettings.mockReturnValue(baseSettings)
    mockNetRequest.mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'raw2' })))
    mockSelect.mockRejectedValue(new Error('bad url'))

    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe('raw2')
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
  })

  it('a malformed AI base URL skips the LLM provider instead of throwing', () => {
    const cands = buildCleanupCandidates({
      ...baseSettings,
      aiProvider: 'openai',
      aiBaseUrl: 'localhost:11434'
    } as never)
    expect(cands.map((c) => c.id)).not.toContain('openai')
  })

  it('an insecure public http AI base URL skips that provider but keeps others', () => {
    const cands = buildCleanupCandidates({
      ...baseSettings,
      aiBaseUrl: 'http://ollama.myhost.com',
      anthropicApiKey: 'ak'
    } as never)
    const ids = cands.map((c) => c.id)
    expect(ids).not.toContain('openai')
    expect(ids).toContain('anthropic')
  })

  it('cleanup that hangs is cut off after the timeout and raw text is used', async () => {
    vi.useFakeTimers()
    mockLoadSettings.mockReturnValue(baseSettings)
    mockNetRequest.mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'raw3' })))
    mockCleanup.mockImplementation(() => new Promise(() => {}))

    const p = transcribeAudio(Buffer.from('a'), 't.webm')
    await vi.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS + 10)
    expect(await p).toBe('raw3')
  })
})

describe('error notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCleanupCandidatesCacheForTests()
  })

  it('no notification when a later provider succeeds', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, cleanupAuto: false })
    mockNetRequest
      .mockReturnValueOnce(createMockNetRequest(500, '{}'))
      .mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'ok' })))

    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe('ok')
    expect(mockNotifyError).not.toHaveBeenCalled()
  })

  it('exactly one summarizing notification when the whole chain fails', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, cleanupAuto: false })
    mockNetRequest.mockImplementation(() => createMockNetRequest(500, '{}'))

    await expect(transcribeAudio(Buffer.from('a'), 't.webm')).rejects.toThrow()
    expect(mockNotifyError).toHaveBeenCalledTimes(1)
    expect(mockNotifyError.mock.calls[0][0]).toBe('Transcription Error')
    expect(String(mockNotifyError.mock.calls[0][1])).toMatch(/2 providers failed/)
  })

  it('no key configured: exactly one toast with the friendly key message', async () => {
    mockLoadSettings.mockReturnValue({ providerChain: ['openai'], transcriptionPrompt: '', customVocabulary: '' })
    // No key: openai throws before any request is made.
    await expect(transcribeAudio(Buffer.from('a'), 't.webm')).rejects.toThrow(/No OpenAI API key/)
    expect(mockNetRequest).not.toHaveBeenCalled()
    expect(mockNotifyError).toHaveBeenCalledTimes(1)
    expect(String(mockNotifyError.mock.calls[0][1])).toMatch(/Invalid API key/)
  })

  it('provider callbacks fired from macrotasks (outside any async context): zero toasts when fallback succeeds', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, cleanupAuto: false })
    mockNetRequest
      .mockReturnValueOnce(createMockNetRequest(500, '{}', true))
      .mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'ok' }), true))

    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe('ok')
    expect(mockNotifyError).not.toHaveBeenCalled()
  })

  it('provider callbacks fired from macrotasks: exactly one toast when all fail', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, cleanupAuto: false })
    mockNetRequest.mockImplementation(() => createMockNetRequest(500, '{}', true))

    await expect(transcribeAudio(Buffer.from('a'), 't.webm')).rejects.toThrow()
    expect(mockNotifyError).toHaveBeenCalledTimes(1)
    expect(String(mockNotifyError.mock.calls[0][1])).toMatch(/2 providers failed/)
  })

  it('concurrent chains do not mix errors', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, cleanupAuto: false })
    mockNetRequest.mockImplementation(() => createMockNetRequest(500, '{}'))
    const results = await Promise.allSettled([
      transcribeAudio(Buffer.from('a'), 'a.webm'),
      transcribeAudio(Buffer.from('b'), 'b.webm')
    ])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(mockNotifyError).toHaveBeenCalledTimes(2)
    for (const c of mockNotifyError.mock.calls) expect(String(c[1])).toMatch(/\(2 providers failed\)/)
  })

  it('self-hosted failure is labelled self-hosted, not OpenAI', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['selfhosted'],
      openaiBaseUrl: 'http://127.0.0.1:8178/v1',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    mockNetRequest.mockImplementation(() => createMockNetRequest(500, '{}'))

    await expect(transcribeAudio(Buffer.from('a'), 't.webm', null, WAV)).rejects.toThrow(/Self-hosted API error 500/)
  })
})

// A WAV rendition: the self-hosted (whisper.cpp) provider is skipped without one (see audioFormat.ts).
const WAV = { buffer: Buffer.from("w"), filename: "audio.wav" }
