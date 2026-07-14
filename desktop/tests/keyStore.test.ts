import { vi, describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData')
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    // Reversible fake "encryption": prefix the plaintext so tests can assert
    // the on-disk bytes are not the plaintext itself, without needing real
    // OS Keychain access in CI.
    encryptString: vi.fn((value: string) => Buffer.from(`ENC(${value})`, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => {
      const str = buf.toString('utf-8')
      const match = /^ENC\((.*)\)$/.exec(str)
      if (!match) throw new Error('bad ciphertext')
      return match[1]
    })
  }
}))

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockRenameSync = vi.fn()

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args)
}))

import { app, safeStorage } from 'electron'
import { getKey, setKey, deleteKey, listKeys, isEncryptionAvailable } from '../src/main/secure/keyStore'

const STORE_PATH = join('/mock/userData', 'provider-keys.enc.json')

/** In-memory backing store the writeFileSync/renameSync mocks below persist
 * to, so subsequent readFileSync calls in the same test see prior writes —
 * mirrors how the real atomic-write-then-rename pair behaves on disk. */
let disk: Record<string, string> = {}

function wireDiskMocks(): void {
  disk = {}
  mockExistsSync.mockImplementation((p: string) => p === STORE_PATH && disk[STORE_PATH] !== undefined)
  mockReadFileSync.mockImplementation((p: string) => {
    if (p !== STORE_PATH || disk[STORE_PATH] === undefined) {
      throw new Error(`ENOENT: no such file, open '${p}'`)
    }
    return disk[STORE_PATH]
  })
  mockWriteFileSync.mockImplementation((tmpPath: string, content: string) => {
    disk[tmpPath] = content
  })
  mockRenameSync.mockImplementation((tmpPath: string, finalPath: string) => {
    disk[finalPath] = disk[tmpPath]
    delete disk[tmpPath]
  })
}

describe('keyStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    wireDiskMocks()
  })

  describe('isEncryptionAvailable', () => {
    it('reflects safeStorage.isEncryptionAvailable()', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
      expect(isEncryptionAvailable()).toBe(false)
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
      expect(isEncryptionAvailable()).toBe(true)
    })

    it('fails soft to false if safeStorage throws', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockImplementation(() => {
        throw new Error('Keychain unreachable')
      })
      expect(isEncryptionAvailable()).toBe(false)
    })
  })

  describe('set/get/delete round-trip', () => {
    it('getKey returns null for a name that was never set', () => {
      expect(getKey('openaiApiKey')).toBeNull()
    })

    it('setKey then getKey returns the original plaintext', () => {
      setKey('openaiApiKey', 'sk-test-123')
      expect(getKey('openaiApiKey')).toBe('sk-test-123')
    })

    it('deleteKey removes a previously-set key', () => {
      setKey('openaiApiKey', 'sk-test-123')
      deleteKey('openaiApiKey')
      expect(getKey('openaiApiKey')).toBeNull()
    })

    it('deleteKey is a no-op (not an error) for a name that was never set', () => {
      expect(() => deleteKey('neverSet')).not.toThrow()
      expect(getKey('neverSet')).toBeNull()
    })

    it('listKeys reflects the current set of stored names', () => {
      setKey('openaiApiKey', 'sk-a')
      setKey('anthropicApiKey', 'sk-ant-b')
      expect(listKeys().sort()).toEqual(['anthropicApiKey', 'openaiApiKey'])
      deleteKey('openaiApiKey')
      expect(listKeys()).toEqual(['anthropicApiKey'])
    })

    it('multiple keys coexist independently', () => {
      setKey('openaiApiKey', 'sk-a')
      setKey('elevenlabsApiKey', 'xi-b')
      expect(getKey('openaiApiKey')).toBe('sk-a')
      expect(getKey('elevenlabsApiKey')).toBe('xi-b')
    })
  })

  describe('at-rest values are not plaintext', () => {
    it('the bytes written to disk never contain the plaintext key value', () => {
      setKey('openaiApiKey', 'sk-super-secret-value')
      const written = JSON.stringify(disk)
      expect(written).not.toContain('sk-super-secret-value')
      expect(safeStorage.encryptString).toHaveBeenCalledWith('sk-super-secret-value')
    })
  })

  describe('fallback: encryption unavailable', () => {
    beforeEach(() => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    })

    it('getKey returns null without touching the filesystem', () => {
      expect(getKey('openaiApiKey')).toBeNull()
      expect(mockReadFileSync).not.toHaveBeenCalled()
    })

    it('setKey throws rather than silently storing plaintext', () => {
      expect(() => setKey('openaiApiKey', 'sk-test')).toThrow(/unavailable/i)
      expect(mockWriteFileSync).not.toHaveBeenCalled()
    })

    it('deleteKey is a safe no-op', () => {
      expect(() => deleteKey('openaiApiKey')).not.toThrow()
    })

    it('listKeys returns an empty array', () => {
      expect(listKeys()).toEqual([])
    })
  })

  describe('corrupt store file', () => {
    it('treats an unparsable store as empty (fail-soft, logged) rather than throwing', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('not valid json{{{')
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => getKey('openaiApiKey')).not.toThrow()
      expect(getKey('openaiApiKey')).toBeNull()
      expect(listKeys()).toEqual([])
      expect(errSpy).toHaveBeenCalled()

      errSpy.mockRestore()
    })

    it('treats a store whose JSON parses to a non-object (e.g. an array) as empty', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('[1,2,3]')
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(getKey('openaiApiKey')).toBeNull()
      expect(listKeys()).toEqual([])
      expect(errSpy).toHaveBeenCalled()

      errSpy.mockRestore()
    })

    it('getKey fails soft to null when decryption throws (e.g. a rotated Keychain entry)', () => {
      setKey('openaiApiKey', 'sk-a')
      vi.mocked(safeStorage.decryptString).mockImplementation(() => {
        throw new Error('Keychain entry rotated')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(getKey('openaiApiKey')).toBeNull()
      expect(errSpy).toHaveBeenCalled()

      errSpy.mockRestore()
    })
  })

  it('uses app.getPath("userData") to locate the store file', () => {
    setKey('openaiApiKey', 'sk-a')
    expect(app.getPath).toHaveBeenCalledWith('userData')
  })
})
