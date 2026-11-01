import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('active-win', () => ({ default: vi.fn() }))

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...a: unknown[]) => mockLoadSettings(...a),
  getActiveVocabulary: () => ''
}))
vi.mock('../src/main/errorHandler', async (orig) => {
  const actual = await orig<typeof import('../src/main/errorHandler')>()
  return { ...actual, notifyInfo: vi.fn(), notifyError: vi.fn() }
})
const mockRecordSTT = vi.fn()
vi.mock('../src/main/usageTracker', async (orig) => {
  const actual = await orig<typeof import('../src/main/usageTracker')>()
  return { ...actual, recordSTT: (...a: unknown[]) => mockRecordSTT(...a) }
})
const mockNet = vi.fn()
vi.mock('electron', () => ({
  net: { request: (...a: unknown[]) => mockNet(...a) },
  app: { getPath: () => '/tmp/ud', getAppPath: () => '/tmp/app' },
  Notification: class {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const mockParakeet = vi.fn()
let runtimeInstalled = true
vi.mock('../src/main/stt/parakeet', () => ({
  parakeetTranscribe: (...a: unknown[]) => mockParakeet(...a),
  isParakeetRuntimeInstalled: () => runtimeInstalled
}))
let modelReady = true
vi.mock('../src/main/stt/parakeetModel', () => ({
  isParakeetModelReady: () => modelReady
}))

import { transcribeAudio } from '../src/main/transcribe'

const base = {
  sttProvider: 'parakeet',
  providerChain: ['parakeet'],
  transcriptionPrompt: '',
  customVocabulary: '',
  cleanupEnabled: false,
  aiPostProcessing: false
}

function okNet(text: string) {
  const rl: Record<string, ((...a: unknown[]) => void)[]> = {}
  const pl: Record<string, ((...a: unknown[]) => void)[]> = {}
  const res = {
    statusCode: 200,
    on: (e: string, h: (...a: unknown[]) => void) => {
      ;(pl[e] ||= []).push(h)
    }
  }
  const req = {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() =>
      queueMicrotask(() => {
        for (const h of rl['response'] || []) h(res)
        queueMicrotask(() => {
          for (const h of pl['data'] || []) h(Buffer.from(JSON.stringify({ text })))
          for (const h of pl['end'] || []) h()
        })
      })
    ),
    on: (e: string, h: (...a: unknown[]) => void) => {
      ;(rl[e] ||= []).push(h)
      return req
    }
  }
  return req
}

beforeEach(() => {
  vi.clearAllMocks()
  modelReady = true
  runtimeInstalled = true
})

// Parakeet is WAV-only (providerNeedsWav): fixtures need a real RIFF/WAVE header.
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])

describe('parakeet provider (experimental)', () => {
  it('flag off: a stale parakeet-only chain is ignored and never runs', async () => {
    mockLoadSettings.mockReturnValue({ ...base, experimentalParakeet: false })
    await expect(transcribeAudio(Buffer.from('a'), 'a.wav')).rejects.toThrow(/OpenAI API key/)
    expect(mockParakeet).not.toHaveBeenCalled()
  })

  it('flag off: stale parakeet in a longer chain falls through to the next provider', async () => {
    mockLoadSettings.mockReturnValue({
      ...base,
      experimentalParakeet: false,
      providerChain: ['parakeet', 'openai'],
      openaiApiKey: 'sk-test'
    })
    mockNet.mockReturnValueOnce(okNet('cloud'))
    await expect(transcribeAudio(Buffer.from('a'), 'a.wav')).resolves.toBe('cloud')
    expect(mockParakeet).not.toHaveBeenCalled()
  })

  it('runtime not loadable: parakeet is unconfigured and skipped without a failure hop', async () => {
    runtimeInstalled = false
    mockLoadSettings.mockReturnValue({
      ...base,
      experimentalParakeet: true,
      providerChain: ['parakeet', 'openai'],
      openaiApiKey: 'sk-test'
    })
    mockNet.mockReturnValueOnce(okNet('cloud'))
    await expect(transcribeAudio(Buffer.from('a'), 'a.wav')).resolves.toBe('cloud')
    expect(mockParakeet).not.toHaveBeenCalled()
  })

  it('flag on + model ready: transcribes and meters as local', async () => {
    mockLoadSettings.mockReturnValue({ ...base, experimentalParakeet: true })
    mockParakeet.mockResolvedValue('witaj swiecie')
    await expect(transcribeAudio(WAV, 'a.wav')).resolves.toBe('witaj swiecie')
    expect(mockRecordSTT).toHaveBeenCalledWith(expect.objectContaining({ provider: 'parakeet', isLocal: true }))
  })

  it('flag on + runtime missing: clear error when it is the only provider', async () => {
    mockLoadSettings.mockReturnValue({ ...base, experimentalParakeet: true })
    mockParakeet.mockRejectedValue(new Error('Experimental Parakeet runtime is not installed'))
    await expect(transcribeAudio(WAV, 'a.wav')).rejects.toThrow(/runtime is not installed/)
    expect(mockRecordSTT).not.toHaveBeenCalled()
  })

  it('flag on + runtime missing: chain falls back to the next provider', async () => {
    mockLoadSettings.mockReturnValue({
      ...base,
      experimentalParakeet: true,
      providerChain: ['parakeet', 'openai'],
      openaiApiKey: 'sk-test'
    })
    mockParakeet.mockRejectedValue(new Error('Experimental Parakeet runtime is not installed'))
    mockNet.mockReturnValueOnce(okNet('from openai'))
    await expect(transcribeAudio(Buffer.from('a'), 'a.wav')).resolves.toBe('from openai')
    expect(mockRecordSTT).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', isLocal: false }))
  })

  it('model not downloaded: parakeet is skipped in the chain', async () => {
    modelReady = false
    mockLoadSettings.mockReturnValue({
      ...base,
      experimentalParakeet: true,
      providerChain: ['parakeet', 'openai'],
      openaiApiKey: 'sk-test'
    })
    mockNet.mockReturnValueOnce(okNet('cloud'))
    await expect(transcribeAudio(Buffer.from('a'), 'a.wav')).resolves.toBe('cloud')
    expect(mockParakeet).not.toHaveBeenCalled()
  })
})
