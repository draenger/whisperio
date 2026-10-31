import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-enc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const h = vi.hoisted(() => ({ available: true }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  safeStorage: {
    isEncryptionAvailable: () => h.available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(`ENC:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => {
      const t = b.toString('utf-8')
      if (!t.startsWith('ENC:')) throw new Error('cannot decrypt')
      return t.slice(4)
    }
  }
}))

import {
  saveRecording,
  updateRecording,
  getRecordings,
  getRecording,
  deleteRecording,
  deleteAllRecordings,
  deleteRecordingsByDate,
  setHistoryEncryption,
  getHistoryEncryptionStatus,
  setEncryptHistoryReader,
  HistoryLockedError
} from '../src/main/recordingStore'
import { loadSettings } from '../src/main/settingsManager'
import { shredDataKey } from '../src/main/dataVault'

const RECORDINGS_DIR = join(testDir, 'recordings')
const INDEX = join(RECORDINGS_DIR, 'index.json')
const SECRET = 'my-very-secret-transcript-zebra-42'

function audioCount(): number {
  return existsSync(RECORDINGS_DIR)
    ? readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.webm')).length
    : 0
}

async function seed(): Promise<string> {
  const rec = await saveRecording(Buffer.from('audio'), {
    duration: 1,
    provider: 'openai',
    transcription: SECRET,
    status: 'completed'
  })
  return rec.id
}

describe('recordingStore - sealed index', () => {
  beforeEach(() => {
    h.available = true
    setEncryptHistoryReader(null)
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    shredDataKey()
  })
  afterEach(() => {
    setEncryptHistoryReader(null)
    shredDataKey()
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('OFF writes plain JSON with the historical { recordings } shape', async () => {
    await seed()
    const parsed = JSON.parse(readFileSync(INDEX, 'utf-8'))
    expect(Array.isArray(parsed.recordings)).toBe(true)
    expect(parsed.recordings[0].transcription).toBe(SECRET)
    expect(parsed.iv).toBeUndefined()
    expect(getHistoryEncryptionStatus()).toEqual({ enabled: false, sealedOnDisk: false, locked: false })
  })

  it('ON writes an envelope that does not contain the transcript', async () => {
    const id = await seed()
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    const raw = readFileSync(INDEX, 'utf-8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain(id)
    const parsed = JSON.parse(raw)
    expect(parsed.recordings).toBeUndefined()
    expect(parsed.alg).toBe('AES-256-GCM')
    expect(typeof parsed.iv).toBe('string')
    expect(typeof parsed.ct).toBe('string')
    expect(typeof parsed.tag).toBe('string')
    expect(loadSettings().encryptHistory).toBe(true)
    expect(getHistoryEncryptionStatus()).toEqual({ enabled: true, sealedOnDisk: true, locked: false })
  })

  it('round-trips getRecordings/getRecording/updateRecording with ON', async () => {
    await setHistoryEncryption(true)
    const id = await seed()
    expect(readFileSync(INDEX, 'utf-8')).not.toContain(SECRET)
    expect(getRecordings().map((r) => r.id)).toEqual([id])
    expect(getRecording(id)?.transcription).toBe(SECRET)
    const updated = await updateRecording(id, { cleanedText: 'cleaned-text-xyz' })
    expect(updated?.cleanedText).toBe('cleaned-text-xyz')
    expect(getRecording(id)?.cleanedText).toBe('cleaned-text-xyz')
    expect(readFileSync(INDEX, 'utf-8')).not.toContain('cleaned-text-xyz')
    expect(await deleteRecording(id)).toBe(true)
    expect(getRecordings()).toEqual([])
  })

  it('switching ON then OFF restores plain JSON with identical entries', async () => {
    await seed()
    const before = JSON.parse(readFileSync(INDEX, 'utf-8'))
    await setHistoryEncryption(true)
    expect(JSON.parse(readFileSync(INDEX, 'utf-8')).recordings).toBeUndefined()
    expect(await setHistoryEncryption(false)).toEqual({ ok: true })
    const after = JSON.parse(readFileSync(INDEX, 'utf-8'))
    expect(after).toEqual(before)
    expect(loadSettings().encryptHistory).toBe(false)
    expect(getHistoryEncryptionStatus().sealedOnDisk).toBe(false)
  })

  it('locked: sealed index + shredded key -> empty reads, status.locked, every write rejects, bytes unchanged', async () => {
    await setHistoryEncryption(true)
    const id = await seed()
    const sealedBytes = readFileSync(INDEX)
    const audioBefore = audioCount()
    shredDataKey()

    expect(getRecordings()).toEqual([])
    expect(getRecording(id)).toBeNull()
    expect(getHistoryEncryptionStatus()).toMatchObject({ sealedOnDisk: true, locked: true })

    await expect(
      saveRecording(Buffer.from('a2'), { duration: 1, provider: 'openai' })
    ).rejects.toBeInstanceOf(HistoryLockedError)
    await expect(updateRecording(id, { cleanedText: 'x' })).rejects.toBeInstanceOf(HistoryLockedError)
    await expect(deleteRecording(id)).rejects.toBeInstanceOf(HistoryLockedError)
    await expect(deleteAllRecordings()).rejects.toBeInstanceOf(HistoryLockedError)
    await expect(deleteRecordingsByDate('2000-01-01')).rejects.toBeInstanceOf(HistoryLockedError)

    expect(readFileSync(INDEX).equals(sealedBytes)).toBe(true)
    expect(audioCount()).toBe(audioBefore) // no orphan audio, nothing deleted
  })

  it('locked: setHistoryEncryption refuses with reason "locked" in both directions', async () => {
    await setHistoryEncryption(true)
    await seed()
    const sealedBytes = readFileSync(INDEX)
    shredDataKey()
    expect(await setHistoryEncryption(false)).toEqual({ ok: false, reason: 'locked' })
    expect(await setHistoryEncryption(true)).toEqual({ ok: false, reason: 'locked' })
    expect(readFileSync(INDEX).equals(sealedBytes)).toBe(true)
  })

  it('tampered ciphertext -> locked, file untouched', async () => {
    await setHistoryEncryption(true)
    const id = await seed()
    const env = JSON.parse(readFileSync(INDEX, 'utf-8'))
    const ct = Buffer.from(env.ct, 'base64')
    ct[0] = ct[0] ^ 0xff
    env.ct = ct.toString('base64')
    writeFileSync(INDEX, JSON.stringify(env), 'utf-8')
    const tamperedBytes = readFileSync(INDEX)

    expect(getRecordings()).toEqual([])
    expect(getHistoryEncryptionStatus().locked).toBe(true)
    await expect(updateRecording(id, { cleanedText: 'x' })).rejects.toBeInstanceOf(HistoryLockedError)
    expect(readFileSync(INDEX).equals(tamperedBytes)).toBe(true)
  })

  it('setHistoryEncryption(true) with vault unavailable -> "unavailable", flag stays false, file stays plain', async () => {
    await seed()
    const plainBytes = readFileSync(INDEX)
    h.available = false
    expect(await setHistoryEncryption(true)).toEqual({ ok: false, reason: 'unavailable' })
    expect(loadSettings().encryptHistory).toBe(false)
    expect(readFileSync(INDEX).equals(plainBytes)).toBe(true)
    expect(getRecordings()).toHaveLength(1)
  })

  it('flag ON but vault becomes unavailable: save fails closed instead of writing plain', async () => {
    await setHistoryEncryption(true)
    const id = await seed()
    const sealedBytes = readFileSync(INDEX)
    h.available = false
    await expect(updateRecording(id, { cleanedText: 'leak?' })).rejects.toThrow()
    expect(readFileSync(INDEX).equals(sealedBytes)).toBe(true)
  })

  it('flag reader is injectable: saveIndex seals when the injected reader says ON', async () => {
    setEncryptHistoryReader(() => true)
    await seed()
    expect(readFileSync(INDEX, 'utf-8')).not.toContain(SECRET)
    expect(getHistoryEncryptionStatus().enabled).toBe(true)
  })

  it('sealing is sticky: flag lost (settings reset) does not downgrade a sealed index to plain', async () => {
    await setHistoryEncryption(true)
    const id = await seed()
    setEncryptHistoryReader(() => false) // e.g. corrupt settings.json reset to defaults
    await updateRecording(id, { cleanedText: 'edited' })
    const raw = readFileSync(INDEX, 'utf-8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('edited')
    expect(getRecording(id)?.cleanedText).toBe('edited')
    // The explicit switch is still the only way back to plain.
    expect(await setHistoryEncryption(false)).toEqual({ ok: true })
    expect(readFileSync(INDEX, 'utf-8')).toContain(SECRET)
  })

  it('unparseable index is moved aside as .corrupt-<ts> and never overwritten', async () => {
    mkdirSync(RECORDINGS_DIR, { recursive: true })
    writeFileSync(INDEX, '{"v":1,"alg":"aes-256-gcm","iv":"tru', 'utf-8')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(getRecordings()).toEqual([])
      const backups = readdirSync(RECORDINGS_DIR).filter((f) => f.startsWith('index.json.corrupt-'))
      expect(backups).toHaveLength(1)
      expect(readFileSync(join(RECORDINGS_DIR, backups[0]), 'utf-8')).toBe('{"v":1,"alg":"aes-256-gcm","iv":"tru')
      await seed()
      expect(getRecordings()).toHaveLength(1)
    } finally {
      err.mockRestore()
    }
  })
})
