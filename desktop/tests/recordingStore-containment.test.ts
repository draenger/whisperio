import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

// A tampered index.json can point a recording's filepath anywhere on disk.
// Every bulk path that deletes or rewrites audio (quota eviction, erase all,
// delete by date, audio migration) must leave a file outside the recordings
// folder untouched while still converging the index.

const testDir = join(tmpdir(), `whisperio-contain-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

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

import {
  saveRecording,
  getRecordings,
  getRecording,
  deleteAllRecordings,
  deleteRecording,
  readRecordingAudio,
  deleteRecordingsByDate,
  migrateAudio,
  setHistoryEncryption,
  setEncryptHistoryReader,
  setMaxDiskBytes,
  getMaxDiskBytes
} from '../src/main/recordingStore'
import { shredDataKey } from '../src/main/dataVault'

const DIR = join(testDir, 'recordings')
const INDEX = join(DIR, 'index.json')
const VICTIM = join(testDir, 'victim.webm')
const VICTIM_BYTES = 'not a recording, must survive'

let clock = 1_700_000_000_000
const savedQuota = getMaxDiskBytes()

async function seed(n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const e = await saveRecording(Buffer.from(`audio-${i}`), { duration: 1, provider: 'openai', status: 'completed' })
    ids.push(e.id)
  }
  return ids
}

/** Point one plain-index entry at a file outside the recordings folder. */
function tamper(id: string): void {
  const idx = JSON.parse(readFileSync(INDEX, 'utf-8')) as { recordings: { id: string; filepath: string }[] }
  idx.recordings.find((r) => r.id === id)!.filepath = VICTIM
  writeFileSync(INDEX, JSON.stringify(idx))
}

const victimIntact = (): boolean => existsSync(VICTIM) && readFileSync(VICTIM, 'utf-8') === VICTIM_BYTES
const localDate = (ts: number): string => {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

beforeEach(() => {
  clock += 10_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1500))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  setEncryptHistoryReader(null)
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  writeFileSync(VICTIM, VICTIM_BYTES)
  shredDataKey()
})
afterEach(() => {
  vi.restoreAllMocks()
  setMaxDiskBytes(savedQuota)
  setEncryptHistoryReader(null)
  shredDataKey()
  rmSync(testDir, { recursive: true, force: true })
})

describe('tampered filepath outside the recordings folder', () => {
  it('quota eviction drops the entry but never deletes the outside file', async () => {
    const [oldest, kept] = await seed(2)
    tamper(oldest)
    // 3 x 7 B = 21 B > 18 B quota; eviction runs down to 16 B, i.e. only the oldest goes.
    setMaxDiskBytes(18)
    const [fresh] = await seed(1)

    const ids = getRecordings().map((r) => r.id)
    expect(ids).not.toContain(oldest)
    expect(ids).toEqual(expect.arrayContaining([kept, fresh]))
    expect(victimIntact()).toBe(true)
  })

  it('erase all (encryption off) clears the index and the real audio, not the outside file', async () => {
    const [a, b] = await seed(2)
    const realFile = getRecording(b)!.filepath
    tamper(a)
    await deleteAllRecordings()

    expect(getRecordings()).toEqual([])
    expect(existsSync(realFile)).toBe(false)
    expect(victimIntact()).toBe(true)
  })

  it('delete by date drops the entry but never deletes the outside file', async () => {
    const [a] = await seed(1)
    const day = localDate(getRecording(a)!.timestamp)
    tamper(a)
    await deleteRecordingsByDate(day)

    expect(getRecordings()).toEqual([])
    expect(victimIntact()).toBe(true)
  })

  it('audio migration skips the entry and never rewrites the outside file', async () => {
    const [a, b] = await seed(2)
    tamper(a)
    await setHistoryEncryption(true)
    const res = await migrateAudio('encrypt')

    expect(res).toEqual({ converted: 1, skipped: 1, failed: 0 })
    expect(victimIntact()).toBe(true)
    expect(readFileSync(getRecording(b)!.filepath).subarray(0, 4).toString()).not.toBe('audi')
  })

  it('single delete drops the entry but never deletes the outside file', async () => {
    const [a] = await seed(1)
    tamper(a)
    expect(await deleteRecording(a)).toBe(true)
    expect(getRecording(a)).toBeNull()
    expect(victimIntact()).toBe(true)
  })

  it('playback refuses to read the outside file', async () => {
    const [a] = await seed(1)
    tamper(a)
    expect(readRecordingAudio(a)).toBeNull()
  })
})
