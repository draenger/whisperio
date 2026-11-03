import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

const testDir = join(tmpdir(), `whisperio-aud-err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const fsh = vi.hoisted(() => ({
  renameCalls: 0,
  renameCode: null as string | null,
  renameFailTimes: 0,
  fsyncFail: false,
  closeCalls: 0
}))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: (a: string, b: string) => {
      fsh.renameCalls++
      if (fsh.renameFailTimes > 0) {
        fsh.renameFailTimes--
        throw Object.assign(new Error('rename-fail'), { code: fsh.renameCode })
      }
      return actual.renameSync(a, b)
    },
    fsyncSync: (fd: number) => {
      if (fsh.fsyncFail) throw new Error('fsync-fail')
      return actual.fsyncSync(fd)
    },
    closeSync: (fd: number) => {
      fsh.closeCalls++
      return actual.closeSync(fd)
    }
  }
})

import {
  encryptAudio,
  decryptAudio,
  AudioVaultError,
  HEADER_BYTES,
  AUDIO_VERSION,
  peekIsEncryptedAudio,
  isTransientRenameError,
  renameWithRetry,
  atomicWriteFileSync
} from '../src/main/audioVault'

const KEY = randomBytes(32)

beforeEach(() => {
  fsh.renameCalls = 0
  fsh.renameFailTimes = 0
  fsh.renameCode = null
  fsh.fsyncFail = false
  fsh.closeCalls = 0
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterEach(() => rmSync(testDir, { recursive: true, force: true }))

describe('audioVault key / parameter validation', () => {
  it('rejects a wrong-size or non-Buffer key on both encrypt and decrypt', () => {
    expect(() => encryptAudio(Buffer.alloc(16), Buffer.from('a'), 'r')).toThrow(/Invalid data key/)
    expect(() => encryptAudio('x' as unknown as Buffer, Buffer.from('a'), 'r')).toThrow(AudioVaultError)
    const enc = encryptAudio(KEY, Buffer.from('a'), 'r')
    expect(() => decryptAudio(Buffer.alloc(31), enc, 'r')).toThrow(/Invalid data key/)
  })

  it('rejects invalid segment sizes on encrypt', () => {
    for (const bad of [0, -1, 1.5, NaN, 16 * 1024 * 1024 + 1]) {
      expect(() => encryptAudio(KEY, Buffer.from('a'), 'r', bad)).toThrow(/Invalid segment size/)
    }
    expect(() => encryptAudio(KEY, Buffer.from('a'), 'r', 16 * 1024 * 1024)).not.toThrow()
  })
})

describe('audioVault header validation on decrypt', () => {
  const make = (): Buffer => encryptAudio(KEY, randomBytes(40), 'r', 16)

  it('rejects an unsupported container version', () => {
    const enc = make()
    expect(enc.readUInt8(8)).toBe(AUDIO_VERSION)
    enc.writeUInt8(AUDIO_VERSION + 1, 8)
    expect(() => decryptAudio(KEY, enc, 'r')).toThrow(/Unsupported encrypted audio version/)
    enc.writeUInt8(1, 8)
    expect(() => decryptAudio(KEY, enc, 'r')).toThrow(/Unsupported encrypted audio version/)
  })

  it('rejects a corrupt segment size (0 and above the cap) before touching ciphertext', () => {
    const zero = make()
    zero.writeUInt32BE(0, 13)
    expect(() => decryptAudio(KEY, zero, 'r')).toThrow(/Corrupt encrypted audio header/)
    const huge = make()
    huge.writeUInt32BE(16 * 1024 * 1024 + 1, 13)
    expect(() => decryptAudio(KEY, huge, 'r')).toThrow(/Corrupt encrypted audio header/)
  })

  it('rejects headers/bodies shorter than header + one tag as truncated', () => {
    const enc = make()
    expect(() => decryptAudio(KEY, enc.subarray(0, HEADER_BYTES + 15), 'r')).toThrow(/truncated or malformed/)
    expect(() => decryptAudio(KEY, Buffer.from('WHSPAUD1'), 'r')).toThrow(/truncated or malformed/)
    expect(() => decryptAudio(KEY, Buffer.from('not audio at all, plain webm bytes....'), 'r')).toThrow(
      /truncated or malformed/
    )
  })

  it('rejects stray trailing bytes that break the final-segment framing', () => {
    const enc = encryptAudio(KEY, randomBytes(32), 'r', 16)
    expect(() => decryptAudio(KEY, Buffer.concat([enc, Buffer.alloc(5)]), 'r')).toThrow(AudioVaultError)
  })

  it('rejects a tampered segment-size header (authenticated via AAD)', () => {
    const enc = make()
    enc.writeUInt32BE(32, 13)
    expect(() => decryptAudio(KEY, enc, 'r')).toThrow(AudioVaultError)
  })

  it('never leaks plaintext in the error message', () => {
    const enc = encryptAudio(KEY, Buffer.from('TOP-SECRET-PLAIN'), 'r', 16)
    enc[HEADER_BYTES] ^= 1
    let caught: unknown = null
    try {
      decryptAudio(KEY, enc, 'r')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AudioVaultError)
    expect((caught as Error).message).not.toContain('TOP-SECRET')
    expect((caught as AudioVaultError).code).toBe('AUDIO_VAULT')
  })
})

describe('peekIsEncryptedAudio', () => {
  it('true for sealed, false for plaintext, short file, empty file, missing file and directory', () => {
    const sealed = join(testDir, 's.bin')
    writeFileSync(sealed, encryptAudio(KEY, Buffer.from('abc'), 'r'))
    expect(peekIsEncryptedAudio(sealed)).toBe(true)
    const plain = join(testDir, 'p.webm')
    writeFileSync(plain, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5]))
    expect(peekIsEncryptedAudio(plain)).toBe(false)
    const short = join(testDir, 'short.bin')
    writeFileSync(short, Buffer.from('WHSPAU'))
    expect(peekIsEncryptedAudio(short)).toBe(false)
    const empty = join(testDir, 'e.bin')
    writeFileSync(empty, Buffer.alloc(0))
    expect(peekIsEncryptedAudio(empty)).toBe(false)
    expect(peekIsEncryptedAudio(join(testDir, 'missing.bin'))).toBe(false)
    expect(peekIsEncryptedAudio(testDir)).toBe(false)
  })
})

describe('rename retry policy', () => {
  it('classifies transient codes only', () => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) expect(isTransientRenameError({ code })).toBe(true)
    for (const code of ['ENOENT', 'ENOSPC', 'EXDEV']) expect(isTransientRenameError({ code })).toBe(false)
    expect(isTransientRenameError(null)).toBe(false)
    expect(isTransientRenameError(undefined)).toBe(false)
    expect(isTransientRenameError(new Error('no code'))).toBe(false)
    expect(isTransientRenameError({ code: 13 })).toBe(false)
  })

  it('gives up after exactly 5 attempts on a persistent transient error and rethrows', () => {
    const a = join(testDir, 'a.tmp')
    writeFileSync(a, 'x')
    fsh.renameCode = 'EBUSY'
    fsh.renameFailTimes = 100
    expect(() => renameWithRetry(a, join(testDir, 'a.bin'))).toThrow('rename-fail')
    expect(fsh.renameCalls).toBe(5)
    expect(existsSync(a)).toBe(true)
  })

  it('succeeds on the last allowed attempt (4 failures then ok)', () => {
    const a = join(testDir, 'b.tmp')
    writeFileSync(a, 'x')
    fsh.renameCode = 'EACCES'
    fsh.renameFailTimes = 4
    renameWithRetry(a, join(testDir, 'b.bin'))
    expect(fsh.renameCalls).toBe(5)
    expect(existsSync(join(testDir, 'b.bin'))).toBe(true)
  })

  it('fails immediately (1 call) on a non-transient code', () => {
    const a = join(testDir, 'c.tmp')
    writeFileSync(a, 'x')
    fsh.renameCode = 'EXDEV'
    fsh.renameFailTimes = 1
    expect(() => renameWithRetry(a, join(testDir, 'c.bin'))).toThrow('rename-fail')
    expect(fsh.renameCalls).toBe(1)
  })
})

describe('atomicWriteFileSync failure paths', () => {
  it('fsync failure closes the fd, removes the tmp file and does not touch the target', () => {
    const target = join(testDir, 't.bin')
    writeFileSync(target, 'OLD')
    fsh.fsyncFail = true
    expect(() => atomicWriteFileSync(target, target + '.tmp', Buffer.from('NEW'))).toThrow('fsync-fail')
    expect(existsSync(target + '.tmp')).toBe(false)
    expect(readFileSync(target, 'utf-8')).toBe('OLD')
    expect(fsh.closeCalls).toBe(1)
  })

  it('exhausted transient rename removes the tmp file and keeps the old target', () => {
    const target = join(testDir, 'u.bin')
    writeFileSync(target, 'OLD')
    fsh.renameCode = 'EPERM'
    fsh.renameFailTimes = 100
    expect(() => atomicWriteFileSync(target, target + '.tmp', Buffer.from('NEW'))).toThrow('rename-fail')
    expect(existsSync(target + '.tmp')).toBe(false)
    expect(readFileSync(target, 'utf-8')).toBe('OLD')
  })

  it('opening the tmp path failing (missing dir) throws and leaves nothing behind', () => {
    const target = join(testDir, 'nodir', 'v.bin')
    expect(() => atomicWriteFileSync(target, target + '.tmp', Buffer.from('x'))).toThrow()
    expect(existsSync(join(testDir, 'nodir'))).toBe(false)
  })

  it('writes an empty buffer', () => {
    const target = join(testDir, 'w.bin')
    atomicWriteFileSync(target, target + '.tmp', Buffer.alloc(0))
    expect(readFileSync(target).length).toBe(0)
  })
})
