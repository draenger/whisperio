import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, unlinkSync, writeFileSync, readdirSync, renameSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir)
  }
}))

// Vitest/Vite's ESM interop makes the real `fs` module's namespace object
// non-configurable, so `vi.spyOn(fs, 'unlinkSync')` throws "Cannot redefine
// property" (see https://vitest.dev/guide/browser/#limitations). Re-export
// `unlinkSync` as a real vi.fn() wrapping the actual implementation so the
// locked-file regression tests below can override it with
// `mockImplementationOnce` while every other call still hits the real fs.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    unlinkSync: vi.fn(actual.unlinkSync),
    readFileSync: vi.fn(actual.readFileSync),
    renameSync: vi.fn(actual.renameSync),
    copyFileSync: vi.fn(actual.copyFileSync)
  }
})

import {
  getRecordingsDir,
  saveRecording,
  updateRecording,
  getRecordings,
  getRecording,
  deleteRecording,
  deleteAllRecordings,
  deleteRecordingsByDate,
  getRecordingAudio,
  loadIndex,
  saveIndex,
  IndexUnavailableError,
  setSleepSyncForTests,
  setMaxDiskBytes,
  getMaxDiskBytes
} from '../src/main/recordingStore'

describe('recordingStore', () => {
  beforeEach(() => {
    // Ensure test directory exists and is clean
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

  describe('getRecordingsDir', () => {
    it('creates the recordings directory if it does not exist', () => {
      const dir = getRecordingsDir()
      expect(dir).toBe(join(testDir, 'recordings'))
      expect(existsSync(dir)).toBe(true)
    })
  })

  describe('saveRecording', () => {
    it('creates file on disk and adds to index', async () => {
      const audio = Buffer.from('fake-audio-data')
      const entry = await saveRecording(audio, { duration: 5, provider: 'openai' })

      expect(entry.id).toMatch(/^rec-\d+-[a-z0-9]{4}$/)
      expect(entry.filename).toMatch(/^recording-\d{4}-\d{2}-\d{2}-\d{6}\.webm$/)
      expect(entry.status).toBe('pending')
      expect(entry.provider).toBe('openai')
      expect(entry.duration).toBe(5)
      expect(entry.size).toBe(audio.length)
      expect(existsSync(entry.filepath)).toBe(true)

      const savedAudio = readFileSync(entry.filepath)
      expect(savedAudio.toString()).toBe('fake-audio-data')

      const index = loadIndex()
      expect(index.recordings).toHaveLength(1)
      expect(index.recordings[0].id).toBe(entry.id)
    })

    // Context-aware tone (v1.5 Work Item B): the context snapshot captured at
    // recording time (main/index.ts's `recordings:save` handler) is persisted
    // onto the entry, additively — see recordingStore.ts's RecordingEntry doc
    // comment for why this must survive to a later on-demand "Clean up" click.
    it('persists a context snapshot (recordedProcessName/recordedWindowTitle) when provided', async () => {
      const entry = await saveRecording(Buffer.from('audio'), {
        duration: 5,
        provider: 'openai',
        recordedProcessName: 'Slack',
        recordedWindowTitle: '#general'
      })

      expect(entry.recordedProcessName).toBe('Slack')
      expect(entry.recordedWindowTitle).toBe('#general')

      const index = loadIndex()
      expect(index.recordings[0].recordedProcessName).toBe('Slack')
      expect(index.recordings[0].recordedWindowTitle).toBe('#general')
    })

    it('omits the context snapshot fields entirely when not provided (additive, no context-aware-tone-off noise)', async () => {
      await saveRecording(Buffer.from('audio'), { duration: 5, provider: 'openai' })

      const raw = JSON.parse(readFileSync(join(getRecordingsDir(), 'index.json'), 'utf-8'))
      expect('recordedProcessName' in raw.recordings[0]).toBe(false)
      expect('recordedWindowTitle' in raw.recordings[0]).toBe(false)
    })
  })

  describe('getRecordings', () => {
    it('returns sorted list by timestamp descending', async () => {
      // Pin Date.now so the three recordings get distinct, increasing timestamps —
      // otherwise same-millisecond saves collide and the sort order is undefined (flaky).
      const nowSpy = vi.spyOn(Date, 'now')
      nowSpy.mockReturnValue(1_000)
      const entry1 = await saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      nowSpy.mockReturnValue(2_000)
      const entry2 = await saveRecording(Buffer.from('b'), { duration: 2, provider: 'elevenlabs' })
      nowSpy.mockReturnValue(3_000)
      const entry3 = await saveRecording(Buffer.from('c'), { duration: 3, provider: 'openai' })
      nowSpy.mockRestore()

      const list = getRecordings()
      expect(list).toHaveLength(3)
      // Most recent first
      expect(list[0].id).toBe(entry3.id)
      expect(list[1].id).toBe(entry2.id)
      expect(list[2].id).toBe(entry1.id)
    })

    it('returns empty array when no recordings exist', () => {
      expect(getRecordings()).toEqual([])
    })
  })

  describe('getRecording', () => {
    it('returns a single recording by id', async () => {
      const entry = await saveRecording(Buffer.from('data'), { duration: 10, provider: 'openai' })
      const found = getRecording(entry.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(entry.id)
    })

    it('returns null for nonexistent id', () => {
      expect(getRecording('rec-nonexistent-0000')).toBeNull()
    })
  })

  describe('updateRecording', () => {
    it('merges updates into existing entry', async () => {
      const entry = await saveRecording(Buffer.from('data'), { duration: 5, provider: 'openai' })

      const updated = await updateRecording(entry.id, {
        status: 'completed',
        transcription: 'Hello world'
      })

      expect(updated).not.toBeNull()
      expect(updated!.status).toBe('completed')
      expect(updated!.transcription).toBe('Hello world')
      expect(updated!.provider).toBe('openai')
      expect(updated!.duration).toBe(5)

      // Verify persisted
      const persisted = getRecording(entry.id)
      expect(persisted!.status).toBe('completed')
      expect(persisted!.transcription).toBe('Hello world')
    })

    it('returns null for nonexistent id', async () => {
      expect(await updateRecording('rec-nonexistent-0000', { status: 'failed' })).toBeNull()
    })
  })

  describe('deleteRecording', () => {
    it('removes file and index entry', async () => {
      const entry = await saveRecording(Buffer.from('data'), { duration: 5, provider: 'openai' })
      expect(existsSync(entry.filepath)).toBe(true)

      const result = await deleteRecording(entry.id)
      expect(result).toBe(true)
      expect(existsSync(entry.filepath)).toBe(false)
      expect(getRecording(entry.id)).toBeNull()
      expect(getRecordings()).toHaveLength(0)
    })

    it('returns false for nonexistent id', async () => {
      expect(await deleteRecording('rec-nonexistent-0000')).toBe(false)
    })

    it('leaves a tombstone in the index but hides it from reads (LWW convergence)', async () => {
      const entry = await saveRecording(Buffer.from('data'), { duration: 5, provider: 'openai' })
      expect(entry.updatedAt).toBeGreaterThan(0)

      await deleteRecording(entry.id)

      // Hidden from every reader, exactly as a hard delete used to be.
      expect(getRecording(entry.id)).toBeNull()
      expect(getRecordings()).toHaveLength(0)
      expect(getRecordingAudio(entry.id)).toBeNull()
      expect(existsSync(entry.filepath)).toBe(false)

      // But a soft-delete tombstone survives in the raw index so the removal can
      // converge across devices instead of being silently resurrected by a stale add.
      const raw = loadIndex()
      expect(raw.recordings).toHaveLength(1)
      expect(raw.recordings[0].id).toBe(entry.id)
      expect(raw.recordings[0].deletedAt).toBeGreaterThan(0)
      expect(raw.recordings[0].updatedAt).toBeGreaterThanOrEqual(entry.updatedAt!)
      // Freed bytes no longer count against the disk quota.
      expect(raw.recordings[0].size).toBe(0)
    })

    it('cannot be updated once tombstoned', async () => {
      const entry = await saveRecording(Buffer.from('data'), { duration: 5, provider: 'openai' })
      await deleteRecording(entry.id)
      expect(await updateRecording(entry.id, { status: 'completed' })).toBeNull()
    })

    // Regression: unlinkSync used to be bare (no try/catch) in this path, unlike
    // evictToQuota's best-effort pattern. A locked file (AV/backup holding a handle,
    // or a TOCTOU gap after existsSync) throws EBUSY/EPERM, which used to reject the
    // whole enqueue()'d mutation before saveIndex ran — the recording would reappear
    // as if delete never happened. It must still converge (tombstone written).
    it('still tombstones the entry when unlinkSync throws (locked file)', async () => {
      const entry = await saveRecording(Buffer.from('data'), { duration: 5, provider: 'openai' })
      const unlinkSpy = vi.mocked(unlinkSync).mockImplementationOnce(() => {
        throw new Error('EBUSY: resource busy or locked')
      })

      const result = await deleteRecording(entry.id)

      expect(result).toBe(true)
      expect(getRecording(entry.id)).toBeNull()
      const raw = loadIndex()
      expect(raw.recordings).toHaveLength(1)
      expect(raw.recordings[0].deletedAt).toBeGreaterThan(0)
    })
  })

  describe('deleteAllRecordings', () => {
    it('clears everything', async () => {
      const entry1 = await saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      const entry2 = await saveRecording(Buffer.from('b'), { duration: 2, provider: 'openai' })

      await deleteAllRecordings()

      expect(existsSync(entry1.filepath)).toBe(false)
      expect(existsSync(entry2.filepath)).toBe(false)
      expect(getRecordings()).toHaveLength(0)
    })

    // Regression: a locked file must not abort the index clear for the rest of
    // the batch (see deleteRecording's locked-file regression test above).
    it('still clears the index even when unlinkSync throws for one file (locked file)', async () => {
      await saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      await saveRecording(Buffer.from('b'), { duration: 2, provider: 'openai' })
      const unlinkSpy = vi.mocked(unlinkSync).mockImplementationOnce(() => {
        throw new Error('EBUSY: resource busy or locked')
      })

      await deleteAllRecordings()

      expect(getRecordings()).toHaveLength(0)
      expect(loadIndex().recordings).toHaveLength(0)
    })
  })

  describe('deleteRecordingsByDate', () => {
    it('filters correctly and only deletes recordings from specified date', async () => {
      const entry1 = await saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })

      // Manually set timestamp to a different date
      const yesterday = new Date('2025-01-15T10:00:00Z').getTime()
      await updateRecording(entry1.id, { timestamp: yesterday })

      const entry2 = await saveRecording(Buffer.from('b'), { duration: 2, provider: 'openai' })

      await deleteRecordingsByDate('2025-01-15')

      const remaining = getRecordings()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(entry2.id)
    })

    // Regression: a locked file for the matched-date recording must not abort the
    // rewrite of the index (see deleteRecording's locked-file regression test above).
    it('still removes the index entry when unlinkSync throws (locked file)', async () => {
      const entry1 = await saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      const yesterday = new Date('2025-01-15T10:00:00Z').getTime()
      await updateRecording(entry1.id, { timestamp: yesterday })
      const entry2 = await saveRecording(Buffer.from('b'), { duration: 2, provider: 'openai' })

      const unlinkSpy = vi.mocked(unlinkSync).mockImplementationOnce(() => {
        throw new Error('EBUSY: resource busy or locked')
      })

      await deleteRecordingsByDate('2025-01-15')

      const remaining = getRecordings()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(entry2.id)
    })
  })

  describe('getRecordingAudio', () => {
    it('reads file back from disk', async () => {
      const audio = Buffer.from('test-audio-content-12345')
      const entry = await saveRecording(audio, { duration: 3, provider: 'openai' })

      const retrieved = getRecordingAudio(entry.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.toString()).toBe('test-audio-content-12345')
    })

    it('returns null for nonexistent id', () => {
      expect(getRecordingAudio('rec-nonexistent-0000')).toBeNull()
    })
  })

  describe('loadIndex / saveIndex', () => {
    it('returns empty recordings when index does not exist', () => {
      const index = loadIndex()
      expect(index).toEqual({ recordings: [] })
    })

    it('round-trips index data', () => {
      const index = {
        recordings: [
          {
            id: 'rec-123-abcd',
            filename: 'test.webm',
            filepath: '/tmp/test.webm',
            timestamp: 1000,
            duration: 5,
            status: 'completed' as const,
            provider: 'openai',
            transcription: 'hello',
            size: 100
          }
        ]
      }

      // Ensure recordings dir exists
      getRecordingsDir()
      saveIndex(index)

      const loaded = loadIndex()
      expect(loaded).toEqual(index)
    })
  })

  describe('disk quota eviction', () => {
    const originalCap = getMaxDiskBytes()

    afterEach(() => {
      setMaxDiskBytes(originalCap)
    })

    it('evicts oldest recordings when the total exceeds maxDiskBytes', async () => {
      setMaxDiskBytes(30) // tiny cap: 30 bytes, evict down to 90% (27)

      const nowSpy = vi.spyOn(Date, 'now')
      nowSpy.mockReturnValue(1_000)
      const oldest = await saveRecording(Buffer.alloc(20), { duration: 1, provider: 'openai' })
      nowSpy.mockReturnValue(2_000)
      const middle = await saveRecording(Buffer.alloc(20), { duration: 2, provider: 'openai' })
      nowSpy.mockReturnValue(3_000)
      const newest = await saveRecording(Buffer.alloc(20), { duration: 3, provider: 'openai' })
      nowSpy.mockRestore()

      // Only the newest survives: each 20-byte save pushes total to 40 (> 30),
      // evicting the oldest until <= 27.
      const list = getRecordings()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(newest.id)

      // Evicted recordings' files are deleted from disk.
      expect(existsSync(oldest.filepath)).toBe(false)
      expect(existsSync(middle.filepath)).toBe(false)
      expect(existsSync(newest.filepath)).toBe(true)
    })

    it('never evicts the recording just saved, even if it alone exceeds the cap', async () => {
      setMaxDiskBytes(10) // cap smaller than a single recording

      const entry = await saveRecording(Buffer.alloc(50), { duration: 1, provider: 'openai' })

      expect(getRecording(entry.id)).not.toBeNull()
      expect(existsSync(entry.filepath)).toBe(true)
    })

    it('keeps all recordings when under the default cap (no eviction)', async () => {
      const a = await saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      const b = await saveRecording(Buffer.from('b'), { duration: 2, provider: 'openai' })

      expect(getRecordings()).toHaveLength(2)
      expect(existsSync(a.filepath)).toBe(true)
      expect(existsSync(b.filepath)).toBe(true)
    })
  })

  describe('ID generation format', () => {
    it('generates IDs matching the expected pattern', async () => {
      const entry = await saveRecording(Buffer.from('x'), { duration: 1, provider: 'openai' })
      expect(entry.id).toMatch(/^rec-\d+-[a-z0-9]{4}$/)
    })

    it('generates unique IDs', async () => {
      const entry1 = await saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      const entry2 = await saveRecording(Buffer.from('b'), { duration: 1, provider: 'openai' })
      expect(entry1.id).not.toBe(entry2.id)
    })
  })

  describe('corrupt index handling', () => {
    const backups = () => readdirSync(getRecordingsDir()).filter((f) => f.startsWith('index.corrupt-'))
    const indexFile = () => join(getRecordingsDir(), 'index.json')

    it('moves a truncated index aside with original bytes and survives a later save', async () => {
      const original = '{"recordings":[{"id":"rec-1","filename":"a.webm"'
      writeFileSync(indexFile(), original, 'utf-8')
      expect(loadIndex()).toEqual({ recordings: [] })
      expect(backups()).toHaveLength(1)
      expect(readFileSync(join(getRecordingsDir(), backups()[0]), 'utf-8')).toBe(original)

      await saveRecording(Buffer.from('x'), { duration: 1, provider: 'openai' })
      expect(backups()).toHaveLength(1)
      expect(readFileSync(join(getRecordingsDir(), backups()[0]), 'utf-8')).toBe(original)
      expect(getRecordings()).toHaveLength(1)
    })

    it.each(['{}', '{"recordings":5}', '[]', 'null'])('treats wrong shape %s as corrupt', (raw) => {
      writeFileSync(indexFile(), raw, 'utf-8')
      expect(loadIndex()).toEqual({ recordings: [] })
      expect(backups()).toHaveLength(1)
      expect(readFileSync(join(getRecordingsDir(), backups()[0]), 'utf-8')).toBe(raw)
    })

    it('does not create another backup on repeated loads', () => {
      writeFileSync(indexFile(), '{oops', 'utf-8')
      loadIndex()
      loadIndex()
      expect(backups()).toHaveLength(1)
    })

    it('filters entries without a string id but keeps valid ones, no backup', () => {
      const good = { id: 'rec-1', filename: 'a.webm' }
      writeFileSync(indexFile(), JSON.stringify({ recordings: [good, null, 3, {}, { id: 7 }] }), 'utf-8')
      expect(loadIndex().recordings).toEqual([good])
      expect(backups()).toHaveLength(0)
    })

    it('leaves a valid index unchanged', () => {
      const idx = { recordings: [{ id: 'rec-1' }, { id: 'rec-2' }] }
      writeFileSync(indexFile(), JSON.stringify(idx), 'utf-8')
      expect(loadIndex()).toEqual(idx)
      expect(backups()).toHaveLength(0)
    })

    it('creates no backup when the index is missing', () => {
      expect(loadIndex()).toEqual({ recordings: [] })
      expect(backups()).toHaveLength(0)
    })

    const sleeps: number[] = []
    beforeEach(() => {
      sleeps.length = 0
      setSleepSyncForTests((ms) => { sleeps.push(ms) })
    })
    afterEach(() => setSleepSyncForTests())

    const ebusy = (): never => {
      const e = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException
      e.code = 'EBUSY'
      throw e
    }
    const restoreFs = async (): Promise<void> => {
      const actual = await vi.importActual<typeof import('fs')>('fs')
      vi.mocked(readFileSync).mockImplementation(actual.readFileSync as never)
      vi.mocked(renameSync).mockImplementation(actual.renameSync as never)
      vi.mocked(copyFileSync).mockImplementation(actual.copyFileSync as never)
    }

    it('persistent read lock (EBUSY) throws, never quarantines, and a save cannot overwrite the index', async () => {
      const good = JSON.stringify({ recordings: [{ id: 'rec-1', filename: 'a.webm' }] })
      writeFileSync(indexFile(), good, 'utf-8')
      const actual = await vi.importActual<typeof import('fs')>('fs')
      vi.mocked(readFileSync).mockImplementation(((path: string, ...rest: unknown[]) => {
        if (String(path).endsWith('index.json')) ebusy()
        return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)
      }) as never)
      try {
        expect(() => loadIndex()).toThrow(IndexUnavailableError)
        await expect(saveRecording(Buffer.from('x'), { duration: 1, provider: 'openai' })).rejects.toThrow(
          IndexUnavailableError
        )
      } finally {
        await restoreFs()
      }
      expect(backups()).toHaveLength(0)
      expect(readFileSync(indexFile(), 'utf-8')).toBe(good)
    })

    it('a transient read lock is retried and succeeds', () => {
      const idx = { recordings: [{ id: 'rec-1' }] }
      writeFileSync(indexFile(), JSON.stringify(idx), 'utf-8')
      vi.mocked(readFileSync).mockImplementationOnce((() => ebusy()) as never)
      expect(loadIndex()).toEqual(idx)
      expect(backups()).toHaveLength(0)
    })

    it('read retries back off (25,50,100,200) and attempt count is unchanged', () => {
      writeFileSync(indexFile(), JSON.stringify({ recordings: [] }), 'utf-8')
      const m = vi.mocked(readFileSync)
      const before = m.mock.calls.length
      m.mockImplementation((() => ebusy()) as never)
      try {
        expect(() => loadIndex()).toThrow(IndexUnavailableError)
      } finally {
        const calls = m.mock.calls.length - before
        m.mockReset()
        expect(calls).toBe(5)
      }
      expect(sleeps).toEqual([25, 50, 100, 200])
    })

    it('saveRecording with unavailable index writes no audio file', async () => {
      writeFileSync(indexFile(), JSON.stringify({ recordings: [] }), 'utf-8')
      const actual = await vi.importActual<typeof import('fs')>('fs')
      vi.mocked(readFileSync).mockImplementation(((path: string, ...rest: unknown[]) => {
        if (String(path).endsWith('index.json')) ebusy()
        return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)
      }) as never)
      try {
        await expect(saveRecording(Buffer.from('x'), { duration: 1, provider: 'openai' })).rejects.toThrow(IndexUnavailableError)
      } finally {
        await restoreFs()
      }
      expect(readdirSync(getRecordingsDir()).filter((f) => f.endsWith('.webm'))).toHaveLength(0)
    })

    it('index write failure removes the just-written audio', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs')
      vi.mocked(renameSync).mockImplementation(((from: string, to: string) => {
        if (String(to).endsWith('index.json')) {
          const e = new Error('ENOSPC') as NodeJS.ErrnoException
          e.code = 'ENOSPC'
          throw e
        }
        return actual.renameSync(from, to)
      }) as never)
      try {
        await expect(saveRecording(Buffer.from('x'), { duration: 1, provider: 'openai' })).rejects.toThrow('ENOSPC')
      } finally {
        await restoreFs()
      }
      expect(readdirSync(getRecordingsDir()).filter((f) => f.endsWith('.webm'))).toHaveLength(0)
    })

    it('entries dropped by the id filter are backed up once to index.filtered-<ts>.json', () => {
      const original = JSON.stringify({ recordings: [{ id: 'rec-1' }, { nope: true }, null] })
      writeFileSync(indexFile(), original, 'utf-8')
      expect(loadIndex().recordings).toEqual([{ id: 'rec-1' }])
      expect(loadIndex().recordings).toEqual([{ id: 'rec-1' }])
      const f = readdirSync(getRecordingsDir()).filter((n) => n.startsWith('index.filtered-'))
      expect(f).toHaveLength(1)
      expect(readFileSync(join(getRecordingsDir(), f[0]), 'utf-8')).toBe(original)
    })

    it('corrupt index that can be neither renamed nor copied: throws and a save does not overwrite it', async () => {
      const original = '{broken'
      writeFileSync(indexFile(), original, 'utf-8')
      vi.mocked(renameSync).mockImplementation((() => ebusy()) as never)
      vi.mocked(copyFileSync).mockImplementation((() => ebusy()) as never)
      try {
        expect(() => loadIndex()).toThrow(IndexUnavailableError)
        await expect(saveRecording(Buffer.from('x'), { duration: 1, provider: 'openai' })).rejects.toThrow()
      } finally {
        await restoreFs()
      }
      expect(readFileSync(indexFile(), 'utf-8')).toBe(original)
      expect(backups()).toHaveLength(0)
    })

    it('copy-only backup (rename locked) is made once, not on every read', async () => {
      writeFileSync(indexFile(), '{broken', 'utf-8')
      const actual = await vi.importActual<typeof import('fs')>('fs')
      vi.mocked(renameSync).mockImplementation(((from: string, to: string) => {
        if (String(from).endsWith('index.json')) ebusy()
        return actual.renameSync(from, to)
      }) as never)
      try {
        expect(loadIndex()).toEqual({ recordings: [] })
        expect(loadIndex()).toEqual({ recordings: [] })
        expect(getRecordings()).toEqual([])
      } finally {
        await restoreFs()
      }
      expect(backups()).toHaveLength(1)
      expect(readFileSync(join(getRecordingsDir(), backups()[0]), 'utf-8')).toBe('{broken')
    })
  })
})
