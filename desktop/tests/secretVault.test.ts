import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'

const USER_DATA = '/mock/userData'
const DEK_PATH = join(USER_DATA, 'secret-vault.key')
const TOKEN_PATH = join(USER_DATA, 'github-token.enc')

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn<() => boolean>(() => true),
  // Reversible fake "encryption": on-disk bytes differ from the plaintext.
  encryptString: vi.fn((value: string) => Buffer.from(`ENC(${value})`, 'utf-8')),
  decryptString: vi.fn((buf: Buffer) => {
    const m = /^ENC\(([\s\S]*)\)$/.exec(buf.toString('utf-8'))
    if (!m) throw new Error('bad ciphertext')
    return m[1]
  }),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret')
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  safeStorage: safeStorageMock
}))

// In-memory fs; `calls` records the order of operations for atomic-write checks.
const fsState = vi.hoisted(() => ({
  disk: {} as Record<string, string>,
  calls: [] as Array<{ op: string; path: string; to?: string }>,
  failRename: false
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => fsState.disk[p] !== undefined,
  readFileSync: (p: string) => {
    if (fsState.disk[p] === undefined) throw new Error(`ENOENT: ${p}`)
    return fsState.disk[p]
  },
  writeFileSync: (p: string, content: string) => {
    fsState.calls.push({ op: 'write', path: p })
    fsState.disk[p] = content
  },
  renameSync: (from: string, to: string) => {
    fsState.calls.push({ op: 'rename', path: from, to })
    if (fsState.failRename) throw new Error('EPERM rename')
    fsState.disk[to] = fsState.disk[from]
    delete fsState.disk[from]
  },
  copyFileSync: (from: string, to: string) => {
    fsState.calls.push({ op: 'copy', path: from, to })
    fsState.disk[to] = fsState.disk[from]
  },
  unlinkSync: (p: string) => {
    fsState.calls.push({ op: 'unlink', path: p })
    delete fsState.disk[p]
  },
  readdirSync: (dir: string) =>
    Object.keys(fsState.disk)
      .filter((p) => p.startsWith(dir) && !p.slice(dir.length + 1).match(/[\\/]/))
      .map((p) => p.slice(dir.length + 1))
}))

import {
  isVaultAvailable,
  getOrCreateDataKey,
  hasDataKey,
  sealForRepo,
  openFromRepo,
  saveGithubToken,
  loadGithubToken,
  hasGithubToken,
  clearGithubToken,
  VaultLockedError
} from '../src/main/secretVault'

const SECRET = 'ghp_SUPERSECRETTOKEN1234567890'

let logSpies: Array<ReturnType<typeof vi.spyOn>>

function allLogged(): string {
  return logSpies
    .flatMap((s) => s.mock.calls)
    .map((args) => args.map(String).join(' '))
    .join('\n')
}

beforeEach(() => {
  fsState.disk = {}
  fsState.calls = []
  fsState.failRename = false
  safeStorageMock.isEncryptionAvailable.mockReset().mockReturnValue(true)
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.decryptString.mockClear()
  safeStorageMock.getSelectedStorageBackend.mockReset().mockReturnValue('gnome_libsecret')
  logSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {})
  )
})

afterEach(() => {
  logSpies.forEach((s) => s.mockRestore())
})

describe('isVaultAvailable', () => {
  it('reflects safeStorage.isEncryptionAvailable', () => {
    expect(isVaultAvailable()).toBe(true)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(isVaultAvailable()).toBe(false)
  })

  it('returns false (does not throw) when safeStorage itself throws', () => {
    safeStorageMock.isEncryptionAvailable.mockImplementation(() => {
      throw new Error('keychain locked')
    })
    expect(isVaultAvailable()).toBe(false)
  })
})

describe('fail closed when encryption is unavailable', () => {
  beforeEach(() => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
  })

  it('saveGithubToken throws and writes nothing, never the plaintext', () => {
    expect(() => saveGithubToken(SECRET)).toThrow(/refusing to store secrets in plaintext/)
    expect(fsState.calls).toEqual([])
    expect(fsState.disk).toEqual({})
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
  })

  it('getOrCreateDataKey throws and persists no key material', () => {
    expect(() => getOrCreateDataKey()).toThrow(/unavailable/)
    expect(fsState.calls).toEqual([])
    expect(hasDataKey()).toBe(false)
  })

  it('sealForRepo and openFromRepo throw rather than emit plaintext', () => {
    expect(() => sealForRepo(SECRET)).toThrow(/unavailable/)
    expect(() => openFromRepo('{}')).toThrow(/unavailable/)
    expect(fsState.calls).toEqual([])
  })

  it('treats a throwing safeStorage as unavailable (fail closed)', () => {
    safeStorageMock.isEncryptionAvailable.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => saveGithubToken(SECRET)).toThrow(/unavailable/)
    expect(fsState.disk).toEqual({})
  })

})

describe('Linux weak backend (basic_text / unknown) fails closed', () => {
  const realPlatform = process.platform
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
  })
  function setPlatform(p: string): void {
    Object.defineProperty(process, 'platform', { value: p })
  }

  it.each(['basic_text', 'unknown'])('linux + %s: unavailable, nothing stored', (backend) => {
    setPlatform('linux')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.getSelectedStorageBackend.mockReturnValue(backend)
    expect(isVaultAvailable()).toBe(false)
    expect(() => saveGithubToken(SECRET)).toThrow(/unavailable/)
    expect(() => sealForRepo('x')).toThrow(/unavailable/)
    expect(fsState.disk).toEqual({})
  })

  it('linux + gnome_libsecret: available', () => {
    setPlatform('linux')
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
    expect(isVaultAvailable()).toBe(true)
  })

  it('non-linux ignores the backend value', () => {
    setPlatform('darwin')
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')
    expect(isVaultAvailable()).toBe(true)
  })
})

describe('GitHub token storage', () => {
  it('round-trips and stores only wrapped (non-plaintext) base64 on disk', () => {
    saveGithubToken(SECRET)
    expect(hasGithubToken()).toBe(true)
    const onDisk = fsState.disk[TOKEN_PATH]
    expect(onDisk).not.toContain(SECRET)
    expect(Buffer.from(onDisk, 'base64').toString('utf-8')).toBe(`ENC(${SECRET})`)
    expect(loadGithubToken()).toBe(SECRET)
  })

  it('overwrites an existing token', () => {
    saveGithubToken('old-token')
    saveGithubToken(SECRET)
    expect(loadGithubToken()).toBe(SECRET)
  })

  it('loadGithubToken returns null when the file is missing and does not decrypt', () => {
    expect(hasGithubToken()).toBe(false)
    expect(loadGithubToken()).toBeNull()
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('loadGithubToken returns null for a corrupt/undecryptable blob', () => {
    fsState.disk[TOKEN_PATH] = Buffer.from('garbage-not-wrapped').toString('base64')
    expect(loadGithubToken()).toBeNull()
    expect(safeStorageMock.decryptString).toHaveBeenCalledTimes(1)
  })

  it('loadGithubToken returns null if decryptString throws (rotated Keychain entry)', () => {
    saveGithubToken(SECRET)
    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error('Decryption failed')
    })
    expect(loadGithubToken()).toBeNull()
  })

  it('clearGithubToken removes the file and is a no-op when absent', () => {
    saveGithubToken(SECRET)
    clearGithubToken()
    expect(hasGithubToken()).toBe(false)
    expect(loadGithubToken()).toBeNull()
    expect(() => clearGithubToken()).not.toThrow()
  })

  it('writes atomically: tmp file first, then rename onto the final path', () => {
    saveGithubToken(SECRET)
    expect(fsState.calls).toHaveLength(2)
    expect(fsState.calls[0].op).toBe('write')
    expect(fsState.calls[0].path).not.toBe(TOKEN_PATH)
    expect(fsState.calls[0].path.startsWith(TOKEN_PATH)).toBe(true)
    expect(fsState.calls[0].path.endsWith('.tmp')).toBe(true)
    expect(fsState.calls[1]).toEqual({ op: 'rename', path: fsState.calls[0].path, to: TOKEN_PATH })
  })

  it('a failed rename leaves the previous token intact (final path never half-written)', () => {
    saveGithubToken('previous-token')
    fsState.failRename = true
    expect(() => saveGithubToken(SECRET)).toThrow(/EPERM/)
    expect(loadGithubToken()).toBe('previous-token')
  })
})

describe('atomicWrite cleanup', () => {
  it('removes the tmp file when rename fails', () => {
    fsState.failRename = true
    expect(() => saveGithubToken(SECRET)).toThrow(/EPERM/)
    expect(Object.keys(fsState.disk).filter((k) => k.endsWith('.tmp'))).toEqual([])
    expect(fsState.calls.some((c) => c.op === 'unlink' && c.path.endsWith('.tmp'))).toBe(true)
  })
})

describe('data-encryption key lifecycle', () => {
  it('generates a 32-byte key, persists it wrapped, and never writes it raw', () => {
    expect(hasDataKey()).toBe(false)
    const key = getOrCreateDataKey()
    expect(key).toHaveLength(32)
    expect(hasDataKey()).toBe(true)
    const stored = fsState.disk[DEK_PATH]
    expect(stored).not.toContain(key.toString('base64'))
    expect(Buffer.from(stored, 'base64').toString('utf-8')).toBe(`ENC(${key.toString('base64')})`)
  })

  it('returns the same key on subsequent calls without rewriting', () => {
    const a = getOrCreateDataKey()
    fsState.calls = []
    const b = getOrCreateDataKey()
    expect(b.equals(a)).toBe(true)
    expect(fsState.calls).toEqual([])
  })

  it('writes the key atomically via tmp + rename', () => {
    getOrCreateDataKey()
    expect(fsState.calls.map((c) => c.op)).toEqual(['write', 'rename'])
    expect(fsState.calls[1].to).toBe(DEK_PATH)
    expect(fsState.calls[0].path).not.toBe(DEK_PATH)
  })

  it('locked/undecryptable key blob: throws VaultLockedError and leaves the key file byte-identical', () => {
    const blob = Buffer.from('corrupt').toString('base64')
    fsState.disk[DEK_PATH] = blob
    expect(() => getOrCreateDataKey()).toThrow(VaultLockedError)
    expect(fsState.disk[DEK_PATH]).toBe(blob)
    expect(fsState.calls.filter((c) => c.op !== 'read')).toEqual([])
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
  })

  it('transient Keychain failure on a valid key: throws, then the SAME key is returned once unlocked', () => {
    const key = getOrCreateDataKey()
    const stored = fsState.disk[DEK_PATH]
    fsState.calls = []
    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error('User denied Keychain access')
    })
    expect(() => getOrCreateDataKey()).toThrow(VaultLockedError)
    expect(fsState.calls).toEqual([])
    expect(fsState.disk[DEK_PATH]).toBe(stored)
    expect(getOrCreateDataKey().equals(key)).toBe(true)
  })

  it('wrong-length decrypted key: throws, backs the file up, never overwrites it', () => {
    const shortB64 = Buffer.from('short').toString('base64')
    const blob = Buffer.from(`ENC(${shortB64})`).toString('base64')
    fsState.disk[DEK_PATH] = blob
    expect(() => getOrCreateDataKey()).toThrow(VaultLockedError)
    expect(fsState.disk[DEK_PATH]).toBe(blob)
    const backups = Object.keys(fsState.disk).filter((k) => k.includes('.malformed-'))
    expect(backups).toHaveLength(1)
    expect(fsState.disk[backups[0]]).toBe(blob)
    // A second attempt must not pile up another backup copy.
    expect(() => getOrCreateDataKey()).toThrow(VaultLockedError)
    expect(Object.keys(fsState.disk).filter((k) => k.includes('.malformed-'))).toHaveLength(1)
  })

  it('sealForRepo / openFromRepo propagate the lock (nothing sealed under a new key)', () => {
    fsState.disk[DEK_PATH] = Buffer.from('corrupt').toString('base64')
    expect(() => sealForRepo(SECRET)).toThrow(VaultLockedError)
    expect(() => openFromRepo('{}')).toThrow(VaultLockedError)
  })

  it('missing key file: creates and persists a fresh 32-byte key', () => {
    expect(fsState.disk[DEK_PATH]).toBeUndefined()
    expect(getOrCreateDataKey()).toHaveLength(32)
    expect(fsState.disk[DEK_PATH]).toBeDefined()
  })

  it('generates distinct keys on distinct machines (fresh disks)', () => {
    const a = getOrCreateDataKey()
    fsState.disk = {}
    const b = getOrCreateDataKey()
    expect(a.equals(b)).toBe(false)
  })
})

describe('sealForRepo / openFromRepo', () => {
  it('round-trips and the sealed payload does not contain the plaintext', () => {
    const sealed = sealForRepo(SECRET)
    expect(sealed).not.toContain(SECRET)
    expect(openFromRepo(sealed)).toBe(SECRET)
  })

  it('round-trips unicode and empty strings', () => {
    expect(openFromRepo(sealForRepo('zażółć 🔑'))).toBe('zażółć 🔑')
    expect(openFromRepo(sealForRepo(''))).toBe('')
  })

  it('cannot open a payload sealed under a different key', () => {
    const sealed = sealForRepo(SECRET)
    fsState.disk = {} // new DEK generated
    expect(() => openFromRepo(sealed)).toThrow()
  })

  it('rejects malformed payloads', () => {
    expect(() => openFromRepo('not json')).toThrow()
  })

  it('rejects a tampered ciphertext', () => {
    const env = JSON.parse(sealForRepo(SECRET))
    const buf = Buffer.from(env.ct, 'base64')
    buf[0] ^= 0xff
    env.ct = buf.toString('base64')
    expect(() => openFromRepo(JSON.stringify(env))).toThrow()
  })
})

describe('secrets never leak into logs or error messages', () => {
  it('does not log or embed the token in errors across save/load/clear/failure paths', () => {
    const errors: string[] = []
    const capture = (fn: () => unknown): void => {
      try {
        fn()
      } catch (e) {
        errors.push(String((e as Error).message))
      }
    }
    saveGithubToken(SECRET)
    loadGithubToken()
    fsState.disk[TOKEN_PATH] = 'corrupt'
    loadGithubToken()
    clearGithubToken()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    capture(() => saveGithubToken(SECRET))
    capture(() => sealForRepo(SECRET))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    const sealed = sealForRepo(SECRET)
    capture(() => openFromRepo(sealed.slice(0, -3)))
    fsState.failRename = true
    capture(() => saveGithubToken(SECRET))

    expect(errors.length).toBeGreaterThan(0)
    for (const msg of errors) expect(msg).not.toContain(SECRET)
    expect(allLogged()).not.toContain(SECRET)
    expect(allLogged()).not.toContain(Buffer.from(SECRET).toString('base64'))
  })

  it('does not log the DEK', () => {
    const key = getOrCreateDataKey()
    fsState.disk[DEK_PATH] = 'corrupt'
    expect(() => getOrCreateDataKey()).toThrow(VaultLockedError)
    expect(allLogged()).not.toContain(key.toString('base64'))
    expect(allLogged()).not.toContain(key.toString('hex'))
  })
})
