import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { encryptSecrets, decryptSecrets, ENVELOPE_VERSION } from '../src/main/github/secretCrypto'

const KEY = randomBytes(32)

describe('secretCrypto', () => {
  it('round-trips a secrets bundle', () => {
    const plaintext = JSON.stringify({ OPENAI_API_KEY: 'sk-123', foo: 'bar' })
    const env = encryptSecrets(plaintext, KEY)
    expect(decryptSecrets(env, KEY)).toBe(plaintext)
  })

  it('produces a versioned envelope with base64 iv/ct/tag', () => {
    const env = encryptSecrets('hello', KEY)
    expect(env.v).toBe(ENVELOPE_VERSION)
    expect(typeof env.iv).toBe('string')
    expect(typeof env.ct).toBe('string')
    expect(typeof env.tag).toBe('string')
    // base64 decodes cleanly
    expect(Buffer.from(env.iv, 'base64').length).toBe(12)
    expect(Buffer.from(env.tag, 'base64').length).toBe(16)
  })

  it('uses a fresh iv each call (non-deterministic ciphertext)', () => {
    const a = encryptSecrets('same', KEY)
    const b = encryptSecrets('same', KEY)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
  })

  it('throws on the wrong key', () => {
    const env = encryptSecrets('secret', KEY)
    expect(() => decryptSecrets(env, randomBytes(32))).toThrow()
  })

  it('throws when the ciphertext is tampered', () => {
    const env = encryptSecrets('secret', KEY)
    const bytes = Buffer.from(env.ct, 'base64')
    bytes[0] ^= 0xff
    expect(() => decryptSecrets({ ...env, ct: bytes.toString('base64') }, KEY)).toThrow()
  })

  it('throws when the auth tag is tampered', () => {
    const env = encryptSecrets('secret', KEY)
    const tag = Buffer.from(env.tag, 'base64')
    tag[0] ^= 0xff
    expect(() => decryptSecrets({ ...env, tag: tag.toString('base64') }, KEY)).toThrow()
  })

  it('rejects an unsupported envelope version', () => {
    const env = encryptSecrets('x', KEY)
    expect(() => decryptSecrets({ ...env, v: 999 }, KEY)).toThrow(/unsupported envelope version/)
  })

  it('rejects a key of the wrong length', () => {
    expect(() => encryptSecrets('x', randomBytes(16))).toThrow(/32 bytes/)
  })
})
