import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'

const backend = { value: 'basic_text' }
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: () => backend.value,
    encryptString: vi.fn((v: string) => Buffer.from(`ENC(${v})`, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => {
      const m = /ENC\((.*)\)$/.exec(buf.toString('utf-8'))
      if (!m) throw new Error('bad ciphertext')
      return m[1]
    })
  }
}))

const disk: Record<string, string> = {}
vi.mock('fs', () => ({
  existsSync: (p: string) => disk[p] !== undefined,
  readFileSync: (p: string) => {
    if (disk[p] === undefined) throw new Error('ENOENT')
    return disk[p]
  },
  writeFileSync: (p: string, c: string) => {
    disk[p] = c
  },
  renameSync: (a: string, b: string) => {
    disk[b] = disk[a]
    delete disk[a]
  }
}))

let settings: Record<string, unknown> = {}
const mockSaveSettings = vi.fn((patch: Record<string, unknown>) => {
  settings = { ...settings, ...patch }
  return settings
})
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: () => ({ ...settings }),
  areSettingsUnavailable: () => false,
  saveSettings: (p: Record<string, unknown>) => mockSaveSettings(p)
}))

import {
  getEffectiveSettings,
  saveSettingsWithKeys,
  migrateProviderKeysToKeyStore,
  rescueWeakLinuxKeys,
  rewrapWeakLinuxKeys,
  maybeWarnLinuxKeyring,
  isLinuxKeyringIssue,
  LINUX_KEYRING_WARNING,
  _resetSessionKeysForTests
} from '../src/main/secure/keyAccessor'

const STORE = join('/mock/userData', 'provider-keys.enc.json')
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const setPlatform = (p: string): void => {
  Object.defineProperty(process, 'platform', { value: p })
}
const wrapped = (o: Record<string, string>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Buffer.from(`ENC(${v})`).toString('base64')])))

describe('Linux without a keyring: session rescue + one-time warning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of Object.keys(disk)) delete disk[k]
    settings = { openaiApiKey: '', groqApiKey: '', linuxKeyringWarningShownFor: '' }
    backend.value = 'basic_text'
    _resetSessionKeysForTests()
    setPlatform('linux')
  })
  afterEach(() => Object.defineProperty(process, 'platform', platform))

  it('legacy plaintext + basic_text: usable, never re-persisted, legacy kept, warns once per version', () => {
    settings.openaiApiKey = 'sk-legacy'
    migrateProviderKeysToKeyStore() // skipped: weak backend
    expect(rescueWeakLinuxKeys()).toBe(0)
    expect(getEffectiveSettings().openaiApiKey).toBe('sk-legacy')
    // renderer round-trips the unchanged value: nothing is written
    saveSettingsWithKeys({ openaiApiKey: 'sk-legacy' })
    expect(settings.openaiApiKey).toBe('sk-legacy')
    expect(disk[STORE]).toBeUndefined()

    const notify = vi.fn()
    expect(maybeWarnLinuxKeyring('1.6.0', notify)).toBe(true)
    expect(maybeWarnLinuxKeyring('1.6.0', notify)).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(LINUX_KEYRING_WARNING)
    expect(settings.linuxKeyringWarningShownFor).toBe('1.6.0')
    expect(maybeWarnLinuxKeyring('1.7.0', notify)).toBe(true) // new version warns again
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('basic_text blobs are rescued in memory only; store file untouched', () => {
    disk[STORE] = wrapped({ groqApiKey: 'gsk-blob' })
    const before = disk[STORE]
    expect(isLinuxKeyringIssue()).toBe(true)
    expect(rescueWeakLinuxKeys()).toBe(1)
    expect(getEffectiveSettings().groqApiKey).toBe('gsk-blob')
    saveSettingsWithKeys({ groqApiKey: 'gsk-blob', openaiApiKey: '' })
    expect(settings.groqApiKey).toBe('')
    expect(JSON.stringify(settings)).not.toContain('gsk-blob')
    expect(disk[STORE]).toBe(before)
  })

  it('does not override a legacy plaintext value with the blob', () => {
    settings.openaiApiKey = 'sk-new'
    disk[STORE] = wrapped({ openaiApiKey: 'sk-old' })
    rescueWeakLinuxKeys()
    expect(getEffectiveSettings().openaiApiKey).toBe('sk-new')
  })

  it('no keys at all: no issue, no warning', () => {
    const notify = vi.fn()
    expect(isLinuxKeyringIssue()).toBe(false)
    expect(maybeWarnLinuxKeyring('1.6.0', notify)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('linux + gnome_libsecret: no warning, no rescue', () => {
    backend.value = 'gnome_libsecret'
    settings.openaiApiKey = 'sk-legacy'
    disk[STORE] = wrapped({ groqApiKey: 'gsk' })
    const notify = vi.fn()
    expect(isLinuxKeyringIssue()).toBe(false)
    expect(rescueWeakLinuxKeys()).toBe(0)
    expect(maybeWarnLinuxKeyring('1.6.0', notify)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin'])('%s: never warns or rescues even with a basic_text-looking backend', (p) => {
    setPlatform(p)
    settings.openaiApiKey = 'sk-legacy'
    disk[STORE] = wrapped({ groqApiKey: 'gsk' })
    const notify = vi.fn()
    expect(isLinuxKeyringIssue()).toBe(false)
    expect(rescueWeakLinuxKeys()).toBe(0)
    expect(maybeWarnLinuxKeyring('1.6.0', notify)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(mockSaveSettings).not.toHaveBeenCalled()
  })

  describe('clearing / replacing a rescued key (no resurrection)', () => {
    const restart = (): void => {
      _resetSessionKeysForTests()
      rescueWeakLinuxKeys()
    }

    it('clear -> restart -> nothing rescued, entry gone', () => {
      disk[STORE] = wrapped({ groqApiKey: 'gsk-blob' })
      rescueWeakLinuxKeys()
      saveSettingsWithKeys({ groqApiKey: '' })
      expect(JSON.parse(disk[STORE]).groqApiKey).toBeUndefined()
      restart()
      expect(getEffectiveSettings().groqApiKey).toBe('')
    })

    it('replace -> restart -> old key not back, new key not persisted', () => {
      disk[STORE] = wrapped({ groqApiKey: 'gsk-old' })
      rescueWeakLinuxKeys()
      saveSettingsWithKeys({ groqApiKey: 'gsk-new' })
      expect(getEffectiveSettings().groqApiKey).toBe('gsk-new')
      expect(JSON.parse(disk[STORE]).groqApiKey).toBeUndefined()
      expect(JSON.stringify(settings)).not.toContain('gsk-new')
      restart()
      expect(getEffectiveSettings().groqApiKey).toBe('')
    })

    it('undecryptable entry + unrelated save with empty field -> entry kept', () => {
      disk[STORE] = JSON.stringify({ groqApiKey: Buffer.from('garbage').toString('base64') })
      const before = disk[STORE]
      expect(rescueWeakLinuxKeys()).toBe(0)
      saveSettingsWithKeys({ groqApiKey: '', openaiApiKey: '' })
      expect(disk[STORE]).toBe(before)
    })

    it('unchanged round-trip keeps the entry', () => {
      disk[STORE] = wrapped({ groqApiKey: 'gsk-blob' })
      const before = disk[STORE]
      rescueWeakLinuxKeys()
      saveSettingsWithKeys({ groqApiKey: 'gsk-blob' })
      expect(disk[STORE]).toBe(before)
      restart()
      expect(getEffectiveSettings().groqApiKey).toBe('gsk-blob')
    })
  })
})

describe('re-wrap of weak-backend (v10) blobs once a real keyring appears', () => {
  const v10 = (o: Record<string, string>): string =>
    JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Buffer.from(`v10ENC(${v})`).toString('base64')])))
  const blobOf = (name: string): string => Buffer.from(JSON.parse(disk[STORE])[name], 'base64').toString('utf-8')

  beforeEach(async () => {
    vi.clearAllMocks()
    for (const k of Object.keys(disk)) delete disk[k]
    settings = { openaiApiKey: '', groqApiKey: '' }
    backend.value = 'gnome_libsecret' // real keyring now present
    _resetSessionKeysForTests()
    setPlatform('linux')
    const { safeStorage } = await import('electron')
    vi.mocked(safeStorage.encryptString).mockImplementation((v: string) => Buffer.from(`v11ENC(${v})`, 'utf-8'))
  })
  afterEach(() => Object.defineProperty(process, 'platform', platform))

  it('weak blob is re-encrypted with the real backend, value unchanged', () => {
    disk[STORE] = v10({ groqApiKey: 'gsk-blob' })
    expect(rewrapWeakLinuxKeys()).toBe(1)
    expect(blobOf('groqApiKey').startsWith('v11')).toBe(true)
    expect(getEffectiveSettings().groqApiKey).toBe('gsk-blob')
  })

  it('second run is a no-op (store file not rewritten)', () => {
    disk[STORE] = v10({ groqApiKey: 'gsk-blob' })
    rewrapWeakLinuxKeys()
    const after = disk[STORE]
    expect(rewrapWeakLinuxKeys()).toBe(0)
    expect(disk[STORE]).toBe(after)
  })

  it('still-weak backend: nothing touched', () => {
    backend.value = 'basic_text'
    disk[STORE] = v10({ groqApiKey: 'gsk-blob' })
    const before = disk[STORE]
    expect(rewrapWeakLinuxKeys()).toBe(0)
    expect(disk[STORE]).toBe(before)
  })

  it('read-back mismatch -> old blob kept', async () => {
    const { safeStorage } = await import('electron')
    disk[STORE] = v10({ groqApiKey: 'gsk-blob' })
    const before = disk[STORE]
    // new blob decrypts to something else than the original value
    vi.mocked(safeStorage.encryptString).mockImplementation(() => Buffer.from('v11ENC(WRONG)', 'utf-8'))
    expect(rewrapWeakLinuxKeys()).toBe(0)
    expect(disk[STORE]).toBe(before)
  })

  it('post-write read-back mismatch restores the old blob', async () => {
    const { safeStorage } = await import('electron')
    disk[STORE] = v10({ groqApiKey: 'gsk-blob' })
    const before = disk[STORE]
    const real = vi.mocked(safeStorage.decryptString).getMockImplementation()!
    // 1st decrypt (old blob) + 2nd (in-memory verify) are right; the read-back after write is wrong
    let calls = 0
    vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => (++calls === 3 ? 'WRONG' : real(b)))
    expect(rewrapWeakLinuxKeys()).toBe(0)
    expect(disk[STORE]).toBe(before)
  })

  it('failure (encrypt throws) loses no key and logs only the error name', async () => {
    const { safeStorage } = await import('electron')
    disk[STORE] = v10({ groqApiKey: 'gsk-blob', openaiApiKey: 'sk-x' })
    const before = disk[STORE]
    vi.mocked(safeStorage.encryptString).mockImplementation(() => {
      throw new TypeError('leaks gsk-blob in message')
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(rewrapWeakLinuxKeys()).toBe(0)
    expect(disk[STORE]).toBe(before)
    const logged = errSpy.mock.calls.flat().join(' ')
    expect(logged).toContain('TypeError')
    expect(logged).not.toContain('gsk-blob')
    expect(logged).not.toContain('leaks')
    errSpy.mockRestore()
  })

  it('non-Linux platforms are skipped', () => {
    setPlatform('win32')
    disk[STORE] = v10({ groqApiKey: 'gsk-blob' })
    const before = disk[STORE]
    expect(rewrapWeakLinuxKeys()).toBe(0)
    expect(disk[STORE]).toBe(before)
  })
})
