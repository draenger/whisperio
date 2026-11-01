import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { generateDataKey, DATA_KEY_BYTES } from './secretCrypto'

/**
 * History data vault — owns the history DEK used by opt-in history encryption.
 *
 * Deliberately SEPARATE from secretVault.ts (`secret-vault.key`): that key seals the GitHub-sync
 * payload and secretVault regenerates it when unreadable. Here the opposite policy applies: the
 * key protects the user's own history, so we NEVER regenerate over an existing key file (that
 * would silently orphan every sealed record). A present-but-unusable key file makes the encrypt
 * path throw; the decrypt path returns null and the caller treats history as LOCKED.
 *
 * The DEK is stored wrapped by Electron safeStorage (base64) in userData/data-vault.key and only
 * exists unwrapped in memory. Fail closed: no plaintext fallback exists.
 */

const KEY_FILE = 'data-vault.key'

export type DataVaultAvailability =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'weak-backend' }

let cachedKey: Buffer | null = null

// Registered by recordingStore (avoids an import cycle): returns true when sealed user data exists
// on disk. With no key file that data is already orphaned/locked, and minting a fresh DEK would make
// it permanently unrecoverable, so the encrypt path refuses instead.
let sealedDataProbe: (() => boolean) | null = null
export function registerSealedDataProbe(fn: (() => boolean) | null): void {
  sealedDataProbe = fn
}

function keyPath(): string {
  return join(app.getPath('userData'), KEY_FILE)
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, data, 'utf-8')
  try {
    renameSync(tmp, filePath)
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* best-effort cleanup */ }
    throw err
  }
}

export function isDataVaultAvailable(): DataVaultAvailability {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'unavailable' }
    if (process.platform === 'linux') {
      const fn = (safeStorage as unknown as { getSelectedStorageBackend?: () => string })
        .getSelectedStorageBackend
      if (typeof fn === 'function') {
        const backend = fn.call(safeStorage)
        if (backend === 'basic_text' || backend === 'unknown') {
          return { ok: false, reason: 'weak-backend' }
        }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Unwrap the existing key file. Throws if unreadable/undecryptable/wrong size. */
function readExistingKey(path: string): Buffer {
  const wrappedB64 = readFileSync(path, 'utf-8')
  const dek = safeStorage.decryptString(Buffer.from(wrappedB64, 'base64'))
  const key = Buffer.from(dek, 'base64')
  if (key.length !== DATA_KEY_BYTES) throw new Error('data vault key has an unexpected size')
  return key
}

/**
 * Key for sealing. Creates + persists a key only when NO key file exists. Throws when the vault
 * is unavailable, or when a key file exists but cannot be used (never regenerates over it).
 */
export function getDataKeyForEncrypt(): Buffer {
  const avail = isDataVaultAvailable()
  if (!avail.ok) throw new Error(`History vault unavailable (${avail.reason}) - refusing to encrypt.`)
  const path = keyPath()
  // A cached key is only trusted while its file still exists (never seal with a key that is gone).
  if (cachedKey && existsSync(path)) return cachedKey
  cachedKey = null
  if (existsSync(path)) {
    try {
      cachedKey = readExistingKey(path)
    } catch {
      throw new Error('History key file exists but cannot be unwrapped - refusing to replace it.')
    }
    return cachedKey
  }
  if (sealedDataProbe && sealedDataProbe()) {
    throw new Error('History key file is missing but encrypted history exists - refusing to mint a new key.')
  }
  const key = generateDataKey()
  const wrapped = safeStorage.encryptString(key.toString('base64'))
  atomicWrite(path, wrapped.toString('base64'))
  cachedKey = key
  return key
}

/** Key for opening. null if absent/unusable; never throws. */
export function getDataKeyForDecrypt(): Buffer | null {
  if (cachedKey && existsSync(keyPath())) return cachedKey
  cachedKey = null
  try {
    const path = keyPath()
    if (!existsSync(path)) return null
    cachedKey = readExistingKey(path)
    return cachedKey
  } catch {
    return null
  }
}

/**
 * Crypto-shred: delete the key file and drop the in-memory copy. Returns true only when the key file
 * is verifiably gone. A failed delete (EPERM, AV lock) returns false: callers MUST stop before
 * deleting any data, because the sealed history would still be readable.
 */
export function shredDataKey(): boolean {
  cachedKey = null
  try {
    const path = keyPath()
    if (existsSync(path)) unlinkSync(path)
    return !existsSync(path)
  } catch {
    return false
  }
}
