import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

/**
 * Pure, dependency-free AES-256-GCM envelope crypto for Whisperio's secret store.
 *
 * SECURITY MODEL
 * --------------
 * A GitHub repo — even a private one — is NOT a secret vault: GitHub itself and
 * every collaborator can read its contents. So no plaintext secret is ever
 * allowed to leave this process. Anything destined for the repo is first sealed
 * here with a 256-bit data key that never leaves the local machine (it lives in
 * the OS keychain via `secretVault.ts`, which wraps it with Electron
 * `safeStorage`). Only the ciphertext envelope produced here is committed.
 *
 * This module is deliberately pure (key in → envelope out) so it can be unit
 * tested without an Electron runtime and audited in isolation. Key *lifecycle*
 * (generation, keychain storage) lives in `secretVault.ts`.
 */

/** AES-256 → 32-byte key. */
export const DATA_KEY_BYTES = 32
/** GCM standard nonce size. */
const IV_BYTES = 12
/** GCM auth tag size. */
const TAG_BYTES = 16

export interface SecretEnvelope {
  /** Envelope schema version, for forward migration. */
  v: 1
  /** Algorithm identifier — pinned so a decryptor can refuse anything else. */
  alg: 'AES-256-GCM'
  /** Base64 random IV/nonce (12 bytes). Never reused with the same key. */
  iv: string
  /** Base64 ciphertext. */
  ct: string
  /** Base64 GCM authentication tag (16 bytes) — integrity + authenticity. */
  tag: string
}

/** Generate a fresh 256-bit data key. Caller is responsible for storing it securely. */
export function generateDataKey(): Buffer {
  return randomBytes(DATA_KEY_BYTES)
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== DATA_KEY_BYTES) {
    throw new Error(`Invalid data key: expected a ${DATA_KEY_BYTES}-byte Buffer`)
  }
}

/**
 * Seal a plaintext string into an authenticated envelope.
 * A random IV is generated per call — never encrypt twice with the same (key, IV).
 */
export function encryptWithKey(key: Buffer, plaintext: string): SecretEnvelope {
  assertKey(key)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64')
  }
}

/**
 * Open a sealed envelope. Throws if the key is wrong, the ciphertext was
 * tampered with (GCM tag mismatch), or the envelope is malformed/unsupported.
 */
export function decryptWithKey(key: Buffer, env: SecretEnvelope): string {
  assertKey(key)
  if (!env || env.v !== 1 || env.alg !== 'AES-256-GCM') {
    throw new Error('Unsupported or malformed secret envelope')
  }
  const iv = Buffer.from(env.iv, 'base64')
  const ct = Buffer.from(env.ct, 'base64')
  const tag = Buffer.from(env.tag, 'base64')
  if (iv.length !== IV_BYTES) throw new Error('Bad IV length in secret envelope')
  if (tag.length !== TAG_BYTES) throw new Error('Bad auth tag length in secret envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/** Serialize the on-repo payload: a versioned envelope as pretty JSON bytes. */
export function serializeEnvelope(env: SecretEnvelope): string {
  return JSON.stringify(env, null, 2)
}

/** Parse an on-repo payload back into an envelope (no decryption). */
export function parseEnvelope(raw: string): SecretEnvelope {
  const parsed = JSON.parse(raw) as SecretEnvelope
  if (!parsed || parsed.v !== 1 || parsed.alg !== 'AES-256-GCM') {
    throw new Error('Unsupported or malformed secret envelope')
  }
  return parsed
}
