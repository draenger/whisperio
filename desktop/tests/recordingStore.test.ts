import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir)
  }
}))

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
})
