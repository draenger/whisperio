import { vi, describe, it, expect, beforeEach } from 'vitest'

// Snippets wiring: transcribeAudio() must run expandSnippets() on the FINAL
// transcript (after auto-cleanup, or the raw one when cleanup is off/fails).
// Same mock scaffolding as transcribe-cleanup-isolation.test.ts.

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

import { transcribeAudio, __resetCleanupCandidatesCacheForTests } from '../src/main/transcribe'

const ADDRESS = '221B Baker Street, London'
const baseSettings = {
  sttProvider: 'openai',
  providerChain: ['openai'],
  openaiApiKey: 'sk-test',
  transcriptionPrompt: '',
  customVocabulary: '',
  cleanupAuto: false,
  cleanupMode: 'full',
  snippets: [{ trigger: 'my address', text: ADDRESS }]
}

function stt(text: string): void {
  mockNetRequest.mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text })))
}

describe('transcribeAudio applies snippets to the final transcript', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCleanupCandidatesCacheForTests()
    mockSelect.mockResolvedValue(null)
  })

  it('expands a whole-transcript trigger with cleanup off', async () => {
    mockLoadSettings.mockReturnValue(baseSettings)
    stt('My address.')
    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe(ADDRESS)
  })

  it('leaves non-matching dictation untouched', async () => {
    mockLoadSettings.mockReturnValue(baseSettings)
    stt('ship it to my address')
    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe('ship it to my address')
  })

  it('matches against the CLEANED text when auto-cleanup is on', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, cleanupAuto: true })
    stt('um my address uh')
    mockCleanup.mockResolvedValue('My address.')
    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe(ADDRESS)
    expect(mockCleanup).toHaveBeenCalledTimes(1)
  })

  it('still expands the raw transcript when cleanup throws (fail-soft path)', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, cleanupAuto: true })
    stt('my address')
    mockCleanup.mockRejectedValue(new Error('offline'))
    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe(ADDRESS)
  })

  it('is a no-op when the snippets list is empty or missing', async () => {
    mockLoadSettings.mockReturnValue({ ...baseSettings, snippets: [] })
    stt('my address')
    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe('my address')

    const { snippets: _omit, ...noKey } = baseSettings
    mockLoadSettings.mockReturnValue(noKey)
    stt('my address')
    expect(await transcribeAudio(Buffer.from('a'), 't.webm')).toBe('my address')
  })
})
