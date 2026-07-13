import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData')
  }
}))

// Minimal in-memory fake filesystem so we can exercise the real atomic
// write-then-rename path (usageTracker.saveStore) without touching disk —
// same spirit as settingsManager.test.ts's fs mock, but backed by a Map so
// writeFileSync(tmp) + renameSync(tmp -> final) actually round-trips.
const fakeFiles = new Map<string, string>()

vi.mock('fs', () => ({
  existsSync: (path: string) => fakeFiles.has(path),
  readFileSync: (path: string) => {
    const content = fakeFiles.get(path)
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
    return content
  },
  writeFileSync: (path: string, content: string) => {
    fakeFiles.set(path, content)
  },
  renameSync: (oldPath: string, newPath: string) => {
    const content = fakeFiles.get(oldPath)
    fakeFiles.delete(oldPath)
    if (content !== undefined) fakeFiles.set(newPath, content)
  }
}))

import {
  recordLLM,
  recordSTT,
  getUsage,
  resetUsage,
  monthKey,
  estimateAudioSeconds
} from '../src/main/usageTracker'

const USAGE_PATH = '/mock/userData/usage.json'

describe('usageTracker', () => {
  beforeEach(() => {
    fakeFiles.clear()
    vi.clearAllMocks()
  })

  describe('recordLLM', () => {
    it('prices a known model from the catalog by exact id', () => {
      recordLLM({
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000
      })
      const usage = getUsage()
      const bucket = usage.anthropic[monthKey()]
      expect(bucket.requests).toBe(1)
      expect(bucket.inputTokens).toBe(1_000_000)
      expect(bucket.outputTokens).toBe(1_000_000)
      // claude-opus-4-8: $5/$25 per M tokens -> 5 + 25 = 30
      expect(bucket.estimatedCostUsd).toBeCloseTo(30)
      expect(bucket.credits).toBe(0)
    })

    it('falls back to the provider default model when no model id is given', () => {
      recordLLM({ provider: 'openai', inputTokens: 1_000_000, outputTokens: 1_000_000 })
      const bucket = getUsage().openai[monthKey()]
      // gpt-4o-mini (the catalog default for 'openai'): $0.15/$0.6 per M tokens
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.75)
    })

    it('always prices a local provider (isLocal: true) at $0, even with huge token counts', () => {
      recordLLM({
        provider: 'local',
        model: 'local-model',
        inputTokens: 10_000_000,
        outputTokens: 10_000_000,
        isLocal: true
      })
      const bucket = getUsage().local[monthKey()]
      expect(bucket.requests).toBe(1)
      expect(bucket.inputTokens).toBe(10_000_000)
      expect(bucket.estimatedCostUsd).toBe(0)
    })

    it('always prices the well-known local provider ids at $0 even without an explicit isLocal flag', () => {
      recordLLM({ provider: 'selfhosted', inputTokens: 5000, outputTokens: 5000 })
      const bucket = getUsage().selfhosted[monthKey()]
      expect(bucket.estimatedCostUsd).toBe(0)
    })

    it('estimates Replicate cost from predictTimeSeconds when the model has no verified per-token price', () => {
      recordLLM({
        provider: 'replicate',
        model: 'meta/meta-llama-3-70b-instruct',
        predictTimeSeconds: 10
      })
      const bucket = getUsage().replicate[monthKey()]
      // 10s * $0.000225/s (T4 GPU estimate)
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.00225)
    })

    it('never fabricates a cost for an unknown/unlisted provider', () => {
      recordLLM({ provider: 'some-custom-endpoint', inputTokens: 100, outputTokens: 100 })
      const bucket = getUsage()['some-custom-endpoint'][monthKey()]
      expect(bucket.estimatedCostUsd).toBe(0)
      expect(bucket.requests).toBe(1)
    })

    it('aggregates multiple calls into the same provider/month bucket', () => {
      recordLLM({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 100 })
      recordLLM({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 200 })
      const bucket = getUsage().openai[monthKey()]
      expect(bucket.requests).toBe(2)
      expect(bucket.inputTokens).toBe(300)
      expect(bucket.outputTokens).toBe(300)
    })
  })

  describe('recordSTT', () => {
    it('prices OpenAI STT at $0.006/min by default', () => {
      recordSTT({ provider: 'openai', audioSeconds: 600 })
      const bucket = getUsage().openai[monthKey()]
      expect(bucket.requests).toBe(1)
      expect(bucket.audioSeconds).toBe(600)
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.06)
    })

    it('prices gpt-4o-mini-transcribe at the cheaper $0.003/min rate', () => {
      recordSTT({ provider: 'openai', model: 'gpt-4o-mini-transcribe', audioSeconds: 600 })
      const bucket = getUsage().openai[monthKey()]
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.03)
    })

    it('tracks ElevenLabs usage in credits, never USD', () => {
      recordSTT({ provider: 'elevenlabs', audioSeconds: 60 })
      const bucket = getUsage().elevenlabs[monthKey()]
      expect(bucket.estimatedCostUsd).toBe(0)
      expect(bucket.credits).toBe(330)
    })

    it('prefers an explicit creditsUsed over the length-based ElevenLabs estimate', () => {
      recordSTT({ provider: 'elevenlabs', audioSeconds: 60, creditsUsed: 999 })
      const bucket = getUsage().elevenlabs[monthKey()]
      expect(bucket.credits).toBe(999)
    })

    it('estimates Replicate STT cost from predictTimeSeconds when available', () => {
      recordSTT({ provider: 'replicate', audioSeconds: 30, predictTimeSeconds: 14 })
      const bucket = getUsage().replicate[monthKey()]
      expect(bucket.audioSeconds).toBe(30)
      expect(bucket.estimatedCostUsd).toBeCloseTo(14 * 0.000225)
    })

    it('records Replicate audio-seconds even with no predictTimeSeconds signal, at $0 cost', () => {
      recordSTT({ provider: 'replicate', audioSeconds: 30 })
      const bucket = getUsage().replicate[monthKey()]
      expect(bucket.audioSeconds).toBe(30)
      expect(bucket.estimatedCostUsd).toBe(0)
    })

    it('always prices selfhosted/local STT at $0 regardless of audio length', () => {
      recordSTT({ provider: 'selfhosted', audioSeconds: 3600 })
      const bucket = getUsage().selfhosted[monthKey()]
      expect(bucket.requests).toBe(1)
      expect(bucket.audioSeconds).toBe(3600)
      expect(bucket.estimatedCostUsd).toBe(0)
    })
  })

  describe('getUsage / resetUsage', () => {
    it('returns an empty store when no usage file exists yet', () => {
      expect(getUsage()).toEqual({})
    })

    it('is resilient to a corrupt usage.json — fails soft to empty rather than throwing', () => {
      fakeFiles.set(USAGE_PATH, '{ this is not valid json')
      expect(() => getUsage()).not.toThrow()
      expect(getUsage()).toEqual({})
    })

    it('treats a non-object JSON payload (e.g. an array) as empty too', () => {
      fakeFiles.set(USAGE_PATH, JSON.stringify([1, 2, 3]))
      expect(getUsage()).toEqual({})
    })

    it('resetUsage wipes all recorded usage', () => {
      recordLLM({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 10, outputTokens: 10 })
      expect(getUsage().openai).toBeDefined()

      const result = resetUsage()
      expect(result).toEqual({})
      expect(getUsage()).toEqual({})
    })
  })

  describe('fail-soft when the Electron app path is unavailable', () => {
    it('recordLLM/recordSTT never throw even if app.getPath blows up', async () => {
      const electron = await import('electron')
      vi.mocked(electron.app.getPath).mockImplementationOnce(() => {
        throw new Error('not running inside Electron')
      })
      expect(() => recordLLM({ provider: 'openai', inputTokens: 1, outputTokens: 1 })).not.toThrow()
    })

    it('getUsage/resetUsage never throw either', async () => {
      const electron = await import('electron')
      vi.mocked(electron.app.getPath).mockImplementationOnce(() => {
        throw new Error('not running inside Electron')
      })
      expect(() => getUsage()).not.toThrow()

      vi.mocked(electron.app.getPath).mockImplementationOnce(() => {
        throw new Error('not running inside Electron')
      })
      expect(() => resetUsage()).not.toThrow()
    })
  })

  describe('monthKey', () => {
    it('formats as YYYY-MM', () => {
      expect(monthKey(new Date(2026, 6, 13))).toBe('2026-07')
      expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01')
    })
  })

  describe('estimateAudioSeconds', () => {
    it('computes an exact duration for the fixed 16kHz mono 16-bit .wav format', () => {
      // 44-byte header + 5 seconds * 32000 bytes/sec
      const buffer = Buffer.alloc(44 + 5 * 32_000)
      expect(estimateAudioSeconds(buffer, 'audio.wav')).toBeCloseTo(5)
    })

    it('estimates .webm duration from an assumed opus bitrate', () => {
      const buffer = Buffer.alloc(5 * 3_000)
      expect(estimateAudioSeconds(buffer, 'audio.webm')).toBeCloseTo(5)
    })

    it('returns 0 for an empty buffer', () => {
      expect(estimateAudioSeconds(Buffer.alloc(0), 'audio.webm')).toBe(0)
    })
  })
})
