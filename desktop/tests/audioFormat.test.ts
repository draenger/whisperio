import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('active-win', () => ({ default: vi.fn() }))

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  getActiveVocabulary: () => ''
}))
vi.mock('../src/main/errorHandler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/errorHandler')>()
  return { ...actual, notifyInfo: vi.fn(), notifyError: vi.fn() }
})

// Records the body written for each request so we can tell which audio arrived.
const requests: { url: string; body: Buffer[] }[] = []
const mockNetRequest = vi.fn((opts: { url?: string } | string) => {
  const url = typeof opts === 'string' ? opts : (opts.url ?? '')
  const rec = { url, body: [] as Buffer[] }
  requests.push(rec)
  const respL: Record<string, ((...a: unknown[]) => void)[]> = {}
  const reqL: Record<string, ((...a: unknown[]) => void)[]> = {}
  const response = {
    statusCode: 200,
    on(e: string, h: (...a: unknown[]) => void) { (respL[e] ||= []).push(h) }
  }
  const req = {
    setHeader: vi.fn(),
    write: vi.fn((b: Buffer | string) => { rec.body.push(Buffer.from(b)) }),
    end: vi.fn((b?: Buffer | string) => {
      if (b) rec.body.push(Buffer.from(b))
      queueMicrotask(() => {
        for (const h of reqL['response'] || []) h(response)
        queueMicrotask(() => {
          for (const h of respL['data'] || []) h(Buffer.from(JSON.stringify({ text: 'ok' })))
          for (const h of respL['end'] || []) h()
        })
      })
    }),
    on(e: string, h: (...a: unknown[]) => void) { (reqL[e] ||= []).push(h); return req }
  }
  return req
})
vi.mock('electron', () => ({
  net: { request: (...a: unknown[]) => mockNetRequest(...(a as [string])) },
  Notification: class { static isSupported = () => false; show = vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}))

const mockRecordSTT = vi.fn()
vi.mock('../src/main/usageTracker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/usageTracker')>()
  return { ...actual, recordSTT: (...a: unknown[]) => mockRecordSTT(...a) }
})

import { transcribeAudio } from '../src/main/transcribe'
import { isWav, resolveProviderAudio, coerceWavArg, providerNeedsWav } from '../src/main/audioFormat'

const WEBM = Buffer.from('WEBM-ORIGINAL-AUDIO')
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from('WAV-PCM')])
const bodyOf = (i: number): Buffer => Buffer.concat(requests[i].body)

describe('resolveProviderAudio', () => {
  const orig = { buffer: WEBM, filename: 'a.webm' }
  const wav = { buffer: WAV, filename: 'audio.wav' }
  it('selfhosted -> wav, others -> original when both given', () => {
    expect(resolveProviderAudio('selfhosted', orig, wav)).toBe(wav)
    for (const p of ['openai', 'groq', 'elevenlabs', 'deepgram']) {
      expect(resolveProviderAudio(p, orig, wav)).toBe(orig)
    }
  })
  it('selfhosted with webm only -> null; with wav original -> original', () => {
    expect(resolveProviderAudio('selfhosted', orig, null)).toBeNull()
    const w = { buffer: WAV, filename: 'x.wav' }
    expect(resolveProviderAudio('selfhosted', w, null)).toBe(w)
    expect(isWav(WEBM)).toBe(false)
    expect(isWav(WAV)).toBe(true)
  })
})

describe('transcribeAudio per-provider format', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requests.length = 0
  })

  it('sends WAV to selfhosted and the original to cloud when both are given', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['selfhosted', 'openai'],
      openaiBaseUrl: 'http://127.0.0.1:8178',
      openaiApiKey: 'sk-test'
    })
    // selfhosted fails -> falls through to openai
    mockNetRequest.mockImplementationOnce(() => { throw new Error('ECONNREFUSED') })
    await transcribeAudio(WEBM, 'audio.webm', null, { buffer: WAV, filename: 'audio.wav' })
    // the throwing selfhosted attempt is not recorded; the openai hop is
    expect(requests.length).toBe(1)
    expect(requests[0].url).toContain('openai.com')
    expect(bodyOf(0).includes(Buffer.from('WEBM-ORIGINAL-AUDIO'))).toBe(true)
    expect(bodyOf(0).includes(Buffer.from('WAV-PCM'))).toBe(false)
  })

  it('selfhosted receives the wav', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['selfhosted', 'openai'],
      openaiBaseUrl: 'http://127.0.0.1:8178',
      openaiApiKey: 'sk-test'
    })
    await transcribeAudio(WEBM, 'audio.webm', null, { buffer: WAV, filename: 'audio.wav' })
    expect(requests.length).toBe(1)
    expect(bodyOf(0).includes(Buffer.from('WAV-PCM'))).toBe(true)
    expect(bodyOf(0).includes(Buffer.from('WEBM-ORIGINAL'))).toBe(false)
  })

  it('reprocess (webm only) skips selfhosted and falls through to cloud', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['selfhosted', 'openai'],
      openaiBaseUrl: 'http://127.0.0.1:8178',
      openaiApiKey: 'sk-test'
    })
    const text = await transcribeAudio(WEBM, 'rec.webm')
    expect(text).toBe('ok')
    expect(requests.length).toBe(1)
    expect(requests[0].url).toContain('openai.com')
    expect(bodyOf(0).includes(Buffer.from('WEBM-ORIGINAL'))).toBe(true)
  })

  it('reprocess with only selfhosted fails with a clear message, no request', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['selfhosted'],
      openaiBaseUrl: 'http://127.0.0.1:8178'
    })
    await expect(transcribeAudio(WEBM, 'rec.webm')).rejects.toThrow(/needs WAV/)
    expect(requests.length).toBe(0)
  })
})

describe('coerceWavArg / isWav / providerNeedsWav', () => {
  it('accepts Uint8Array views honouring byteOffset/byteLength', () => {
    const pool = new Uint8Array(64)
    pool.set(WAV, 10)
    const view = new Uint8Array(pool.buffer, 10, WAV.length)
    const out = coerceWavArg(view)!
    expect(out.length).toBe(WAV.length)
    expect(out.equals(WAV)).toBe(true)
    expect(isWav(view)).toBe(true)
  })
  it('null/undefined/empty -> null; other types rejected', () => {
    expect(coerceWavArg(null)).toBeNull()
    expect(coerceWavArg(undefined)).toBeNull()
    expect(coerceWavArg(new Uint8Array(0))).toBeNull()
    expect(() => coerceWavArg('RIFF')).toThrow(TypeError)
    expect(() => coerceWavArg({ length: 5 })).toThrow(TypeError)
    expect(() => coerceWavArg(new ArrayBuffer(8))).toThrow(TypeError)
  })
  it('providerNeedsWav', () => {
    expect(providerNeedsWav('selfhosted')).toBe(true)
    expect(providerNeedsWav('openai')).toBe(false)
  })
})

describe('usage metering duration', () => {
  beforeEach(() => { vi.clearAllMocks(); requests.length = 0 })
  it('uses the WAV for estimation when present, else the webm', async () => {
    mockLoadSettings.mockReturnValue({ providerChain: ['openai'], openaiApiKey: 'sk-test' })
    const big = Buffer.concat([WAV, Buffer.alloc(32000 * 10)]) // ~10 s of 16k mono PCM
    await transcribeAudio(WEBM, 'audio.webm', null, { buffer: big, filename: 'audio.wav' })
    expect(mockRecordSTT.mock.calls[0][0].audioSeconds).toBeCloseTo((big.length - 44) / 32000, 3)
    await transcribeAudio(WEBM, 'audio.webm')
    expect(mockRecordSTT.mock.calls[1][0].audioSeconds).toBeCloseTo(WEBM.length / 3000, 6)
  })
})
