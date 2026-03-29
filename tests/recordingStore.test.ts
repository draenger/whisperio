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
  saveIndex
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
    it('creates file on disk and adds to index', () => {
      const audio = Buffer.from('fake-audio-data')
      const entry = saveRecording(audio, { duration: 5, provider: 'openai' })

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
    it('returns sorted list by timestamp descending', () => {
      const entry1 = saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      const entry2 = saveRecording(Buffer.from('b'), { duration: 2, provider: 'elevenlabs' })
      const entry3 = saveRecording(Buffer.from('c'), { duration: 3, provider: 'openai' })

      const list = getRecordings()
      expect(list).toHaveLength(3)
      // Most recent first
      expect(list[0].id).toBe(entry3.id)
      expect(list[2].id).toBe(entry1.id)
    })

    it('returns empty array when no recordings exist', () => {
      expect(getRecordings()).toEqual([])
    })
  })

  describe('getRecording', () => {
    it('returns a single recording by id', () => {
      const entry = saveRecording(Buffer.from('data'), { duration: 10, provider: 'openai' })
      const found = getRecording(entry.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(entry.id)
    })

    it('returns null for nonexistent id', () => {
      expect(getRecording('rec-nonexistent-0000')).toBeNull()
    })
  })

  describe('updateRecording', () => {
    it('merges updates into existing entry', () => {
      const entry = saveRecording(Buffer.from('data'), { duration: 5, provider: 'openai' })

      const updated = updateRecording(entry.id, {
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

    it('returns null for nonexistent id', () => {
      expect(updateRecording('rec-nonexistent-0000', { status: 'failed' })).toBeNull()
    })
  })

  describe('deleteRecording', () => {
    it('removes file and index entry', () => {
      const entry = saveRecording(Buffer.from('data'), { duration: 5, provider: 'openai' })
      expect(existsSync(entry.filepath)).toBe(true)

      const result = deleteRecording(entry.id)
      expect(result).toBe(true)
      expect(existsSync(entry.filepath)).toBe(false)
      expect(getRecording(entry.id)).toBeNull()
      expect(getRecordings()).toHaveLength(0)
    })

    it('returns false for nonexistent id', () => {
      expect(deleteRecording('rec-nonexistent-0000')).toBe(false)
    })
  })

  describe('deleteAllRecordings', () => {
    it('clears everything', () => {
      const entry1 = saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      const entry2 = saveRecording(Buffer.from('b'), { duration: 2, provider: 'openai' })

      deleteAllRecordings()

      expect(existsSync(entry1.filepath)).toBe(false)
      expect(existsSync(entry2.filepath)).toBe(false)
      expect(getRecordings()).toHaveLength(0)
    })
  })

  describe('deleteRecordingsByDate', () => {
    it('filters correctly and only deletes recordings from specified date', () => {
      const entry1 = saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })

      // Manually set timestamp to a different date
      const yesterday = new Date('2025-01-15T10:00:00Z').getTime()
      updateRecording(entry1.id, { timestamp: yesterday })

      const entry2 = saveRecording(Buffer.from('b'), { duration: 2, provider: 'openai' })

      deleteRecordingsByDate('2025-01-15')

      const remaining = getRecordings()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(entry2.id)
    })
  })

  describe('getRecordingAudio', () => {
    it('reads file back from disk', () => {
      const audio = Buffer.from('test-audio-content-12345')
      const entry = saveRecording(audio, { duration: 3, provider: 'openai' })

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

  describe('ID generation format', () => {
    it('generates IDs matching the expected pattern', () => {
      const entry = saveRecording(Buffer.from('x'), { duration: 1, provider: 'openai' })
      expect(entry.id).toMatch(/^rec-\d+-[a-z0-9]{4}$/)
    })

    it('generates unique IDs', () => {
      const entry1 = saveRecording(Buffer.from('a'), { duration: 1, provider: 'openai' })
      const entry2 = saveRecording(Buffer.from('b'), { duration: 1, provider: 'openai' })
      expect(entry1.id).not.toBe(entry2.id)
    })
  })
})
