import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * saveIndex() writes the recordings index atomically: temp file, then rename
 * over the real index. Two lifecycle defects lived in that rename:
 *
 *  1. When the rename threw, the temp file was left on disk forever. saveIndex
 *     runs on EVERY index mutation, so each failure silently accreted another
 *     orphan `.tmp` in the recordings directory.
 *  2. Windows hands out a transient EPERM/EBUSY when Defender/an indexer still
 *     has the freshly-written temp file open. A single unretried attempt turned
 *     that into a hard "save failed", losing the mutation.
 */

const testDir = join(tmpdir(), `whisperio-saveindex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) }
}))

// renameSync is routed through a swappable spy so a failure can be injected
// without needing a real locked file.
let renameImpl: ((from: string, to: string) => void) | null = null
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: actual,
    renameSync: (from: string, to: string) => {
      if (renameImpl) return renameImpl(from, to)
      return actual.renameSync(from, to)
    }
  }
})

const { renameSync: realRenameSync } = await vi.importActual<typeof import('fs')>('fs')

import { saveIndex, loadIndex } from '../src/main/recordingStore'

const RECORDINGS_DIR = join(testDir, 'recordings')

function tmpArtifacts(): string[] {
  if (!existsSync(RECORDINGS_DIR)) return []
  return readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.tmp'))
}

function errWithCode(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: injected rename failure`) as NodeJS.ErrnoException
  err.code = code
  return err
}

describe('recordingStore — saveIndex atomic-write lifecycle', () => {
  beforeEach(() => {
    renameImpl = null
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    renameImpl = null
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('leaves no temp file behind when the rename fails permanently', () => {
    renameImpl = () => {
      throw errWithCode('ENOSPC')
    }

    expect(() => saveIndex({ recordings: [] })).toThrow(/ENOSPC/)

    // The defect: the serialized temp file survived every failed save.
    expect(tmpArtifacts()).toEqual([])
  })

  it('does not accumulate temp files across repeated rename failures', () => {
    renameImpl = () => {
      throw errWithCode('EROFS')
    }

    for (let i = 0; i < 5; i++) {
      expect(() => saveIndex({ recordings: [] })).toThrow()
    }

    expect(tmpArtifacts()).toEqual([])
  })

  it('retries a transient Windows EPERM and completes the save', () => {
    let attempts = 0
    renameImpl = (from, to) => {
      attempts++
      if (attempts === 1) throw errWithCode('EPERM')
      return realRenameSync(from, to)
    }

    saveIndex({ recordings: [{ id: 'rec-1' } as never] })

    expect(attempts).toBe(2)
    expect(loadIndex().recordings).toHaveLength(1)
    expect(tmpArtifacts()).toEqual([])
  })

  it('gives up after the retry budget and still cleans up', () => {
    let attempts = 0
    renameImpl = () => {
      attempts++
      throw errWithCode('EBUSY')
    }

    expect(() => saveIndex({ recordings: [] })).toThrow(/EBUSY/)

    // Bounded — it must not spin forever on a permanently locked index.
    expect(attempts).toBeGreaterThan(1)
    expect(attempts).toBeLessThanOrEqual(5)
    expect(tmpArtifacts()).toEqual([])
  })

  it('does not retry a non-transient error', () => {
    let attempts = 0
    renameImpl = () => {
      attempts++
      throw errWithCode('ENOSPC')
    }

    expect(() => saveIndex({ recordings: [] })).toThrow(/ENOSPC/)
    expect(attempts).toBe(1)
  })

  it('writes the index normally when the rename succeeds', () => {
    saveIndex({ recordings: [{ id: 'rec-a' } as never, { id: 'rec-b' } as never] })

    const raw = JSON.parse(readFileSync(join(RECORDINGS_DIR, 'index.json'), 'utf-8'))
    expect(raw.recordings.map((r: { id: string }) => r.id)).toEqual(['rec-a', 'rec-b'])
    expect(tmpArtifacts()).toEqual([])
  })
})
