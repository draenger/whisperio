import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-shred-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

// Records the order of destructive calls: key shred vs file deletion.
const h = vi.hoisted(() => ({ calls: [] as string[], failKeyDelete: false, failIndexRename: false, stuck: null as string | null }))

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
      return real.shredDataKey()
    }
  }
})

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    renameSync: (a: string, b: string) => {
      if (h.failIndexRename && String(a).endsWith('index.json')) throw new Error('EBUSY: locked by AV')
      return real.renameSync(a, b)
    },
    unlinkSync: (p: string) => {
      if (h.failKeyDelete && String(p).endsWith('data-vault.key')) throw new Error('EPERM')
      if (h.stuck && String(p).endsWith(h.stuck)) throw new Error('stuck by AV')
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
  sweepShreddedOrphans,
  KeyShredError,
  getEncryptionProgress,
  migrateAudio
} from '../src/main/recordingStore'
import { loadSettings } from '../src/main/settingsManager'
import { shredDataKey } from '../src/main/dataVault'
import { writeFileSync } from 'fs'

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
    h.failKeyDelete = false
    h.failIndexRename = false
    h.stuck = null
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
    expect((await resetLockedHistory()).ok).toBe(false)
    expect(getRecordings()).toHaveLength(1)
  })

  it('resetLockedHistory wipes a locked history, shreds first, turns encryption OFF and starts fresh', async () => {
    await seed()
    await setHistoryEncryption(true)
    shredDataKey() // key lost while the index is sealed
    h.calls.length = 0
    expect(getHistoryEncryptionStatus().locked).toBe(true)
    expect(getEncryptionProgress().state).toBe('locked')
    expect((await resetLockedHistory()).ok).toBe(true)
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

  it('erase aborts BEFORE deleting any file when the key delete fails, and reports it', async () => {
    await seed()
    await setHistoryEncryption(true)
    h.failKeyDelete = true
    await expect(deleteAllRecordings()).rejects.toBeInstanceOf(KeyShredError)
    expect(audioCount()).toBe(1)
    expect(existsSync(INDEX)).toBe(true)
    expect(h.calls).not.toContain('unlink-audio')
    expect(h.calls).not.toContain('unlink-index')
    h.failKeyDelete = false
    expect(getRecordings()).toHaveLength(1) // key survived, history still readable
  })

  it('reset aborts without deleting files when the key delete fails', async () => {
    await seed()
    await setHistoryEncryption(true)
    // lose the ability to open: corrupt the cached key by replacing key file content
    const keyFile = join(testDir, 'data-vault.key')
    writeFileSync(keyFile, 'garbage')
    shredDataKey() // clears cache; fails? real delete works here, so recreate the file
    writeFileSync(keyFile, 'garbage')
    h.failKeyDelete = true
    expect(getHistoryEncryptionStatus().locked).toBe(true)
    expect((await resetLockedHistory()).ok).toBe(false)
    expect(audioCount()).toBe(1)
    expect(existsSync(INDEX)).toBe(true)
    expect(loadSettings().encryptHistory).toBe(true)
  })

  it('reset is refused for an unparsable PLAIN index (no sealed data): files intact', async () => {
    await seed()
    writeFileSync(INDEX, '{ truncated plain json')
    h.failIndexRename = true // AV keeps it from being moved aside -> status reads as locked
    expect(getHistoryEncryptionStatus().locked).toBe(true)
    expect((await resetLockedHistory()).ok).toBe(false)
    expect(audioCount()).toBe(1)
    expect(existsSync(INDEX)).toBe(true)
    expect(h.calls).not.toContain('shred-key')
  })

  it('reset keeps index.json.corrupt-* backups', async () => {
    await seed()
    await setHistoryEncryption(true)
    const backup = join(RECORDINGS_DIR, 'index.json.corrupt-123')
    writeFileSync(backup, 'old')
    shredDataKey()
    expect((await resetLockedHistory()).ok).toBe(true)
    expect(existsSync(backup)).toBe(true)
    expect(existsSync(INDEX)).toBe(false)
    expect(audioCount()).toBe(0)
  })

  it('status while migrating answers from cached counters (no index read needed)', async () => {
    await seed()
    await setHistoryEncryption(true)
    const p = migrateAudio('encrypt')
    const mid = getEncryptionProgress()
    expect(['migrating', 'on']).toContain(mid.state)
    await p
    expect(getEncryptionProgress()).toEqual({ state: 'on', done: 1, total: 1 })
  })

  async function seedTwo(): Promise<string[]> {
    await seed()
    await new Promise((r) => setTimeout(r, 1100))
    await seed()
    return readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.webm'))
  }
  const ORPHANS = join(RECORDINGS_DIR, 'shredded-orphans.json')

  it('erase with one undeletable sealed audio succeeds with a warning; new key mints; orphan swept at startup', async () => {
    const files = await seedTwo()
    expect(files).toHaveLength(2)
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    h.stuck = files[0]
    const rep = await deleteAllRecordings()
    expect(rep).toEqual({ undeleted: 1 })
    expect(readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.webm'))).toEqual([files[0]])
    expect(JSON.parse(readFileSync(ORPHANS, 'utf-8')).files).toEqual([files[0]])
    // The orphan is sealed under the destroyed key: it must not block a new key.
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    await seed()
    expect(getRecordings()).toHaveLength(1)
    // Still stuck at the next start: stays listed.
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 1 })
    // Released: swept and dropped from the list.
    h.stuck = null
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    expect(existsSync(join(RECORDINGS_DIR, files[0]))).toBe(false)
    expect(existsSync(ORPHANS)).toBe(false)
    expect(getRecordings()).toHaveLength(1) // the new history is untouched
  })

  it('erase deletes audio files that are not in the index too', async () => {
    await seed()
    await setHistoryEncryption(true)
    const stray = join(RECORDINGS_DIR, 'recording-stray.webm')
    writeFileSync(stray, 'x')
    await deleteAllRecordings()
    expect(existsSync(stray)).toBe(false)
  })

  it('reset with one undeletable sealed audio succeeds with a warning and encryption can be turned ON again', async () => {
    const files = await seedTwo()
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    shredDataKey() // key lost
    h.stuck = files[1]
    const rep = await resetLockedHistory()
    expect(rep).toEqual({ ok: true, undeleted: 1 })
    expect(loadSettings().encryptHistory).toBe(false)
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    await seed()
    expect(getRecordings()).toHaveLength(1)
    h.stuck = null
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    expect(existsSync(join(RECORDINGS_DIR, files[1]))).toBe(false)
  })
})
