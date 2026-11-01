import { app } from 'electron'
import { createHash, type Hash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * SHA-256 integrity for downloaded artifacts (whisper-server binary, models).
 *
 * Policy per artifact:
 *  - PINNED: a known SHA-256 ships in the code; the download must match it.
 *  - TOFU (trust on first use): no pin is known. The computed hash is persisted
 *    in `<userData>/download-integrity.json` on first download, a later
 *    download of the same artifact must match it, and (for the executable) every
 *    launch re-hashes the installed file against it to detect tampering.
 */

export type IntegrityMode = 'pinned' | 'tofu-first' | 'tofu-verified'

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}

export function newHasher(): Hash {
  return createHash('sha256')
}

function storePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'download-integrity.json')
}

function readStore(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function getStoredHash(key: string): string | null {
  const v = readStore()[key]
  return typeof v === 'string' ? v : null
}

export function storeHash(key: string, hash: string): void {
  const store = readStore()
  store[key] = hash
  writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

export function forgetHash(key: string): void {
  const store = readStore()
  if (key in store) {
    delete store[key]
    try { writeFileSync(storePath(), JSON.stringify(store, null, 2)) } catch { /* ignore */ }
  }
}

/** Hash a file already on disk (launch-time tamper detection; sync so start flow stays unchanged). */
export function hashFile(path: string): string {
  return newHasher().update(readFileSync(path)).digest('hex')
}

/**
 * Compare a freshly computed digest with the pin (preferred) or the TOFU
 * record. Throws IntegrityError on mismatch. Returns the mode used plus a
 * `commit()` that persists the digest (call after the artifact is promoted).
 */
export function checkDigest(
  key: string,
  label: string,
  digest: string,
  pinned: string | null | undefined
): { mode: IntegrityMode; commit: () => void } {
  if (pinned) {
    if (digest.toLowerCase() !== pinned.toLowerCase()) {
      throw new IntegrityError(
        `SHA-256 mismatch for ${label}: expected ${pinned}, got ${digest}. The download was discarded.`
      )
    }
    return { mode: 'pinned', commit: () => storeHash(key, digest) }
  }
  const stored = getStoredHash(key)
  if (stored) {
    if (stored.toLowerCase() !== digest.toLowerCase()) {
      throw new IntegrityError(
        `SHA-256 for ${label} differs from the checksum recorded on first download ` +
          `(recorded ${stored}, got ${digest}). The download was discarded.`
      )
    }
    return { mode: 'tofu-verified', commit: () => {} }
  }
  console.warn(`[integrity] No pinned SHA-256 for ${label}; trusting first download (TOFU): ${digest}`)
  return { mode: 'tofu-first', commit: () => storeHash(key, digest) }
}
