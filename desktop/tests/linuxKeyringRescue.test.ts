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
      const m = /^ENC\((.*)\)$/.exec(buf.toString('utf-8'))
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
  saveSettings: (p: Record<string, unknown>) => mockSaveSettings(p)
}))

import {
  getEffectiveSettings,
  saveSettingsWithKeys,
  migrateProviderKeysToKeyStore,
  rescueWeakLinuxKeys,
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
})
