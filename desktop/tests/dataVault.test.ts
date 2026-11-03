import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-dv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const h = vi.hoisted(() => ({
  available: true,
  backend: 'gnome_libsecret' as string
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  safeStorage: {
    isEncryptionAvailable: () => h.available,
    getSelectedStorageBackend: () => h.backend,
    // Reversible fake: not real crypto, only proves wrap/unwrap plumbing.
    encryptString: (s: string) => Buffer.from(`ENC:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => {
      const t = b.toString('utf-8')
      if (!t.startsWith('ENC:')) throw new Error('cannot decrypt')
      return t.slice(4)
    }
  }
}))

import {
  isDataVaultAvailable,
  getDataKeyForEncrypt,
  getDataKeyForDecrypt,
  shredDataKey
} from '../src/main/dataVault'

const KEY_FILE = join(testDir, 'data-vault.key')
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p })
}

describe('dataVault', () => {
  beforeEach(() => {
    h.available = true
    h.backend = 'gnome_libsecret'
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    shredDataKey()
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('creates the key once and reuses it', () => {
    const a = getDataKeyForEncrypt()
    expect(a.length).toBe(32)
    expect(existsSync(KEY_FILE)).toBe(true)
    const onDisk = readFileSync(KEY_FILE, 'utf-8')
    const b = getDataKeyForEncrypt()
    expect(b.equals(a)).toBe(true)
    expect(readFileSync(KEY_FILE, 'utf-8')).toBe(onDisk)
    expect(getDataKeyForDecrypt()?.equals(a)).toBe(true)
  })

  it('does not write the raw key to disk', () => {
    const key = getDataKeyForEncrypt()
    expect(readFileSync(KEY_FILE, 'utf-8')).not.toContain(key.toString('base64'))
  })

  it('existing corrupt key file: encrypt path throws, decrypt path returns null, file is NOT replaced', () => {
    writeFileSync(KEY_FILE, 'not-a-wrapped-key', 'utf-8')
    const before = readFileSync(KEY_FILE, 'utf-8')
    expect(() => getDataKeyForEncrypt()).toThrow()
    expect(getDataKeyForDecrypt()).toBeNull()
    expect(readFileSync(KEY_FILE, 'utf-8')).toBe(before)
  })

  it('existing key file with wrong key size is not replaced either', () => {
    const wrapped = Buffer.from(`ENC:${Buffer.alloc(16, 1).toString('base64')}`).toString('base64')
    writeFileSync(KEY_FILE, wrapped, 'utf-8')
    expect(() => getDataKeyForEncrypt()).toThrow()
    expect(getDataKeyForDecrypt()).toBeNull()
    expect(readFileSync(KEY_FILE, 'utf-8')).toBe(wrapped)
  })

  it('decrypt path returns null when no key exists and does not create one', () => {
    expect(getDataKeyForDecrypt()).toBeNull()
    expect(existsSync(KEY_FILE)).toBe(false)
  })

  it('unavailable -> { ok:false, reason:"unavailable" } and encrypt path throws (fail closed)', () => {
    h.available = false
    expect(isDataVaultAvailable()).toEqual({ ok: false, reason: 'unavailable' })
    expect(() => getDataKeyForEncrypt()).toThrow()
    expect(existsSync(KEY_FILE)).toBe(false)
  })

  it('linux basic_text and unknown -> weak-backend, libsecret -> ok', () => {
    setPlatform('linux')
    h.backend = 'basic_text'
    expect(isDataVaultAvailable()).toEqual({ ok: false, reason: 'weak-backend' })
    h.backend = 'unknown'
    expect(isDataVaultAvailable()).toEqual({ ok: false, reason: 'weak-backend' })
    h.backend = 'gnome_libsecret'
    expect(isDataVaultAvailable()).toEqual({ ok: true })
  })

  it('basic_text backend is ignored off linux', () => {
    setPlatform('win32')
    h.backend = 'basic_text'
    expect(isDataVaultAvailable()).toEqual({ ok: true })
  })

  it('shredDataKey deletes the file and the key is gone', () => {
    getDataKeyForEncrypt()
    expect(existsSync(KEY_FILE)).toBe(true)
    shredDataKey()
    expect(existsSync(KEY_FILE)).toBe(false)
    expect(getDataKeyForDecrypt()).toBeNull()
  })
})
