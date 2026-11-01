import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'fs'
import { DATA_KEY_BYTES } from './secretCrypto'

/**
 * Chunked AEAD container for kept audio recordings (opt-in "Encrypt history", design doc 3.1/3.3).
 *
 * LAYOUT (all integers big-endian)
 *   header (25 bytes): magic "WHSPAUD1"(8) | version u8 (=1) | kid(4 ascii) | segSize u32 | fileNonce(8)
 *   segment i (i = 0..n-1): AES-256-GCM ciphertext (<= segSize bytes) || tag(16)
 *     nonce_i = fileNonce(8) || i u32            (unique per segment; fileNonce is random per file)
 *     AAD_i   = header(25) || "|" || recordId || "|" || final u8
 *   Every segment except the last holds exactly segSize plaintext bytes; the last holds 0..segSize
 *   (an empty file is one final empty segment). The reader knows `final` from the byte position.
 *
 * GUARANTEES: any bit flip in header or segments, segment reorder (counter in nonce), truncation
 * (the new last segment was not sealed as final), appended junk (the old final segment no longer
 * verifies as final), a wrong key and a wrong recordId all fail authentication. Throws
 * AudioVaultError; never returns partial plaintext (everything is verified before returning).
 */

export const AUDIO_MAGIC = Buffer.from('WHSPAUD1', 'ascii')
export const AUDIO_VERSION = 1
export const AUDIO_KID = 'aud1'
export const DEFAULT_SEGMENT_SIZE = 64 * 1024
const TAG_BYTES = 16
const FILE_NONCE_BYTES = 8
export const HEADER_BYTES = 8 + 1 + 4 + 4 + FILE_NONCE_BYTES
const MAX_SEGMENT_SIZE = 16 * 1024 * 1024

export class AudioVaultError extends Error {
  readonly code = 'AUDIO_VAULT'
  constructor(message: string) {
    super(message)
    this.name = 'AudioVaultError'
  }
}

/** True when the buffer starts with the encrypted-audio magic (legacy plaintext webm never does). */
export function isEncryptedAudio(buf: Buffer): boolean {
  return buf.length >= AUDIO_MAGIC.length && buf.subarray(0, AUDIO_MAGIC.length).equals(AUDIO_MAGIC)
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== DATA_KEY_BYTES) {
    throw new AudioVaultError(`Invalid data key: expected a ${DATA_KEY_BYTES}-byte Buffer`)
  }
}

function segNonce(fileNonce: Buffer, index: number): Buffer {
  const n = Buffer.alloc(12)
  fileNonce.copy(n, 0)
  n.writeUInt32BE(index, 8)
  return n
}

function segAad(header: Buffer, recordId: string, final: boolean): Buffer {
  return Buffer.concat([header, Buffer.from(`|${recordId}|`, 'utf8'), Buffer.from([final ? 1 : 0])])
}

export function encryptAudio(
  key: Buffer,
  plain: Buffer,
  recordId: string,
  segmentSize: number = DEFAULT_SEGMENT_SIZE
): Buffer {
  assertKey(key)
  if (!Number.isInteger(segmentSize) || segmentSize < 1 || segmentSize > MAX_SEGMENT_SIZE) {
    throw new AudioVaultError('Invalid segment size')
  }
  const header = Buffer.alloc(HEADER_BYTES)
  AUDIO_MAGIC.copy(header, 0)
  header.writeUInt8(AUDIO_VERSION, 8)
  header.write(AUDIO_KID, 9, 4, 'ascii')
  header.writeUInt32BE(segmentSize, 13)
  randomBytes(FILE_NONCE_BYTES).copy(header, 17)
  const fileNonce = header.subarray(17, 17 + FILE_NONCE_BYTES)

  const count = Math.max(1, Math.ceil(plain.length / segmentSize))
  const parts: Buffer[] = [header]
  for (let i = 0; i < count; i++) {
    const chunk = plain.subarray(i * segmentSize, Math.min(plain.length, (i + 1) * segmentSize))
    const c = createCipheriv('aes-256-gcm', key, segNonce(fileNonce, i), { authTagLength: TAG_BYTES })
    c.setAAD(segAad(header, recordId, i === count - 1))
    parts.push(c.update(chunk), c.final(), c.getAuthTag())
  }
  return Buffer.concat(parts)
}

export function decryptAudio(key: Buffer, data: Buffer, recordId: string): Buffer {
  assertKey(key)
  if (!isEncryptedAudio(data) || data.length < HEADER_BYTES + TAG_BYTES) {
    throw new AudioVaultError('Encrypted audio is truncated or malformed')
  }
  const header = data.subarray(0, HEADER_BYTES)
  if (header.readUInt8(8) !== AUDIO_VERSION) throw new AudioVaultError('Unsupported encrypted audio version')
  const segmentSize = header.readUInt32BE(13)
  if (segmentSize < 1 || segmentSize > MAX_SEGMENT_SIZE) throw new AudioVaultError('Corrupt encrypted audio header')
  const fileNonce = header.subarray(17, 17 + FILE_NONCE_BYTES)
  const stride = segmentSize + TAG_BYTES

  const out: Buffer[] = []
  let pos = HEADER_BYTES
  let index = 0
  try {
    while (pos < data.length) {
      const remaining = data.length - pos
      const final = remaining <= stride
      if (remaining < TAG_BYTES) throw new Error('short segment')
      const segLen = final ? remaining : stride
      const ct = data.subarray(pos, pos + segLen - TAG_BYTES)
      const tag = data.subarray(pos + segLen - TAG_BYTES, pos + segLen)
      const d = createDecipheriv('aes-256-gcm', key, segNonce(fileNonce, index), { authTagLength: TAG_BYTES })
      d.setAAD(segAad(header, recordId, final))
      d.setAuthTag(tag)
      out.push(d.update(ct), d.final())
      pos += segLen
      index++
    }
  } catch {
    throw new AudioVaultError('Encrypted audio failed authentication (corrupt, truncated, tampered or wrong key)')
  }
  return Buffer.concat(out)
}

/** Write bytes to `tmpPath`, fsync, then atomically rename over `finalPath`. */
export function atomicWriteFileSync(finalPath: string, tmpPath: string, data: Buffer): void {
  const fd = openSync(tmpPath, 'w')
  try {
    let off = 0
    while (off < data.length) off += writeSync(fd, data, off, data.length - off)
    fsyncSync(fd)
  } catch (err) {
    try { closeSync(fd) } catch { /* ignore */ }
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
    throw err
  }
  closeSync(fd)
  try {
    renameSync(tmpPath, finalPath)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
    throw err
  }
}
