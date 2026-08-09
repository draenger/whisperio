import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-usage-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir)
  }
}))

// Fires once, right before the "real" saveStore() commits its rename, to
// simulate a second usage-recording call landing while the first one's
// read-modify-write is still in flight (e.g. an LLM cleanup call and an STT
// call from the same dictation pipeline completing close together).
let onFirstRename: (() => void) | null = null

// Vitest/Vite's ESM interop makes the real `fs` namespace non-configurable
// (see recordingStore.test.ts for the same workaround), so re-export
// `renameSync` as a real vi.fn() wrapping the actual implementation. We hook
// it to inject the "concurrent" call at the exact moment the first save is
// about to commit — before the rename, so the second call's loadStore() sees
// pre-save state, same as a genuinely racing overlapping call would.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: vi.fn((...args: Parameters<typeof actual.renameSync>) => {
      if (onFirstRename) {
        const fn = onFirstRename
        onFirstRename = null
        fn()
      }
      return actual.renameSync(...args)
    })
  }
})

import {
  recordLLM,
  recordSTT,
  getUsage,
  resetUsage,
  monthKey,
  estimateAudioSeconds
} from '../src/main/usageTracker'

const USAGE_PATH = join(testDir, 'usage.json')

describe('usageTracker', () => {
  beforeEach(() => {
    onFirstRename = null
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('recordLLM', () => {
    it('prices a known model from the catalog by exact id', async () => {
      await recordLLM({
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

    it('falls back to the provider default model when no model id is given', async () => {
      await recordLLM({ provider: 'openai', inputTokens: 1_000_000, outputTokens: 1_000_000 })
      const bucket = getUsage().openai[monthKey()]
      // gpt-4o-mini (the catalog default for 'openai'): $0.15/$0.6 per M tokens
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.75)
    })

    it('always prices a local provider (isLocal: true) at $0, even with huge token counts', async () => {
      await recordLLM({
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

    it('always prices the well-known local provider ids at $0 even without an explicit isLocal flag', async () => {
      await recordLLM({ provider: 'selfhosted', inputTokens: 5000, outputTokens: 5000 })
      const bucket = getUsage().selfhosted[monthKey()]
      expect(bucket.estimatedCostUsd).toBe(0)
    })

    it('estimates Replicate cost from predictTimeSeconds when the model has no verified per-token price', async () => {
      await recordLLM({
        provider: 'replicate',
        model: 'meta/meta-llama-3-70b-instruct',
        predictTimeSeconds: 10
      })
      const bucket = getUsage().replicate[monthKey()]
      // 10s * $0.000225/s (T4 GPU estimate)
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.00225)
    })

    it('never fabricates a cost for an unknown/unlisted provider', async () => {
      await recordLLM({ provider: 'some-custom-endpoint', inputTokens: 100, outputTokens: 100 })
      const bucket = getUsage()['some-custom-endpoint'][monthKey()]
      expect(bucket.estimatedCostUsd).toBe(0)
      expect(bucket.requests).toBe(1)
    })

    it('aggregates multiple calls into the same provider/month bucket', async () => {
      await recordLLM({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 100 })
      await recordLLM({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 200 })
      const bucket = getUsage().openai[monthKey()]
      expect(bucket.requests).toBe(2)
      expect(bucket.inputTokens).toBe(300)
      expect(bucket.outputTokens).toBe(300)
    })
  })

  describe('recordSTT', () => {
    it('prices OpenAI STT at $0.006/min by default', async () => {
      await recordSTT({ provider: 'openai', audioSeconds: 600 })
      const bucket = getUsage().openai[monthKey()]
      expect(bucket.requests).toBe(1)
      expect(bucket.audioSeconds).toBe(600)
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.06)
    })

    it('prices gpt-4o-mini-transcribe at the cheaper $0.003/min rate', async () => {
      await recordSTT({ provider: 'openai', model: 'gpt-4o-mini-transcribe', audioSeconds: 600 })
      const bucket = getUsage().openai[monthKey()]
      expect(bucket.estimatedCostUsd).toBeCloseTo(0.03)
    })

    it('tracks ElevenLabs usage in credits, never USD', async () => {
      await recordSTT({ provider: 'elevenlabs', audioSeconds: 60 })
      const bucket = getUsage().elevenlabs[monthKey()]
      expect(bucket.estimatedCostUsd).toBe(0)
      expect(bucket.credits).toBe(330)
    })

    it('prefers an explicit creditsUsed over the length-based ElevenLabs estimate', async () => {
      await recordSTT({ provider: 'elevenlabs', audioSeconds: 60, creditsUsed: 999 })
      const bucket = getUsage().elevenlabs[monthKey()]
      expect(bucket.credits).toBe(999)
    })

    it('estimates Replicate STT cost from predictTimeSeconds when available', async () => {
      await recordSTT({ provider: 'replicate', audioSeconds: 30, predictTimeSeconds: 14 })
      const bucket = getUsage().replicate[monthKey()]
      expect(bucket.audioSeconds).toBe(30)
      expect(bucket.estimatedCostUsd).toBeCloseTo(14 * 0.000225)
    })

    it('records Replicate audio-seconds even with no predictTimeSeconds signal, at $0 cost', async () => {
      await recordSTT({ provider: 'replicate', audioSeconds: 30 })
      const bucket = getUsage().replicate[monthKey()]
      expect(bucket.audioSeconds).toBe(30)
      expect(bucket.estimatedCostUsd).toBe(0)
    })

    it('always prices selfhosted/local STT at $0 regardless of audio length', async () => {
      await recordSTT({ provider: 'selfhosted', audioSeconds: 3600 })
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
      writeFileSync(USAGE_PATH, '{ this is not valid json')
      expect(() => getUsage()).not.toThrow()
      expect(getUsage()).toEqual({})
    })

    it('treats a non-object JSON payload (e.g. an array) as empty too', () => {
      writeFileSync(USAGE_PATH, JSON.stringify([1, 2, 3]))
      expect(getUsage()).toEqual({})
    })

    it('resetUsage wipes all recorded usage', async () => {
      await recordLLM({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 10, outputTokens: 10 })
      expect(getUsage().openai).toBeDefined()

      const result = resetUsage()
      expect(result).toEqual({})
      expect(getUsage()).toEqual({})
    })
  })

  describe('fail-soft when the Electron app path is unavailable', () => {
    it('recordLLM/recordSTT never throw (never reject) even if app.getPath blows up', async () => {
      const electron = await import('electron')
      vi.mocked(electron.app.getPath).mockImplementationOnce(() => {
        throw new Error('not running inside Electron')
      })
      // recordLLM is now async (queued behind the mutation queue), so the
      // fail-soft guarantee shows up as the returned promise resolving
      // (never rejecting) rather than a synchronous throw — the internal
      // try/catch still swallows the error exactly as before.
      await expect(
        recordLLM({ provider: 'openai', inputTokens: 1, outputTokens: 1 })
      ).resolves.toBeUndefined()
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

  describe('concurrent read-modify-write serialization (FB-whisperio-usagetracker-unserialized-read-modify-write)', () => {
    it('does not lose a recordSTT update that lands mid-flight during a recordLLM save', async () => {
      let nestedResult: Promise<void> | undefined
      onFirstRename = () => {
        // Simulates a second, independent usage-recording call (an STT
        // completion) firing while the first call's save is mid-flight.
        nestedResult = recordSTT({ provider: 'openai', audioSeconds: 42 })
      }

      await recordLLM({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 15, outputTokens: 3 })
      // Without serialization the nested call runs to completion
      // synchronously inside the hook above and this is already a no-op;
      // with serialization it's queued behind the first call and only
      // resolves afterwards, so make sure it's settled before asserting.
      await nestedResult

      const usage = getUsage()
      const bucket = usage['openai']?.[monthKey()]

      expect(bucket).toBeDefined()
      // Both calls must be reflected: an unserialized loadStore -> mutate ->
      // saveStore lets the second saveStore() clobber the first writer's
      // update, silently dropping either the inputTokens or the
      // audioSeconds (and undercounting requests).
      expect(bucket!.requests).toBe(2)
      expect(bucket!.inputTokens).toBe(15)
      expect(bucket!.audioSeconds).toBe(42)
    })

    it('accumulates many overlapping recordSTT calls without dropping any', async () => {
      const calls = Array.from({ length: 20 }, (_, i) =>
        recordSTT({ provider: 'openai', audioSeconds: i + 1 })
      )
      await Promise.all(calls)

      const usage = getUsage()
      const bucket = usage['openai']?.[monthKey()]
      const expectedTotalSeconds = Array.from({ length: 20 }, (_, i) => i + 1).reduce((a, b) => a + b, 0)

      expect(bucket).toBeDefined()
      expect(bucket!.requests).toBe(20)
      expect(bucket!.audioSeconds).toBe(expectedTotalSeconds)
    })
  })
})
