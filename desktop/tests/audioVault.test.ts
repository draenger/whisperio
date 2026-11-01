import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

const testDir = join(tmpdir(), `whisperio-aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

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
  HEADER_BYTES
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
import { shredDataKey } from '../src/main/dataVault'

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
    expect(() => readRecordingAudio(rec.id)).toThrow(AudioVaultError)
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

import { getDataKeyForEncrypt } from '../src/main/dataVault'
function KEY_FOR(): Buffer {
  return getDataKeyForEncrypt()
}
