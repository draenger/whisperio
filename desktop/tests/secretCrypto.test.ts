import { describe, it, expect } from 'vitest'
import {
  generateDataKey,
  encryptWithKey,
  decryptWithKey,
  serializeEnvelope,
  parseEnvelope,
  DATA_KEY_BYTES,
  type SecretEnvelope
} from '../src/main/secretCrypto'

describe('secretCrypto', () => {
  it('generates a 256-bit key', () => {
    const key = generateDataKey()
    expect(key.length).toBe(DATA_KEY_BYTES)
    expect(key.length).toBe(32)
  })

  it('round-trips a plaintext secret', () => {
    const key = generateDataKey()
    const secret = 'sk-super-secret-openai-key-1234567890'
    const env = encryptWithKey(key, secret)
    expect(decryptWithKey(key, env)).toBe(secret)
  })

  it('round-trips unicode and JSON payloads', () => {
    const key = generateDataKey()
    const payload = JSON.stringify({ a: 'ąćę🔐', b: ['x', 'y'], n: 42 })
    const env = encryptWithKey(key, payload)
    expect(decryptWithKey(key, env)).toBe(payload)
  })

  it('produces a versioned AES-256-GCM envelope', () => {
    const env = encryptWithKey(generateDataKey(), 'hi')
    expect(env.v).toBe(1)
    expect(env.alg).toBe('AES-256-GCM')
    // IV is 12 bytes → 16 base64 chars
    expect(Buffer.from(env.iv, 'base64').length).toBe(12)
    // GCM tag is 16 bytes
    expect(Buffer.from(env.tag, 'base64').length).toBe(16)
  })

  it('uses a fresh IV per encryption (no nonce reuse)', () => {
    const key = generateDataKey()
    const a = encryptWithKey(key, 'same')
    const b = encryptWithKey(key, 'same')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
  })

  it('fails to decrypt with the wrong key', () => {
    const env = encryptWithKey(generateDataKey(), 'secret')
    expect(() => decryptWithKey(generateDataKey(), env)).toThrow()
  })

  it('rejects a tampered ciphertext (GCM auth)', () => {
    const key = generateDataKey()
    const env = encryptWithKey(key, 'secret')
    const ct = Buffer.from(env.ct, 'base64')
    ct[0] ^= 0xff
    const tampered: SecretEnvelope = { ...env, ct: ct.toString('base64') }
    expect(() => decryptWithKey(key, tampered)).toThrow()
  })

  it('rejects a tampered auth tag', () => {
    const key = generateDataKey()
    const env = encryptWithKey(key, 'secret')
    const tag = Buffer.from(env.tag, 'base64')
    tag[0] ^= 0xff
    expect(() => decryptWithKey(key, { ...env, tag: tag.toString('base64') })).toThrow()
  })

  it('rejects invalid key sizes', () => {
    // @ts-expect-error deliberately wrong size
    expect(() => encryptWithKey(Buffer.alloc(16), 'x')).toThrow()
  })

  it('rejects unsupported envelope versions/algorithms', () => {
    const key = generateDataKey()
    const env = encryptWithKey(key, 'x')
    expect(() => decryptWithKey(key, { ...env, v: 2 as unknown as 1 })).toThrow()
    expect(() => decryptWithKey(key, { ...env, alg: 'AES-128-CBC' as unknown as 'AES-256-GCM' })).toThrow()
  })

  it('serializes and parses an envelope losslessly', () => {
    const key = generateDataKey()
    const env = encryptWithKey(key, 'payload')
    const raw = serializeEnvelope(env)
    const back = parseEnvelope(raw)
    expect(decryptWithKey(key, back)).toBe('payload')
  })

  it('parseEnvelope rejects malformed payloads', () => {
    expect(() => parseEnvelope('{"v":9}')).toThrow()
    expect(() => parseEnvelope('not json')).toThrow()
  })
})
