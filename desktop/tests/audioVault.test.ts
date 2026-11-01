import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

const testDir = join(tmpdir(), `whisperio-aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const fsh = vi.hoisted(() => ({ renameFail: null as null | (() => void) }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: (a: string, b: string) => {
      const f = fsh.renameFail
      if (f) { fsh.renameFail = null; f() }
      return actual.renameSync(a, b)
    }
  }
})

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
  encryptAudio,
  decryptAudio,
  isEncryptedAudio,
  AudioVaultError,
  HEADER_BYTES,
  atomicWriteFileSync
} from '../src/main/audioVault'
import {
  saveRecording,
  readRecordingAudio,
  setHistoryEncryption,
  setEncryptHistoryReader,
  migrateAudio,
  resumeAudioMigration,
  getRecording
} from '../src/main/recordingStore'
import { shredDataKey, getDataKeyForEncrypt } from '../src/main/dataVault'

const KEY = randomBytes(32)
const SEG = 64
const REC = join(testDir, 'recordings')

describe('audioVault format', () => {
  it('round-trips multi-segment, empty and exact-boundary sizes', () => {
    for (const n of [0, 1, SEG - 1, SEG, SEG + 1, SEG * 3, SEG * 3 + 7]) {
      const plain = randomBytes(n)
      const enc = encryptAudio(KEY, plain, 'r1', SEG)
      expect(isEncryptedAudio(enc)).toBe(true)
      expect(decryptAudio(KEY, enc, 'r1').equals(plain)).toBe(true)
    }
  })

  it('round-trips with the default segment size', () => {
    const plain = randomBytes(150_000)
    expect(decryptAudio(KEY, encryptAudio(KEY, plain, 'r'), 'r').equals(plain)).toBe(true)
  })

  it('does not contain the plaintext', () => {
    const plain = Buffer.from('SECRET-AUDIO-MARKER'.repeat(20))
    expect(encryptAudio(KEY, plain, 'r', SEG).includes(Buffer.from('SECRET-AUDIO-MARKER'))).toBe(false)
  })

  it('fails on a flipped byte anywhere (header and every segment)', () => {
    const enc = encryptAudio(KEY, randomBytes(SEG * 3 + 5), 'r', SEG)
    for (let i = 0; i < enc.length; i += 7) {
      const t = Buffer.from(enc)
      t[i] ^= 0x01
      expect(() => decryptAudio(KEY, t, 'r')).toThrow(AudioVaultError)
    }
  })

  it('fails on truncation (at segment boundary and mid-segment) and appended junk', () => {
    const enc = encryptAudio(KEY, randomBytes(SEG * 3), 'r', SEG)
    const stride = SEG + 16
    for (const len of [enc.length - 1, enc.length - stride, HEADER_BYTES + stride, HEADER_BYTES, 10, 0]) {
      expect(() => decryptAudio(KEY, enc.subarray(0, len), 'r')).toThrow(AudioVaultError)
    }
    expect(() => decryptAudio(KEY, Buffer.concat([enc, Buffer.alloc(16)]), 'r')).toThrow(AudioVaultError)
  })

  it('fails when segments are reordered', () => {
    const enc = encryptAudio(KEY, randomBytes(SEG * 3), 'r', SEG)
    const stride = SEG + 16
    const s = (i: number): Buffer => enc.subarray(HEADER_BYTES + i * stride, HEADER_BYTES + (i + 1) * stride)
    const swapped = Buffer.concat([enc.subarray(0, HEADER_BYTES), s(1), s(0), s(2)])
    expect(() => decryptAudio(KEY, swapped, 'r')).toThrow(AudioVaultError)
  })

  it('fails with the wrong key or wrong record id', () => {
    const enc = encryptAudio(KEY, randomBytes(200), 'r', SEG)
    expect(() => decryptAudio(randomBytes(32), enc, 'r')).toThrow(AudioVaultError)
    expect(() => decryptAudio(KEY, enc, 'other')).toThrow(AudioVaultError)
  })

  it('derives a fresh salt and subkey per file', () => {
    const plain = randomBytes(300)
    const a = encryptAudio(KEY, plain, 'r', SEG)
    const b = encryptAudio(KEY, plain, 'r', SEG)
    expect(a.subarray(17, HEADER_BYTES).equals(b.subarray(17, HEADER_BYTES))).toBe(false)
    expect(a.subarray(HEADER_BYTES, HEADER_BYTES + SEG).equals(b.subarray(HEADER_BYTES, HEADER_BYTES + SEG))).toBe(false)
    expect(a.readUInt8(8)).toBe(2)
  })

  it('rejects an unknown key id', () => {
    const enc = encryptAudio(KEY, randomBytes(10), 'r', SEG)
    enc.write('zzzz', 9, 4, 'ascii')
    expect(() => decryptAudio(KEY, enc, 'r')).toThrow(/key id/)
  })

  it('retries a transient EPERM rename once and succeeds', () => {
    mkdirSync(testDir, { recursive: true })
    const target = join(testDir, 'x.bin')
    let calls = 0
    fsh.renameFail = () => {
      calls++
      throw Object.assign(new Error('busy'), { code: 'EPERM' })
    }
    atomicWriteFileSync(target, target + '.tmp', Buffer.from('hello'))
    expect(calls).toBe(1)
    expect(readFileSync(target).toString()).toBe('hello')
    expect(existsSync(target + '.tmp')).toBe(false)
  })

  it('does not retry a non-transient rename error and cleans the tmp file', () => {
    mkdirSync(testDir, { recursive: true })
    const target = join(testDir, 'y.bin')
    fsh.renameFail = () => { throw Object.assign(new Error('nope'), { code: 'ENOSPC' }) }
    expect(() => atomicWriteFileSync(target, target + '.tmp', Buffer.from('x'))).toThrow('nope')
    expect(existsSync(target + '.tmp')).toBe(false)
  })

  it('does not treat legacy plaintext as encrypted', () => {
    expect(isEncryptedAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false)
    expect(isEncryptedAudio(Buffer.alloc(0))).toBe(false)
  })
})

describe('recordingStore audio vault integration', () => {
  let flag = false
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    shredDataKey()
    flag = false
    setEncryptHistoryReader(() => flag)
  })
  afterEach(() => {
    setEncryptHistoryReader(null)
    shredDataKey()
    rmSync(testDir, { recursive: true, force: true })
  })

  const meta = { duration: 1, provider: 'openai', status: 'completed' as const }
  // filenames are second-resolution, so space saves apart (pre-existing naming scheme)
  const gap = (): Promise<void> => new Promise((r) => setTimeout(r, 1100))
  const marker = Buffer.concat([Buffer.from('PLAINTEXT-MARKER-'), randomBytes(300)])

  function audioFiles(): string[] {
    return readdirSync(REC).filter((f) => f.includes('.webm'))
  }

  it('legacy plaintext passes through the single read path', async () => {
    const rec = await saveRecording(marker, meta)
    expect(readFileSync(rec.filepath).equals(marker)).toBe(true)
    expect(readRecordingAudio(rec.id)!.equals(marker)).toBe(true)
  })

  it('save with encryption ON writes no plaintext and leaves no tmp file', async () => {
    flag = true
    const rec = await saveRecording(marker, meta)
    const disk = readFileSync(rec.filepath)
    expect(isEncryptedAudio(disk)).toBe(true)
    expect(disk.includes(Buffer.from('PLAINTEXT-MARKER-'))).toBe(false)
    expect(audioFiles()).toEqual([rec.filename])
    expect(readRecordingAudio(rec.id)!.equals(marker)).toBe(true)
  })

  it('a corrupt encrypted file gives a clear error and does not crash', async () => {
    flag = true
    const rec = await saveRecording(marker, meta)
    const disk = readFileSync(rec.filepath)
    writeFileSync(rec.filepath, disk.subarray(0, disk.length - 5))
    expect(() => readRecordingAudio(rec.id)).toThrow(/authentication|truncated/)
    writeFileSync(rec.filepath, Buffer.from('WHSPAUD1garbage'))
    expect(isEncryptedAudio(readFileSync(rec.filepath))).toBe(true) // untouched, history stays locked
  })

  it('migrates ON then OFF, idempotently, with mixed state readable', async () => {
    const a = await saveRecording(marker, meta)
    await gap()
    const b = await saveRecording(Buffer.from('second'), meta)
    expect((await setHistoryEncryption(true)).ok).toBe(true)
    flag = true
    const r1 = await migrateAudio('encrypt')
    expect(r1.converted).toBe(2)
    expect(isEncryptedAudio(readFileSync(a.filepath))).toBe(true)
    expect(readRecordingAudio(a.id)!.equals(marker)).toBe(true)
    const r2 = await migrateAudio('encrypt')
    expect(r2).toEqual({ converted: 0, skipped: 2, failed: 0 })

    flag = false
    expect((await setHistoryEncryption(false)).ok).toBe(true)
    expect((await resumeAudioMigration())!.converted).toBe(2)
    expect(readFileSync(a.filepath).equals(marker)).toBe(true)
    expect(readRecordingAudio(b.id)!.toString()).toBe('second')
    expect((await migrateAudio('decrypt')).converted).toBe(0)
    expect(audioFiles().length).toBe(2)
  })

  const waitUntil = async (cond: () => boolean): Promise<void> => {
    for (let i = 0; i < 2000 && !cond(); i++) await new Promise<void>((r) => setImmediate(r))
  }
  const sealedCount = (): number =>
    audioFiles().filter((f) => isEncryptedAudio(readFileSync(join(REC, f)))).length

  function fakeClock(): void {
    let t = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 2000))
  }

  it('toggle ON during a running decrypt ends with all audio sealed', async () => {
    fakeClock()
    flag = true
    for (let i = 0; i < 4; i++) await saveRecording(Buffer.from('audio-' + i), meta)
    expect(sealedCount()).toBe(4)
    flag = false
    expect((await setHistoryEncryption(false)).ok).toBe(true)
    const dec = migrateAudio('decrypt')
    await waitUntil(() => sealedCount() < 4)
    expect(sealedCount()).toBeLessThan(4)
    flag = true
    const enc = resumeAudioMigration()
    await Promise.all([dec, enc])
    expect(audioFiles().length).toBe(4)
    expect(sealedCount()).toBe(4)
    vi.restoreAllMocks()
  })

  it('toggle OFF during a running encrypt ends with all audio plain', async () => {
    fakeClock()
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push((await saveRecording(Buffer.from('audio-' + i), meta)).id)
    flag = true
    const enc = migrateAudio('encrypt')
    await waitUntil(() => sealedCount() > 0)
    expect(sealedCount()).toBeGreaterThan(0)
    flag = false
    const dec = migrateAudio('decrypt')
    await Promise.all([enc, dec])
    expect(sealedCount()).toBe(0)
    expect(readRecordingAudio(ids[3])!.toString()).toBe('audio-3')
    vi.restoreAllMocks()
  })

  it('a save overlapping an ON toggle never leaves plaintext behind', async () => {
    fakeClock()
    await saveRecording(Buffer.from('old'), meta)
    flag = false
    const savePromise = saveRecording(marker, meta) // decides inside the queue
    flag = true
    const mig = migrateAudio('encrypt') // snapshots the index before the save has been registered
    await Promise.all([savePromise, mig])
    await migrateAudio('encrypt')
    expect(audioFiles().length).toBe(2)
    expect(sealedCount()).toBe(2)
    for (const f of audioFiles()) {
      expect(readFileSync(join(REC, f)).includes(Buffer.from('PLAINTEXT-MARKER-'))).toBe(false)
    }
    vi.restoreAllMocks()
  })

  it('refuses to mint a new DEK while sealed audio exists (key file lost)', async () => {
    flag = true
    const rec = await saveRecording(marker, meta)
    shredDataKey()
    expect(existsSync(join(testDir, 'data-vault.key'))).toBe(false)
    expect(() => getDataKeyForEncrypt()).toThrow(/refusing to mint/)
    expect(existsSync(join(testDir, 'data-vault.key'))).toBe(false)
    await expect(saveRecording(marker, meta)).rejects.toThrow(/locked|refusing/i)
    expect(isEncryptedAudio(readFileSync(rec.filepath))).toBe(true) // untouched, history stays locked
  })

  it('reports already-sealed files that do not open with the current key as failed', async () => {
    fakeClock()
    flag = true
    const a = await saveRecording(marker, meta)
    await saveRecording(Buffer.from('ok'), meta)
    writeFileSync(a.filepath, encryptAudio(randomBytes(32), marker, a.id))
    const r = await migrateAudio('encrypt')
    expect(r).toEqual({ converted: 0, skipped: 1, failed: 1 })
    vi.restoreAllMocks()
  })

  it('sweeps leaked save/migration tmp files at launch', async () => {
    const rec = await saveRecording(marker, meta)
    writeFileSync(rec.filepath + '.tmp', 'x')
    writeFileSync(rec.filepath + '.mig.tmp', 'x')
    await resumeAudioMigration()
    expect(existsSync(rec.filepath + '.tmp')).toBe(false)
    expect(existsSync(rec.filepath + '.mig.tmp')).toBe(false)
    expect(existsSync(rec.filepath)).toBe(true)
  })

  it('resumes after a crash that left a .mig.tmp and a partly migrated set', async () => {
    const a = await saveRecording(marker, meta)
    await gap()
    const b = await saveRecording(Buffer.from('second'), meta)
    await setHistoryEncryption(true)
    flag = true
    // simulate: a already converted, b has a stale tmp from an interrupted run
    writeFileSync(a.filepath, encryptAudio(KEY_FOR(), marker, a.id))
    writeFileSync(`${b.filepath}.mig.tmp`, Buffer.from('half-written'))
    expect(readRecordingAudio(b.id)!.toString()).toBe('second')
    const r = await resumeAudioMigration()
    expect(r).toEqual({ converted: 1, skipped: 1, failed: 0 })
    expect(existsSync(`${b.filepath}.mig.tmp`)).toBe(false)
    expect(isEncryptedAudio(readFileSync(b.filepath))).toBe(true)
    expect(getRecording(b.id)).not.toBeNull()
    expect(readRecordingAudio(b.id)!.toString()).toBe('second')
  })
})

function KEY_FOR(): Buffer {
  return getDataKeyForEncrypt()
}
