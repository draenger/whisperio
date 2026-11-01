import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, copyFileSync } from 'fs'
import { join } from 'path'
import {
  generateDataKey,
  encryptWithKey,
  decryptWithKey,
  serializeEnvelope,
  parseEnvelope,
  type SecretEnvelope
} from './secretCrypto'

/**
 * Local secret vault — owns the data-encryption key (DEK) lifecycle and the
 * local, at-rest storage of process secrets (the GitHub access token).
 *
 * KEY LIFECYCLE
 * -------------
 * A single 256-bit DEK is generated once and stored *wrapped* by Electron
 * `safeStorage`. On macOS `safeStorage` encrypts with a key held in the login
 * Keychain ("Whisperio Safe Storage"), so the wrapping key never touches disk —
 * exactly the hardened Keychain path the security note calls for. The wrapped
 * DEK ciphertext lives in userData; the DEK itself only ever exists in memory.
 *
 * The DEK is what seals the payload that gets committed to the user's GitHub
 * repo (see `secretCrypto.ts`). Because the DEK is local + Keychain-protected,
 * the repo copy is useless to GitHub or any collaborator.
 *
 * FAIL CLOSED
 * -----------
 * If OS encryption is unavailable we refuse to store or seal anything rather
 * than silently degrade to plaintext. There is no insecure fallback path.
 */

const DEK_FILE = 'secret-vault.key' // wrapped DEK (safeStorage ciphertext, base64)
const TOKEN_FILE = 'github-token.enc' // wrapped GitHub token (safeStorage ciphertext, base64)

function userDataPath(name: string): string {
  return join(app.getPath('userData'), name)
}

/**
 * Thrown when the DEK file exists but cannot be used right now (Keychain locked / prompt denied /
 * entry rotated, or malformed key material). We NEVER mint a replacement in that case: a new key
 * would make everything already sealed in the GitHub repo undecryptable.
 */
export class VaultLockedError extends Error {
  readonly code = 'VAULT_LOCKED'
  constructor(message: string) {
    super(message)
    this.name = 'VaultLockedError'
  }
}

/**
 * On Linux without a keyring Electron falls back to a hard-coded password (`basic_text`, or
 * `unknown` before a backend was picked): obfuscation, not encryption — counts as unavailable.
 * Mirrors secure/keyStore.ts.
 */
function isWeakLinuxBackend(): boolean {
  if (process.platform !== 'linux') return false
  const getBackend = (safeStorage as { getSelectedStorageBackend?: () => string })
    .getSelectedStorageBackend
  if (typeof getBackend !== 'function') return false
  const backend = getBackend.call(safeStorage)
  return backend === 'basic_text' || backend === 'unknown'
}

/** True when the OS-backed encryption (macOS Keychain) is usable. */
export function isVaultAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    return !isWeakLinuxBackend()
  } catch {
    return false
  }
}

function requireVault(): void {
  if (!isVaultAvailable()) {
    throw new Error(
      'OS secure storage (Keychain) is unavailable — refusing to store secrets in plaintext.'
    )
  }
}

/** Atomic write helper mirroring settingsManager/recordingStore. Cleans up the tmp on failure. */
function atomicWrite(filePath: string, data: string): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, data, 'utf-8')
    renameSync(tmp, filePath)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* best effort */
    }
    throw err
  }
}

/**
 * Load the DEK, generating + persisting it on first use. The DEK is returned as
 * a Buffer that exists only in memory; it is never written unwrapped.
 */
export function getOrCreateDataKey(): Buffer {
  requireVault()
  const path = userDataPath(DEK_FILE)
  if (existsSync(path)) {
    // The key file exists: it is the ONLY copy of the key that seals the repo payload. Never
    // overwrite it, whatever goes wrong here.
    let key: Buffer
    try {
      const wrappedB64 = readFileSync(path, 'utf-8')
      const dek = safeStorage.decryptString(Buffer.from(wrappedB64, 'base64'))
      key = Buffer.from(dek, 'base64')
    } catch {
      throw new VaultLockedError(
        'The secret vault key could not be unlocked (Keychain locked, access denied, or entry changed). ' +
          'Unlock the Keychain and try again; the existing key was left untouched.'
      )
    }
    if (key.length === 32) return key
    // Decrypted fine but malformed: keep a backup copy for recovery, leave the file in place.
    try {
      copyFileSync(path, `${path}.malformed-${Date.now()}.bak`)
    } catch {
      /* best effort */
    }
    throw new VaultLockedError(
      'The secret vault key file is malformed. It was backed up and left untouched; not regenerating.'
    )
  }
  const key = generateDataKey()
  const wrapped = safeStorage.encryptString(key.toString('base64'))
  atomicWrite(path, wrapped.toString('base64'))
  return key
}

/** True once a DEK has been created on this machine. */
export function hasDataKey(): boolean {
  return existsSync(userDataPath(DEK_FILE))
}

/** Seal an arbitrary plaintext for the repo using the local DEK. */
export function sealForRepo(plaintext: string): string {
  const key = getOrCreateDataKey()
  return serializeEnvelope(encryptWithKey(key, plaintext))
}

/** Open a repo payload produced by `sealForRepo`. */
export function openFromRepo(raw: string): string {
  const key = getOrCreateDataKey()
  const env: SecretEnvelope = parseEnvelope(raw)
  return decryptWithKey(key, env)
}

/* ── GitHub access token: local, at-rest, Keychain-wrapped (never in settings.json) ── */

export function saveGithubToken(token: string): void {
  requireVault()
  const wrapped = safeStorage.encryptString(token)
  atomicWrite(userDataPath(TOKEN_FILE), wrapped.toString('base64'))
}

export function loadGithubToken(): string | null {
  const path = userDataPath(TOKEN_FILE)
  if (!existsSync(path)) return null
  try {
    const wrappedB64 = readFileSync(path, 'utf-8')
    return safeStorage.decryptString(Buffer.from(wrappedB64, 'base64'))
  } catch {
    return null
  }
}

export function hasGithubToken(): boolean {
  return existsSync(userDataPath(TOKEN_FILE))
}

export function clearGithubToken(): void {
  const path = userDataPath(TOKEN_FILE)
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* best effort */
  }
}
