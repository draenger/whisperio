import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-l4l5-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

// Instrument fs: record which paths got zero-overwrites; inject pin (hard link) failures.
const h = vi.hoisted(() => ({
  fdPath: new Map<number, string>(),
  zeroed: [] as string[],
  failLink: false,
  failWrite: false
}))

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

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    openSync: (p: string, ...rest: unknown[]) => {
      const fd = (real.openSync as (...a: unknown[]) => number)(p, ...rest)
      h.fdPath.set(fd, String(p))
      return fd
    },
    writeSync: (fd: number, buf: Buffer, ...rest: unknown[]) => {
      const zero = Buffer.isBuffer(buf) && buf.length > 0 && buf.every((b) => b === 0)
      if (zero && h.failWrite) throw new Error('EIO')
      if (zero) h.zeroed.push(h.fdPath.get(fd) ?? '?')
      return (real.writeSync as (...a: unknown[]) => number)(fd, buf, ...rest)
    },
    linkSync: (a: string, b: string) => {
      if (h.failLink) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      return real.linkSync(a, b)
    }
  }
})

import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, openSync, readSync, closeSync } from 'fs'
import {
  saveRecording,
  getRecordings,
  readRecordingAudio,
  setHistoryEncryption,
  setEncryptHistoryReader,
  migrateAudio,
  deleteAllRecordings,
  resetLockedHistory,
  saveIndex,
  loadIndex
} from '../src/main/recordingStore'
import { shredDataKey } from '../src/main/dataVault'
import { WIPE_SUFFIX } from '../src/main/secureDelete'

const DIR = join(testDir, 'recordings')
const INDEX = join(DIR, 'index.json')
const SECRET = 'my-very-secret-transcript-zebra-42'

async function seed(audio = 'plain-audio-bytes'): Promise<string> {
  const rec = await saveRecording(Buffer.from(audio), {
    duration: 1,
    provider: 'openai',
    transcription: SECRET,
    status: 'completed'
  })
  return rec.id
}

const pins = (): string[] => readdirSync(DIR).filter((f) => f.endsWith(WIPE_SUFFIX))
const zeroedNames = (): string[] => h.zeroed.map((p) => p.split(/[\\/]/).pop()!)

describe('recordingStore - secure deletion of migrated plaintext (L4) + sealed backups (L5)', () => {
  beforeEach(() => {
    setEncryptHistoryReader(null)
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    shredDataKey()
    h.fdPath.clear()
    h.zeroed.length = 0
    h.failLink = false
    h.failWrite = false
  })
  afterEach(() => {
    setEncryptHistoryReader(null)
    shredDataKey()
    h.failLink = h.failWrite = false
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('encryption ON overwrites the replaced plaintext index before unlinking it', async () => {
    await seed()
    h.zeroed.length = 0
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    expect(zeroedNames()).toContain(`index.json${WIPE_SUFFIX}`)
    expect(readFileSync(INDEX, 'utf-8')).not.toContain(SECRET)
    expect(pins()).toEqual([])
    expect(getRecordings()[0].transcription).toBe(SECRET)
  })

  it.skipIf(process.platform === 'win32')('the old plaintext index inode really holds zeros afterwards', async () => {
    await seed()
    const len = readFileSync(INDEX).length
    const fd = openSync(INDEX, 'r') // holds the OLD inode across the rename
    try {
      await setHistoryEncryption(true)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, 0)
      expect(buf.every((b) => b === 0)).toBe(true)
    } finally {
      closeSync(fd)
    }
  })

  it('saves while already sealed, or with encryption OFF, do not wipe (nothing plaintext replaced)', async () => {
    await seed()
    await seed()
    expect(zeroedNames()).toEqual([])
    await setHistoryEncryption(true)
    h.zeroed.length = 0
    await seed()
    expect(zeroedNames()).toEqual([])
  })

  it('flag ON but index still plain (crash after flag write): the next save wipes the plaintext', async () => {
    await seed()
    setEncryptHistoryReader(() => true)
    h.zeroed.length = 0
    saveIndex(loadIndex())
    expect(zeroedNames()).toContain(`index.json${WIPE_SUFFIX}`)
    expect(readFileSync(INDEX, 'utf-8')).not.toContain(SECRET)
  })

  it('audio encrypt migration overwrites each replaced plaintext clip; decrypt does not wipe', async () => {
    const id = await seed('PLAINTEXT-AUDIO-1')
    await seed('PLAINTEXT-AUDIO-2')
    await setHistoryEncryption(true)
    h.zeroed.length = 0
    const r = await migrateAudio('encrypt')
    expect(r.converted).toBe(2)
    expect(zeroedNames().filter((n) => n.endsWith(`.webm${WIPE_SUFFIX}`))).toHaveLength(2)
    expect(pins()).toEqual([])
    expect(readRecordingAudio(id)!.toString()).toBe('PLAINTEXT-AUDIO-1')

    await setHistoryEncryption(false)
    h.zeroed.length = 0
    const d = await migrateAudio('decrypt')
    expect(d.converted).toBe(2)
    expect(zeroedNames()).toEqual([])
    expect(readRecordingAudio(id)!.toString()).toBe('PLAINTEXT-AUDIO-1')
  })

  it('no hard-link support: migration still completes (plain replace, no wipe, no throw)', async () => {
    const id = await seed('PLAINTEXT-AUDIO')
    h.failLink = true
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    expect((await migrateAudio('encrypt')).converted).toBe(1)
    expect(readFileSync(INDEX, 'utf-8')).not.toContain(SECRET)
    expect(readRecordingAudio(id)!.toString()).toBe('PLAINTEXT-AUDIO')
    expect(pins()).toEqual([])
  })

  it('overwrite I/O failure never blocks the migration (plaintext still unlinked)', async () => {
    const id = await seed('PLAINTEXT-AUDIO')
    writeFileSync(join(DIR, 'index.json.corrupt-7'), `{"recordings":[{"transcription":"${SECRET}"`)
    h.failWrite = true
    expect(await setHistoryEncryption(true)).toEqual({ ok: true, sealedBackups: 1, plainBackupsLeft: 0 })
    expect((await migrateAudio('encrypt')).converted).toBe(1)
    expect(pins()).toEqual([])
    expect(existsSync(join(DIR, 'index.json.corrupt-7'))).toBe(false)
    expect(readRecordingAudio(id)!.toString()).toBe('PLAINTEXT-AUDIO')
  })

  it('plaintext corrupt-index backups are overwritten after being sealed', async () => {
    await seed()
    const b = join(DIR, 'index.json.corrupt-123')
    writeFileSync(b, `{"recordings":[{"transcription":"${SECRET}"`)
    h.zeroed.length = 0
    expect(await setHistoryEncryption(true)).toEqual({ ok: true, sealedBackups: 1, plainBackupsLeft: 0 })
    expect(zeroedNames()).toContain('index.json.corrupt-123')
    expect(existsSync(b)).toBe(false)
    expect(readFileSync(`${b}.sealed.json`, 'utf-8')).not.toContain(SECRET)
  })

  it('leftover pins from a crash are wiped on the next migration start and on erase', async () => {
    const id = await seed('LIVE-AUDIO')
    const entry = getRecordings().find((r) => r.id === id)!
    writeFileSync(join(DIR, `orphan.webm${WIPE_SUFFIX}`), 'stale plaintext')
    await setHistoryEncryption(true)
    expect(pins()).toEqual([])
    expect(zeroedNames()).toContain(`orphan.webm${WIPE_SUFFIX}`)
    // A pin that still aliases the LIVE clip (crash before the replace) is unlinked, never zeroed.
    const { linkSync } = await import('fs')
    linkSync(entry.filepath, `${entry.filepath}${WIPE_SUFFIX}`)
    h.zeroed.length = 0
    await migrateAudio('encrypt')
    expect(readRecordingAudio(id)!.toString()).toBe('LIVE-AUDIO')
    expect(pins()).toEqual([])

    writeFileSync(join(DIR, `x.webm${WIPE_SUFFIX}`), 'stale plaintext')
    h.zeroed.length = 0
    await deleteAllRecordings()
    expect(zeroedNames()).toContain(`x.webm${WIPE_SUFFIX}`)
    expect(pins()).toEqual([])
  })

  // L5: sealed backups must never outlive a crypto-shred, including across re-enable.
  it('shred + re-enable leaves no sealed backup behind (erase)', async () => {
    await seed()
    writeFileSync(join(DIR, 'index.json.corrupt-1'), `{"recordings":[{"transcription":"${SECRET}"`)
    await setHistoryEncryption(true)
    expect(readdirSync(DIR)).toContain('index.json.corrupt-1.sealed.json')
    await deleteAllRecordings()
    expect(readdirSync(DIR).filter((f) => f.startsWith('index.json.corrupt-'))).toEqual([])
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    await seed()
    expect(readdirSync(DIR).filter((f) => f.startsWith('index.json.corrupt-'))).toEqual([])
  })

  it('shred + re-enable leaves no sealed backup behind (locked reset)', async () => {
    await seed()
    writeFileSync(join(DIR, 'index.json.corrupt-2'), `{"recordings":[{"transcription":"${SECRET}"`)
    await setHistoryEncryption(true)
    shredDataKey() // key lost: history locked
    expect((await resetLockedHistory()).ok).toBe(true)
    expect(readdirSync(DIR).filter((f) => f.startsWith('index.json.corrupt-'))).toEqual([])
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
  })

  it('sealing only touches exact plaintext backup names: a leftover .sealed.json.tmp is not re-sealed into an un-shreddable orphan', async () => {
    await seed()
    const leftovers = ['index.json.corrupt-3.sealed.json.tmp', 'index.json.corrupt-3.sealed', 'index.json.corrupt-abc']
    for (const f of leftovers) writeFileSync(join(DIR, f), '{}')
    expect(await setHistoryEncryption(true)).toEqual({ ok: true })
    const files = readdirSync(DIR)
    for (const f of leftovers) expect(files).toContain(f)
    expect(files.filter((f) => f.endsWith('.tmp.sealed.json') || f.endsWith('.sealed.sealed.json'))).toEqual([])
    // and the shred still removes the backup-shaped ones (.tmp and exact sealed name)
    await deleteAllRecordings()
    const after = readdirSync(DIR)
    expect(after).not.toContain('index.json.corrupt-3.sealed.json.tmp')
    expect(after).not.toContain('index.json.corrupt-3.sealed')
  })
})
