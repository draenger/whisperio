import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-dv-err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const h = vi.hoisted(() => ({
  available: true as boolean | 'throw',
  renameFail: false,
  encryptThrows: false
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: (a: string, b: string) => {
      if (h.renameFail) throw new Error('rename-boom')
      return actual.renameSync(a, b)
    }
  }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (h.available === 'throw') throw new Error('keychain locked')
      return h.available
    },
    encryptString: (s: string) => {
      if (h.encryptThrows) throw new Error('wrap-boom')
      return Buffer.from(`ENC:${s}`, 'utf-8')
    },
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
  shredDataKey,
  registerSealedDataProbe
} from '../src/main/dataVault'

const KEY_FILE = join(testDir, 'data-vault.key')

describe('dataVault error paths', () => {
  beforeEach(() => {
    h.available = true
    h.renameFail = false
    h.encryptThrows = false
    registerSealedDataProbe(null)
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    shredDataKey()
  })
  afterEach(() => {
    registerSealedDataProbe(null)
    rmSync(testDir, { recursive: true, force: true })
  })

  it('safeStorage.isEncryptionAvailable throwing is reported as unavailable (fail closed)', () => {
    h.available = 'throw'
    expect(isDataVaultAvailable()).toEqual({ ok: false, reason: 'unavailable' })
    expect(() => getDataKeyForEncrypt()).toThrow(/unavailable/)
    expect(existsSync(KEY_FILE)).toBe(false)
  })

  it('refuses to mint a new key while sealed data exists and no key file does', () => {
    registerSealedDataProbe(() => true)
    expect(() => getDataKeyForEncrypt()).toThrow(/refusing to mint a new key/)
    expect(existsSync(KEY_FILE)).toBe(false)
  })

  it('mints when the probe reports no sealed data; the probe is not consulted once a key exists', () => {
    const probe = vi.fn(() => false)
    registerSealedDataProbe(probe)
    const k1 = getDataKeyForEncrypt()
    expect(probe).toHaveBeenCalledTimes(1)
    const k2 = getDataKeyForEncrypt()
    expect(k2.equals(k1)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('an existing key file wins over the sealed-data probe (probe only guards the missing-file case)', () => {
    const k1 = getDataKeyForEncrypt()
    shredDataKey()
    writeFileSync(KEY_FILE, Buffer.from(`ENC:${k1.toString('base64')}`).toString('base64'))
    registerSealedDataProbe(() => true)
    expect(getDataKeyForEncrypt().equals(k1)).toBe(true)
  })

  it('a cached key is NOT served once the key file is deleted behind its back', () => {
    const k1 = getDataKeyForEncrypt()
    expect(getDataKeyForDecrypt()!.equals(k1)).toBe(true)
    rmSync(KEY_FILE)
    expect(getDataKeyForDecrypt()).toBeNull()
    registerSealedDataProbe(() => true)
    expect(() => getDataKeyForEncrypt()).toThrow(/refusing to mint a new key/)
  })

  it('the decrypt path reads the key from disk without rewriting the file', () => {
    const k1 = getDataKeyForEncrypt()
    const before = readFileSync(KEY_FILE, 'utf-8')
    shredDataKey()
    writeFileSync(KEY_FILE, before)
    const k2 = getDataKeyForDecrypt()
    expect(k2!.equals(k1)).toBe(true)
    expect(readFileSync(KEY_FILE, 'utf-8')).toBe(before)
  })

  it('wrap failure (encryptString throws) propagates and leaves no key or tmp file', () => {
    h.encryptThrows = true
    expect(() => getDataKeyForEncrypt()).toThrow('wrap-boom')
    expect(readdirSync(testDir)).toEqual([])
    h.encryptThrows = false
    expect(getDataKeyForEncrypt().length).toBe(32)
  })

  it('atomic write rename failure cleans the tmp file, throws, and caches nothing', () => {
    h.renameFail = true
    expect(() => getDataKeyForEncrypt()).toThrow('rename-boom')
    expect(readdirSync(testDir)).toEqual([])
    expect(existsSync(KEY_FILE)).toBe(false)
    expect(getDataKeyForDecrypt()).toBeNull()
  })

  it('a key file that unwraps to the wrong size is rejected, decrypt returns null', () => {
    writeFileSync(KEY_FILE, Buffer.from('ENC:AAAA').toString('base64'))
    expect(getDataKeyForDecrypt()).toBeNull()
    expect(() => getDataKeyForEncrypt()).toThrow(/cannot be unwrapped/)
  })

  it('shredDataKey is idempotent and swallows a failing unlink (key path is a directory)', () => {
    expect(() => shredDataKey()).not.toThrow()
    mkdirSync(KEY_FILE)
    expect(() => shredDataKey()).not.toThrow()
    expect(existsSync(KEY_FILE)).toBe(true)
    expect(() => getDataKeyForEncrypt()).toThrow(/cannot be unwrapped/)
    expect(getDataKeyForDecrypt()).toBeNull()
  })

  it('shred after minting makes the next decrypt return null', () => {
    getDataKeyForEncrypt()
    shredDataKey()
    expect(existsSync(KEY_FILE)).toBe(false)
    expect(getDataKeyForDecrypt()).toBeNull()
  })
})
