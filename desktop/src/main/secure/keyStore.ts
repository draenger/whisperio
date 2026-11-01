import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'

/**
 * Encrypted provider-API-key store, built on Electron's `safeStorage` (macOS
 * Keychain, libsecret/kwallet on Linux, DPAPI on Windows).
 *
 * Persistence: a single JSON file in userData (`provider-keys.enc.json`)
 * mapping key name -> `safeStorage.encryptString()` ciphertext, base64
 * encoded. Writes are atomic (temp file + rename), mirroring
 * settingsManager.ts/secretVault.ts.
 *
 * This module is a peer of secretVault.ts (the GitHub-token vault), not a
 * replacement for it — deliberately a separate file/format. secretVault
 * fails CLOSED (throws when encryption is unavailable) because the GitHub
 * token has no plaintext fallback. Provider API keys DO have a documented
 * plaintext fallback — the existing settings.json fields — so this module
 * instead reports availability honestly via `isEncryptionAvailable()` and
 * simply declines to operate when it's false. It never itself writes
 * plaintext anywhere; deciding when to use the settings.json fallback
 * instead is keyAccessor.ts's job, not this module's.
 */

const STORE_FILE = 'provider-keys.enc.json'

type EncryptedStore = Record<string, string> // name -> base64 ciphertext

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

/**
 * On Linux without a keyring Electron falls back to a hard-coded password
 * (`basic_text`, or `unknown` before a backend was picked): that is obfuscation,
 * not encryption, so it must count as unavailable.
 */
export function isWeakLinuxBackend(): boolean {
  if (process.platform !== 'linux') return false
  // Selecting the backend is lazy: before the first availability check Electron reports
  // 'unknown'. Trigger that check here so the verdict never depends on call order
  // (callers must still run after app 'ready'; main does).
  try {
    safeStorage.isEncryptionAvailable()
  } catch {
    /* fall through to the backend query */
  }
  const getBackend = (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend
  if (typeof getBackend !== 'function') return false
  const backend = getBackend.call(safeStorage)
  return backend === 'basic_text' || backend === 'unknown'
}

/** True when OS-backed encryption is usable on this machine right now (e.g.
 * false on a Linux box with no keyring daemon running). Every read/write
 * below re-checks this rather than caching it, since it can in principle
 * change across the app's lifetime (keyring service starting/stopping). */
export function isEncryptionAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    return !isWeakLinuxBackend()
  } catch {
    return false
  }
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, data, 'utf-8')
  renameSync(tmp, filePath)
}

/**
 * Read the whole encrypted store. A missing file is an empty store. A
 * corrupt/unparsable file is ALSO treated as empty rather than thrown —
 * fail-soft, per the invariant: losing the provider-key cache is
 * recoverable (settings.json's own fields, or the user re-entering a key),
 * unlike losing a transcript or crashing the app on startup.
 */
function readStore(): EncryptedStore {
  const path = storePath()
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as EncryptedStore
    }
    console.error('[Whisperio] provider-keys store had an unexpected shape; treating as empty.')
    return {}
  } catch (err) {
    console.error('[Whisperio] provider-keys store is corrupt; treating as empty:', err)
    return {}
  }
}

function writeStore(store: EncryptedStore): void {
  atomicWrite(storePath(), JSON.stringify(store, null, 2))
}

/**
 * Read a single key by name. Returns null when unset, when it fails to
 * decrypt (e.g. the OS keyring entry backing safeStorage rotated), or when
 * encryption is unavailable — callers can treat all three identically
 * (nothing to read) and fall back to settings.json.
 */
export function getKey(name: string): string | null {
  if (!isEncryptionAvailable()) return null
  const ciphertext = readStore()[name]
  if (!ciphertext) return null
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  } catch (err) {
    console.error(`[Whisperio] failed to decrypt provider key "${name}":`, err)
    return null
  }
}

/**
 * Encrypt + persist a single key. Throws if encryption is unavailable —
 * unlike the read paths, a write is a real mutation the caller asked for, so
 * silently no-op'ing it would be a lie. Callers (keyAccessor.ts) check
 * `isEncryptionAvailable()` first and never let this throw reach the user
 * unhandled.
 */
export function setKey(name: string, value: string): void {
  if (!isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable — cannot store provider keys on this machine.')
  }
  const store = readStore()
  const wrapped = safeStorage.encryptString(value)
  store[name] = wrapped.toString('base64')
  writeStore(store)
}

/** Remove a single key. No-op if it was never set or the store is empty —
 * "delete something that isn't there" is not an error. No-op (not a throw)
 * when encryption is unavailable either, for the same reason: there is
 * nothing in the (unreadable) store to delete. */
export function deleteKey(name: string): void {
  if (!isEncryptionAvailable()) return
  const store = readStore()
  if (!(name in store)) return
  delete store[name]
  writeStore(store)
}

/** Names of all keys currently stored (not their values). Empty array when
 * encryption is unavailable. */
export function listKeys(): string[] {
  if (!isEncryptionAvailable()) return []
  return Object.keys(readStore())
}

/**
 * True when at least one entry was wrapped into the store earlier (e.g. by 1.5.x
 * with the `basic_text` backend). Works regardless of availability: it only reads
 * the file, never decrypts.
 */
export function hasWrappedEntries(): boolean {
  return Object.keys(readStore()).length > 0
}

/**
 * Linux weak-backend rescue read: decrypt every entry of the store with the
 * `basic_text` backend (Electron's hard-coded password), so keys wrapped by
 * 1.5.x stay usable in memory. Returns {} unless this is Linux with a weak
 * backend (elsewhere getKey is the only path). Never writes anything.
 */
export function readWeakBackendKeys(): Record<string, string> {
  if (!isWeakLinuxBackend()) return {}
  const out: Record<string, string> = {}
  try {
    if (!safeStorage.isEncryptionAvailable()) return out
  } catch {
    return out
  }
  for (const [name, ciphertext] of Object.entries(readStore())) {
    try {
      out[name] = safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
    } catch (err) {
      console.error(`[Whisperio] could not rescue provider key "${name}" from the weak store:`, err)
    }
  }
  return out
}

/**
 * Remove one wrapped entry from the store file even when secure storage is
 * unavailable. Deleting ciphertext writes no plaintext, so the fail-closed rule
 * holds. Used when the user clears/replaces a key that would otherwise be
 * resurrected by the session rescue on the next launch. Atomic write.
 */
export function dropWrappedEntry(name: string): void {
  const store = readStore()
  if (!(name in store)) return
  delete store[name]
  writeStore(store)
}
