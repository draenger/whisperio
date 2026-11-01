import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-shred-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

// Records the order of destructive calls: key shred vs file deletion.
const h = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(`ENC:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => {
      const t = b.toString('utf-8')
      if (!t.startsWith('ENC:')) throw new Error('cannot decrypt')
      return t.slice(4)
    }
  }
}))

vi.mock('../src/main/dataVault', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/dataVault')>()
  return {
    ...real,
    shredDataKey: () => {
      h.calls.push('shred-key')
      real.shredDataKey()
    }
  }
})

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    unlinkSync: (p: string) => {
      if (String(p).endsWith('.webm')) h.calls.push('unlink-audio')
      if (String(p).endsWith('index.json')) h.calls.push('unlink-index')
      return real.unlinkSync(p)
    }
  }
})

import {
  saveRecording,
  getRecordings,
  deleteAllRecordings,
  setHistoryEncryption,
  getHistoryEncryptionStatus,
  setEncryptHistoryReader,
  resetLockedHistory,
  getEncryptionProgress,
  migrateAudio
} from '../src/main/recordingStore'
import { loadSettings } from '../src/main/settingsManager'
import { shredDataKey } from '../src/main/dataVault'

const RECORDINGS_DIR = join(testDir, 'recordings')
const INDEX = join(RECORDINGS_DIR, 'index.json')

function audioCount(): number {
  return existsSync(RECORDINGS_DIR) ? readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.webm')).length : 0
}

async function seed(): Promise<void> {
  await saveRecording(Buffer.from('audio'), {
    duration: 1,
    provider: 'openai',
    transcription: 'secret words',
    status: 'completed'
  })
}

describe('recordingStore - erase = crypto-shred, locked reset, progress (D3)', () => {
  beforeEach(() => {
    setEncryptHistoryReader(null)
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    shredDataKey()
    h.calls.length = 0
  })
  afterEach(() => {
    setEncryptHistoryReader(null)
    shredDataKey()
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('erase while encrypted destroys the key BEFORE deleting any file', async () => {
    await seed()
    await seed()
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    h.calls.length = 0
    await deleteAllRecordings()
    expect(h.calls[0]).toBe('shred-key')
    expect(h.calls).toContain('unlink-audio')
    expect(h.calls.indexOf('shred-key')).toBeLessThan(h.calls.indexOf('unlink-audio'))
    expect(h.calls.indexOf('shred-key')).toBeLessThan(h.calls.indexOf('unlink-index'))
    expect(audioCount()).toBe(0)
    expect(existsSync(INDEX)).toBe(false)
    expect(getRecordings()).toEqual([])
  })

  it('erase with encryption OFF does not shred and keeps a readable empty index', async () => {
    await seed()
    h.calls.length = 0
    await deleteAllRecordings()
    expect(h.calls).not.toContain('shred-key')
    expect(audioCount()).toBe(0)
    expect(JSON.parse(readFileSync(INDEX, 'utf-8'))).toEqual({ recordings: [] })
  })

  it('resetLockedHistory refuses when history is readable', async () => {
    await seed()
    expect(await resetLockedHistory()).toBe(false)
    expect(getRecordings()).toHaveLength(1)
  })

  it('resetLockedHistory wipes a locked history, shreds first, turns encryption OFF and starts fresh', async () => {
    await seed()
    await setHistoryEncryption(true)
    shredDataKey() // key lost while the index is sealed
    h.calls.length = 0
    expect(getHistoryEncryptionStatus().locked).toBe(true)
    expect(getEncryptionProgress().state).toBe('locked')
    expect(await resetLockedHistory()).toBe(true)
    expect(h.calls[0]).toBe('shred-key')
    expect(audioCount()).toBe(0)
    expect(existsSync(INDEX)).toBe(false)
    expect(loadSettings().encryptHistory).toBe(false)
    expect(getHistoryEncryptionStatus()).toEqual({ enabled: false, sealedOnDisk: false, locked: false })
    await seed()
    expect(getRecordings()).toHaveLength(1)
  })

  it('getEncryptionProgress counts converted audio', async () => {
    await seed()
    await seed()
    expect(getEncryptionProgress()).toEqual({ state: 'off', done: 2, total: 2 })
    await setHistoryEncryption(true)
    expect(getEncryptionProgress()).toEqual({ state: 'on', done: 0, total: 2 })
    await migrateAudio('encrypt')
    expect(getEncryptionProgress()).toEqual({ state: 'on', done: 2, total: 2 })
  })
})
