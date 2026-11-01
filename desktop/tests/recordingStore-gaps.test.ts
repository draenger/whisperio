import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-gaps-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const h = vi.hoisted(() => ({
  available: true,
  failRename: null as RegExp | null,
  failUnlink: null as RegExp | null,
  failWrite: null as RegExp | null
}))

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

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    renameSync: (a: string, b: string) => {
      if (h.failRename && h.failRename.test(String(a))) throw new Error('rename-denied')
      return real.renameSync(a, b)
    },
    // D1 falls back to copying the corrupt index aside when rename fails; failRename also denies
    // that copy so the "no backup possible -> refuse" path is what these tests exercise.
    copyFileSync: (a: string, b: string, ...rest: unknown[]) => {
      if (h.failRename && h.failRename.test(String(a))) throw new Error('copy-denied')
      return (real.copyFileSync as (...x: unknown[]) => void)(a, b, ...rest)
    },
    unlinkSync: (p: string) => {
      if (h.failUnlink && h.failUnlink.test(String(p))) throw new Error('unlink-denied')
      return real.unlinkSync(p)
    },
    writeFileSync: (p: string, ...rest: unknown[]) => {
      if (h.failWrite && h.failWrite.test(String(p))) throw new Error('write-denied')
      return (real.writeFileSync as (...a: unknown[]) => void)(p, ...rest)
    }
  }
})

import {
  IndexUnavailableError,
  saveRecording,
  updateRecording,
  deleteRecording,
  deleteRecordingsByDate,
  deleteAllRecordings,
  getRecordings,
  getRecording,
  readRecordingAudio,
  setHistoryEncryption,
  setEncryptHistoryReader,
  getHistoryEncryptionStatus,
  getEncryptionProgress,
  migrateAudio,
  resumeAudioMigration,
  sweepShreddedOrphans,
  sealedDataExists,
  resetLockedHistory,
  HistoryLockedError
} from '../src/main/recordingStore'
import { shredDataKey, getDataKeyForEncrypt } from '../src/main/dataVault'
import { encryptWithKeyAad, serializeEnvelope } from '../src/main/secretCrypto'
import { encryptAudio, AudioVaultError } from '../src/main/audioVault'
import { loadSettings } from '../src/main/settingsManager'

const DIR = join(testDir, 'recordings')
const INDEX = join(DIR, 'index.json')
const ORPHANS = join(DIR, 'shredded-orphans.json')
const KEYFILE = join(testDir, 'data-vault.key')

let clock = 1_700_000_000_000

async function seed(text = 'words', n = 1): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const e = await saveRecording(Buffer.from(`audio-${text}-${i}`), {
      duration: 1,
      provider: 'openai',
      transcription: `${text}-${i}`,
      status: 'completed'
    })
    ids.push(e.id)
  }
  return ids
}

function sealIndexFile(payload: string): void {
  const key = getDataKeyForEncrypt()
  const env = encryptWithKeyAad(key, payload, 'whisperio/index/v2|kid=hist-1', 'hist-1')
  env.av = 2
  mkdirSync(DIR, { recursive: true })
  writeFileSync(INDEX, serializeEnvelope(env))
}

function webms(): string[] {
  return existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.webm')) : []
}

beforeEach(() => {
  clock += 10_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1500))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  h.available = true
  h.failRename = null
  h.failUnlink = null
  h.failWrite = null
  setEncryptHistoryReader(null)
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  shredDataKey()
})
afterEach(() => {
  vi.restoreAllMocks()
  setEncryptHistoryReader(null)
  h.failRename = null
  h.failUnlink = null
  h.failWrite = null
  shredDataKey()
  rmSync(testDir, { recursive: true, force: true })
})

describe('index state: locked variants', () => {
  it.each([
    ['null payload', 'null'],
    ['object without recordings', '{"foo":1}'],
    ['recordings not an array', '{"recordings":"x"}']
  ])('sealed index that opens to %s is treated as locked, not as empty history', async (_n, payload) => {
    sealIndexFile(payload)
    const before = readFileSync(INDEX, 'utf-8')
    expect(getHistoryEncryptionStatus()).toMatchObject({ sealedOnDisk: true, locked: true })
    expect(getRecordings()).toEqual([])
    await expect(seed()).rejects.toBeInstanceOf(HistoryLockedError)
    expect(readFileSync(INDEX, 'utf-8')).toBe(before)
    expect(webms()).toEqual([])
  })

  it('unparsable index whose backup rename fails stays locked (not sealed) and is never overwritten', async () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(INDEX, '{ not json')
    h.failRename = /index\.json$/
    expect(getHistoryEncryptionStatus()).toMatchObject({ sealedOnDisk: false, locked: true })
    await expect(seed()).rejects.toBeInstanceOf(IndexUnavailableError)
    await expect(deleteAllRecordings()).rejects.toBeInstanceOf(IndexUnavailableError)
    expect(readFileSync(INDEX, 'utf-8')).toBe('{ not json')
    // plain-but-unparsable is not "lost key" data: reset must refuse and delete nothing
    expect(await resetLockedHistory()).toEqual({ ok: false, undeleted: 0 })
    expect(readFileSync(INDEX, 'utf-8')).toBe('{ not json')
  })

  it('status survives an encryptHistory reader that throws (reports enabled=false)', () => {
    setEncryptHistoryReader(() => {
      throw new Error('settings unreadable')
    })
    expect(getHistoryEncryptionStatus().enabled).toBe(false)
    expect(getEncryptionProgress().state).toBe('off')
  })
})

describe('write path failures', () => {
  it('saveRecording removes the just-written audio when the index cannot be saved', async () => {
    h.failRename = /index\.json\.\d+\.\d+\.tmp$/
    await expect(seed()).rejects.toThrow('rename-denied')
    expect(webms()).toEqual([])
    expect(existsSync(INDEX)).toBe(false)
    expect(readdirSync(DIR).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('setHistoryEncryption(true) rolls the flag back when the index rewrite fails', async () => {
    await seed()
    const plainBefore = readFileSync(INDEX, 'utf-8')
    h.failRename = /index\.json\.\d+\.\d+\.tmp$/
    await expect(setHistoryEncryption(true)).rejects.toThrow('rename-denied')
    h.failRename = null
    expect(loadSettings().encryptHistory).toBeFalsy()
    expect(readFileSync(INDEX, 'utf-8')).toBe(plainBefore)
  })

  it('setHistoryEncryption(false) failing restores flag ON and keeps the sealed index', async () => {
    await seed()
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    const sealedBefore = readFileSync(INDEX, 'utf-8')
    h.failRename = /index\.json\.\d+\.\d+\.tmp$/
    await expect(setHistoryEncryption(false)).rejects.toThrow('rename-denied')
    h.failRename = null
    expect(loadSettings().encryptHistory).toBe(true)
    expect(readFileSync(INDEX, 'utf-8')).toBe(sealedBefore)
    expect(getRecordings()).toHaveLength(1)
  })

  it('setHistoryEncryption(true) with an unusable key file reports "locked" and changes nothing', async () => {
    await seed()
    writeFileSync(KEYFILE, 'garbage')
    const before = readFileSync(INDEX, 'utf-8')
    expect(await setHistoryEncryption(true)).toEqual({ ok: false, reason: 'locked' })
    expect(loadSettings().encryptHistory).toBeFalsy()
    expect(readFileSync(INDEX, 'utf-8')).toBe(before)
    expect(readFileSync(KEYFILE, 'utf-8')).toBe('garbage')
  })

  it('setHistoryEncryption(true) with the vault unavailable reports the reason', async () => {
    h.available = false
    expect(await setHistoryEncryption(true)).toEqual({ ok: false, reason: 'unavailable' })
    expect(existsSync(KEYFILE)).toBe(false)
  })
})

describe('plain-mode record operations', () => {
  it('delete/update of unknown ids return false/null and tombstones hide entries', async () => {
    const [a, b] = await seed('x', 2)
    expect(await deleteRecording('nope')).toBe(false)
    expect(await updateRecording('nope', { transcription: 'z' })).toBeNull()
    expect(await deleteRecording(a)).toBe(true)
    expect(await deleteRecording(a)).toBe(false) // already tombstoned
    expect(await updateRecording(a, { transcription: 'z' })).toBeNull()
    expect(getRecording(a)).toBeNull()
    expect(getRecordings().map((r) => r.id)).toEqual([b])
  })

  it('delete converges (tombstone written) even when the audio file cannot be unlinked', async () => {
    const [a] = await seed()
    h.failUnlink = /\.webm$/
    expect(await deleteRecording(a)).toBe(true)
    h.failUnlink = null
    expect(getRecording(a)).toBeNull()
    expect(webms()).toHaveLength(1)
  })

  it('deleteRecordingsByDate drops only entries of that local date and unlinks their audio', async () => {
    const ids = await seed('d', 2)
    const day = new Date(getRecording(ids[0])!.timestamp)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const dateStr = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    await deleteRecordingsByDate('1999-01-01')
    expect(getRecordings()).toHaveLength(2)
    await deleteRecordingsByDate(dateStr)
    expect(getRecordings()).toEqual([])
    expect(webms()).toEqual([])
  })

  it('deleteRecordingsByDate rejects on a locked index and keeps files', async () => {
    await seed()
    shredDataKey()
    await setHistoryEncryption(true).catch(() => undefined)
    writeFileSync(INDEX, '{ bad')
    h.failRename = /index\.json$/
    await expect(deleteRecordingsByDate('2000-01-01')).rejects.toBeInstanceOf(IndexUnavailableError)
    expect(webms()).toHaveLength(1)
  })

  it('erase with encryption OFF converges when an audio file cannot be unlinked', async () => {
    await seed('e', 2)
    h.failUnlink = /\.webm$/
    expect(await deleteAllRecordings()).toEqual({ undeleted: 0 })
    h.failUnlink = null
    expect(JSON.parse(readFileSync(INDEX, 'utf-8'))).toEqual({ recordings: [] })
  })
})

describe('readRecordingAudio', () => {
  it('returns null for an unknown id and for an indexed entry whose file vanished', async () => {
    const [a] = await seed()
    expect(readRecordingAudio('unknown')).toBeNull()
    const entry = getRecording(a)!
    rmSync(entry.filepath)
    expect(readRecordingAudio(a)).toBeNull()
  })

  it('throws a clear AudioVaultError when sealed audio is read and the key is gone', async () => {
    const [a] = await seed()
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    await setHistoryEncryption(false)
    shredDataKey()
    expect(() => readRecordingAudio(a)).toThrow(AudioVaultError)
    expect(() => readRecordingAudio(a)).toThrow(/key is unavailable/)
  })

  it('refuses sealed audio copied under another record id (AAD binds the id)', async () => {
    const [a, b] = await seed('bind', 2)
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    const ea = getRecording(a)!
    const eb = getRecording(b)!
    writeFileSync(eb.filepath, readFileSync(ea.filepath))
    expect(readRecordingAudio(a)!.toString()).toBe('audio-bind-0')
    expect(() => readRecordingAudio(b)).toThrow(AudioVaultError)
  })
})

describe('migrateAudio paths', () => {
  it('returns zeros on a locked index and touches nothing', async () => {
    sealIndexFile('{"recordings":[]}')
    shredDataKey()
    expect(await migrateAudio('encrypt')).toEqual({ converted: 0, skipped: 0, failed: 0 })
    expect(getEncryptionProgress()).toEqual({ state: 'locked', done: 0, total: 0 })
  })

  it('encrypt with the vault unavailable counts every live recording as failed and leaves plaintext', async () => {
    const ids = await seed('v', 2)
    await deleteRecording(ids[1])
    setEncryptHistoryReader(() => true)
    h.available = false
    expect(await migrateAudio('encrypt')).toEqual({ converted: 0, skipped: 0, failed: 1 })
    expect(readFileSync(getRecording(ids[0])!.filepath).toString()).toBe('audio-v-0')
  })

  it('decrypt with the key gone counts failures and leaves the sealed files', async () => {
    const ids = await seed('k', 2)
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    await setHistoryEncryption(false)
    shredDataKey()
    expect(await migrateAudio('decrypt')).toEqual({ converted: 0, skipped: 0, failed: 2 })
    expect(readFileSync(getRecording(ids[0])!.filepath).subarray(0, 8).toString()).toBe('WHSPAUD1')
  })

  it('direction flip: encrypt is skipped when the flag is OFF, decrypt is skipped when the flag is ON', async () => {
    await seed('f', 2)
    expect(await migrateAudio('encrypt')).toEqual({ converted: 0, skipped: 2, failed: 0 })
    setEncryptHistoryReader(() => true)
    expect(await migrateAudio('decrypt')).toEqual({ converted: 0, skipped: 2, failed: 0 })
    for (const r of getRecordings()) {
      expect(readFileSync(r.filepath).subarray(0, 8).toString()).not.toBe('WHSPAUD1')
    }
  })

  it('decrypt skips a sealed index (history still encrypted) and already-plain files', async () => {
    await seed('s', 1)
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    expect(await migrateAudio('decrypt')).toEqual({ converted: 0, skipped: 1, failed: 0 })
    await setHistoryEncryption(false)
    expect(await migrateAudio('decrypt')).toEqual({ converted: 1, skipped: 0, failed: 0 })
    expect(await migrateAudio('decrypt')).toEqual({ converted: 0, skipped: 1, failed: 0 })
    expect(readRecordingAudio(getRecordings()[0].id)!.toString()).toBe('audio-s-0')
  })

  it('a missing audio file is skipped, a corrupt sealed file fails alone, the rest converts', async () => {
    const ids = await seed('m', 3)
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    await setHistoryEncryption(false)
    rmSync(getRecording(ids[0])!.filepath)
    const bad = getRecording(ids[1])!.filepath
    const buf = readFileSync(bad)
    buf[buf.length - 1] ^= 1
    writeFileSync(bad, buf)
    const res = await migrateAudio('decrypt')
    expect(res).toEqual({ converted: 1, skipped: 1, failed: 1 })
    expect(readFileSync(bad).equals(buf)).toBe(true) // failed file untouched
    expect(readRecordingAudio(ids[2])!.toString()).toBe('audio-m-2')
  })

  it('encrypt: a write failure keeps the original plaintext, removes .mig.tmp and counts failed', async () => {
    const [a] = await seed('w')
    setEncryptHistoryReader(() => true)
    h.failRename = /\.mig\.tmp$/
    expect(await migrateAudio('encrypt')).toEqual({ converted: 0, skipped: 0, failed: 1 })
    h.failRename = null
    expect(readFileSync(getRecording(a)!.filepath).toString()).toBe('audio-w-0')
    expect(readdirSync(DIR).filter((f) => f.includes('.mig.tmp'))).toEqual([])
  })

  it('encrypt is idempotent for an already sealed file and reports a wrong-key sealed file as failed', async () => {
    const [a, b] = await seed('i', 2)
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
    expect(await migrateAudio('encrypt')).toEqual({ converted: 0, skipped: 2, failed: 0 })
    writeFileSync(getRecording(b)!.filepath, encryptAudio(Buffer.alloc(32, 7), Buffer.from('x'), b))
    expect(await migrateAudio('encrypt')).toEqual({ converted: 0, skipped: 1, failed: 1 })
    expect(readRecordingAudio(a)!.toString()).toBe('audio-i-0')
  })

  it('a second call for the opposite direction runs after the first and the last intent wins', async () => {
    await seed('o', 3)
    await setHistoryEncryption(true)
    const first = migrateAudio('encrypt')
    expect(getEncryptionProgress().state).toBe('migrating')
    await setHistoryEncryption(false)
    const second = migrateAudio('decrypt')
    await Promise.all([first, second])
    for (const r of getRecordings()) {
      expect(readFileSync(r.filepath).subarray(0, 8).toString()).not.toBe('WHSPAUD1')
    }
    expect(getEncryptionProgress().state).toBe('off')
  })

  it('sweeps leaked tmp files at the start of a run', async () => {
    await seed()
    writeFileSync(join(DIR, 'recording-x.webm.mig.tmp'), 'leak')
    writeFileSync(join(DIR, 'recording-y.webm.tmp'), 'leak')
    writeFileSync(join(DIR, 'keep.json'), '{}')
    await migrateAudio('decrypt')
    expect(readdirSync(DIR).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(existsSync(join(DIR, 'keep.json'))).toBe(true)
  })
})

describe('resumeAudioMigration', () => {
  it('returns null on a locked index', async () => {
    sealIndexFile('{"recordings":[]}')
    shredDataKey()
    expect(await resumeAudioMigration()).toBeNull()
  })

  it('does nothing when the flag is OFF but the index is still sealed (sticky sealing)', async () => {
    await seed()
    await setHistoryEncryption(true)
    setEncryptHistoryReader(() => false)
    expect(await resumeAudioMigration()).toBeNull()
  })

  it('flag ON encrypts, flag OFF + plain index decrypts', async () => {
    await seed('r', 2)
    setEncryptHistoryReader(() => true)
    expect(await resumeAudioMigration()).toEqual({ converted: 2, skipped: 0, failed: 0 })
    setEncryptHistoryReader(() => false)
    // the index was never rewritten sealed (reader seam only), so flag OFF restores plaintext
    expect(await resumeAudioMigration()).toEqual({ converted: 2, skipped: 0, failed: 0 })
    expect(readRecordingAudio(getRecordings()[0].id)!.toString()).toMatch(/^audio-r-/)
  })

  it('never throws: a reader that blows up yields null', async () => {
    await seed()
    setEncryptHistoryReader(() => {
      throw new Error('boom')
    })
    expect(await resumeAudioMigration()).toBeNull()
  })
})

describe('getEncryptionProgress counters', () => {
  it('counts only live, existing files and compares each to the desired state', async () => {
    const ids = await seed('p', 4)
    await deleteRecording(ids[3])
    rmSync(getRecording(ids[2])!.filepath)
    expect(getEncryptionProgress()).toEqual({ state: 'off', done: 2, total: 2 })
    setEncryptHistoryReader(() => true)
    expect(getEncryptionProgress()).toEqual({ state: 'on', done: 0, total: 2 })
    await migrateAudio('encrypt')
    expect(getEncryptionProgress()).toEqual({ state: 'on', done: 2, total: 2 })
  })
})

describe('sealedDataExists', () => {
  it('false for an empty or missing recordings dir and for a plain index', async () => {
    expect(sealedDataExists()).toBe(false)
    await seed()
    expect(sealedDataExists()).toBe(false)
  })

  it('true for a sealed index, and for an unparsable index that still looks like an envelope', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(INDEX, '{"v":1,"alg":"aes-256-gcm","iv":"x","ct":"abc","tag":')
    expect(sealedDataExists()).toBe(true)
    writeFileSync(INDEX, 'total garbage')
    expect(sealedDataExists()).toBe(false)
  })

  it('true for a WHSPAUD audio file with a plain index; sealed .tmp files do not count', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(INDEX, '{"recordings":[]}')
    writeFileSync(join(DIR, 'a.webm.tmp'), encryptAudio(Buffer.alloc(32, 1), Buffer.from('x'), 'a'))
    expect(sealedDataExists()).toBe(false)
    writeFileSync(join(DIR, 'a.webm'), encryptAudio(Buffer.alloc(32, 1), Buffer.from('x'), 'a'))
    expect(sealedDataExists()).toBe(true)
  })

  it('ignores files and index.json listed as shredded orphans', () => {
    mkdirSync(DIR, { recursive: true })
    sealIndexFile('{"recordings":[]}')
    writeFileSync(join(DIR, 'a.webm'), encryptAudio(Buffer.alloc(32, 1), Buffer.from('x'), 'a'))
    expect(sealedDataExists()).toBe(true)
    writeFileSync(ORPHANS, JSON.stringify({ files: ['index.json', 'a.webm'] }))
    expect(sealedDataExists()).toBe(false)
  })

  it('blocks minting a new key while sealed audio exists and the key file is gone', async () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'a.webm'), encryptAudio(Buffer.alloc(32, 1), Buffer.from('x'), 'a'))
    expect(() => getDataKeyForEncrypt()).toThrow(/refusing to mint/)
    expect(existsSync(KEYFILE)).toBe(false)
  })
})

describe('shred failure paths and orphan sweep', () => {
  async function encryptedWithTwo(): Promise<void> {
    await seed('z', 2)
    await setHistoryEncryption(true)
    await migrateAudio('encrypt')
  }

  it('index.json undeletable after the key shred: replaced by an empty plain index, nothing orphaned', async () => {
    await encryptedWithTwo()
    h.failUnlink = /index\.json$/
    const res = await deleteAllRecordings()
    h.failUnlink = null
    expect(res).toEqual({ undeleted: 0 })
    expect(existsSync(KEYFILE)).toBe(false)
    expect(webms()).toEqual([])
    expect(JSON.parse(readFileSync(INDEX, 'utf-8'))).toEqual({ recordings: [] })
    expect(getRecordings()).toEqual([])
    expect(existsSync(ORPHANS)).toBe(false)
  })

  it('index.json undeletable AND not replaceable: reported, listed as orphan, swept once it can go', async () => {
    await encryptedWithTwo()
    h.failUnlink = /index\.json$/
    h.failRename = /index\.json\.\d+\.\d+\.tmp$/
    const res = await deleteAllRecordings()
    expect(res).toEqual({ undeleted: 1 })
    expect(JSON.parse(readFileSync(ORPHANS, 'utf-8')).files).toEqual(['index.json'])
    expect(sealedDataExists()).toBe(false) // orphaned sealed index must not block a new key
    // still stuck: stays listed
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 1 })
    expect(existsSync(INDEX)).toBe(true)
    h.failUnlink = null
    h.failRename = null
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    expect(existsSync(INDEX)).toBe(false)
    expect(existsSync(ORPHANS)).toBe(false)
  })

  it('several undeletable audio files are all reported, listed once each and retried', async () => {
    await encryptedWithTwo()
    h.failUnlink = /\.webm$/
    const res = await deleteAllRecordings()
    expect(res.undeleted).toBe(2)
    const listed: string[] = JSON.parse(readFileSync(ORPHANS, 'utf-8')).files
    expect(new Set(listed).size).toBe(2)
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 2 })
    h.failUnlink = null
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    expect(webms()).toEqual([])
  })

  it('sweep with no orphan list is a no-op; entries whose file is already gone are dropped', () => {
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    mkdirSync(DIR, { recursive: true })
    writeFileSync(ORPHANS, JSON.stringify({ files: ['gone.webm'] }))
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    expect(existsSync(ORPHANS)).toBe(false)
  })

  it('sweep tolerates a corrupt or wrongly shaped orphan list and deletes nothing', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'victim.webm'), 'x')
    writeFileSync(ORPHANS, '{ not json')
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    writeFileSync(ORPHANS, JSON.stringify({ files: 'victim.webm' }))
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    writeFileSync(ORPHANS, JSON.stringify({ files: [42, null, '', 'victim.txt', 'a/../victim.webm'] }))
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    expect(existsSync(join(DIR, 'victim.webm'))).toBe(true)
  })

  it('sweep never removes a healthy new index.json listed as an orphan', async () => {
    await seed()
    writeFileSync(ORPHANS, JSON.stringify({ files: ['index.json'] }))
    expect(sweepShreddedOrphans()).toEqual({ undeleted: 0 })
    expect(existsSync(INDEX)).toBe(true)
    expect(getRecordings()).toHaveLength(1)
  })

  it('resetLockedHistory with sealed audio but a plain unlockable index is refused; with lost key it wipes', async () => {
    await encryptedWithTwo()
    expect(await resetLockedHistory()).toEqual({ ok: false, undeleted: 0 })
    expect(webms()).toHaveLength(2)
    shredDataKey()
    const res = await resetLockedHistory()
    expect(res).toEqual({ ok: true, undeleted: 0 })
    expect(webms()).toEqual([])
    expect(loadSettings().encryptHistory).toBe(false)
    expect(getHistoryEncryptionStatus()).toMatchObject({ locked: false, sealedOnDisk: false })
  })

  it('shredDataKey reports failure (false) when the key file cannot be deleted and (true) when absent', () => {
    expect(shredDataKey()).toBe(true) // nothing to delete
    getDataKeyForEncrypt()
    h.failUnlink = /data-vault\.key$/
    expect(shredDataKey()).toBe(false)
    expect(existsSync(KEYFILE)).toBe(true)
    h.failUnlink = null
    expect(shredDataKey()).toBe(true)
    expect(existsSync(KEYFILE)).toBe(false)
  })
})
