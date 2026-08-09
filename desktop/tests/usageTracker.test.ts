import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
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

import { recordLLM, recordSTT, getUsage, monthKey } from '../src/main/usageTracker'

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
