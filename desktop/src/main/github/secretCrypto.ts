import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// Client-side encryption for the secrets bundle. A GitHub repo — even a private
// one — is NOT a secret vault (every collaborator and GitHub itself can read
// it), so secrets are AES-256-GCM encrypted here BEFORE they leave the app. Only
// this versioned ciphertext envelope is ever committed to the repo; the 32-byte
// master key never leaves the OS keychain (see keyProvider.ts).
//
// GCM gives us both confidentiality and integrity: a wrong key or any tampering
// with iv/ct/tag makes `final()` throw, so decryptSecrets rejects instead of
// returning garbage.

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96-bit nonce, the GCM standard
const KEY_BYTES = 32 // AES-256
export const ENVELOPE_VERSION = 1

/** Versioned envelope, all binary fields base64-encoded — safe to JSON + commit. */
export interface SecretEnvelope {
  v: number
  iv: string
  ct: string
  tag: string
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error(`secretCrypto: master key must be ${KEY_BYTES} bytes`)
  }
}

export function encryptSecrets(plaintext: string, key: Buffer): SecretEnvelope {
  assertKey(key)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64')
  }
}

export function decryptSecrets(envelope: SecretEnvelope, key: Buffer): string {
  assertKey(key)
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`secretCrypto: unsupported envelope version ${envelope.v}`)
  }
  const iv = Buffer.from(envelope.iv, 'base64')
  const ct = Buffer.from(envelope.ct, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  // `final()` throws if the tag doesn't verify (wrong key or tampered ciphertext).
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
  return plaintext.toString('utf-8')
}
