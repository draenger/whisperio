import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

// Get-or-create the 32-byte AES master key used by secretCrypto. The key is
// wrapped at rest with the OS keychain via Electron `safeStorage` (DPAPI on
// Windows, Keychain on macOS) and stored as `secret-key.bin` in userData. Only
// the wrapped bytes touch disk; the raw key never does. This is the desktop
// analogue of the mobile Keychain wrapper — the key never leaves the OS keychain
// and is never committed to the repo.
//
// THIN + coverage-excluded: safeStorage requires a live Electron runtime, so the
// tractable crypto is tested in secretCrypto; this glue is verified manually.

const KEY_FILE = 'secret-key.bin'
const KEY_BYTES = 32

function keyPath(): string {
  return join(app.getPath('userData'), KEY_FILE)
}

/**
 * @throws if the OS secure storage is unavailable (e.g. a Linux box with no
 * keyring/libsecret) — we refuse to persist an unwrapped key.
 */
export function getOrCreateMasterKey(): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS secure storage (Keychain/DPAPI) is unavailable, so the encryption key cannot be protected. ' +
        'GitHub secret sync is disabled on this machine.'
    )
  }

  const filePath = keyPath()
  if (existsSync(filePath)) {
    try {
      const wrapped = readFileSync(filePath)
      const b64 = safeStorage.decryptString(wrapped)
      const key = Buffer.from(b64, 'base64')
      if (key.length === KEY_BYTES) return key
    } catch {
      // Fall through and regenerate — a corrupt/unwrappable key file means the
      // old ciphertext is unrecoverable anyway.
    }
  }

  const key = randomBytes(KEY_BYTES)
  const wrapped = safeStorage.encryptString(key.toString('base64'))
  // Atomic write (temp + rename), same discipline as settingsManager.
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, wrapped)
  renameSync(tmpPath, filePath)
  return key
}

export function isSecretStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}
