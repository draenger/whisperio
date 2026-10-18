/**
 * PE layout for Authenticode: where the checksum, the security directory and the
 * certificate table are, and the Authenticode image hash (the file minus those three).
 * Reads with a file handle in chunks, so a 120 MB installer is never fully in memory.
 */

import { createHash } from 'crypto'
import type { FileHandle } from 'fs/promises'

export interface PeLayout {
  size: number
  checksumOffset: number
  securityDirOffset: number
  certTableOffset: number
  certTableSize: number
}

const CHUNK = 1 << 20
const MAX_CERT_TABLE = 1 << 20 // a real signature block is a few KB

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len)
  const { bytesRead } = await fh.read(buf, 0, len, pos)
  if (bytesRead !== len) throw new Error('PE truncated')
  return buf
}

export async function readLayout(fh: FileHandle): Promise<PeLayout> {
  const size = (await fh.stat()).size
  const dos = await readAt(fh, 0, 64)
  if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE file (no MZ)')
  const peOffset = dos.readUInt32LE(0x3c)
  if (peOffset + 24 + 128 > size) throw new Error('PE header out of range')
  const hdr = await readAt(fh, peOffset, 24 + 2)
  if (hdr.readUInt32LE(0) !== 0x00004550) throw new Error('not a PE file (no PE signature)')
  const optHeader = peOffset + 24
  const magic = hdr.readUInt16LE(24)
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('unknown optional header magic')
  const checksumOffset = optHeader + 64
  const securityDirOffset = optHeader + (magic === 0x20b ? 112 : 96) + 4 * 8
  const dir = await readAt(fh, securityDirOffset, 8)
  const certTableOffset = dir.readUInt32LE(0)
  const certTableSize = dir.readUInt32LE(4)
  return { size, checksumOffset, securityDirOffset, certTableOffset, certTableSize }
}

/**
 * The PKCS#7 blob of the first WIN_CERTIFICATE. The table must be the last thing in the
 * file: data appended after a signature would not be covered by it, so it is rejected.
 */
export async function readSignature(fh: FileHandle, l: PeLayout): Promise<Buffer> {
  if (l.certTableOffset === 0 || l.certTableSize === 0) throw new Error('file is not signed')
  if (l.certTableSize > MAX_CERT_TABLE) throw new Error('certificate table too large')
  if (l.certTableOffset < l.securityDirOffset + 8 || l.certTableOffset + l.certTableSize !== l.size) {
    throw new Error('certificate table is not at the end of the file')
  }
  if (l.certTableOffset % 8 !== 0) throw new Error('certificate table misaligned')
  const table = await readAt(fh, l.certTableOffset, l.certTableSize)
  const length = table.readUInt32LE(0)
  const revision = table.readUInt16LE(4)
  const type = table.readUInt16LE(6)
  if (revision !== 0x0200 || type !== 0x0002) throw new Error('unsupported WIN_CERTIFICATE')
  if (length < 8 || length > l.certTableSize) throw new Error('bad WIN_CERTIFICATE length')
  // The table is not covered by the signature: exactly ONE entry, padded to 8 bytes, nothing else
  // (unsigned bytes riding in table slack or in extra entries, CVE-2013-3900 style, are rejected).
  if (((length + 7) & ~7) !== l.certTableSize) throw new Error('certificate table has slack or extra entries')
  if (table.subarray(length).some((b) => b !== 0)) throw new Error('certificate table padding is not zero')
  return table.subarray(8, length)
}

/** Authenticode image hash: everything except the checksum, the security dir entry and the cert table. */
export async function imageHash(fh: FileHandle, l: PeLayout, algorithm: string): Promise<Buffer> {
  const h = createHash(algorithm)
  const ranges: Array<[number, number]> = [
    [0, l.checksumOffset],
    [l.checksumOffset + 4, l.securityDirOffset],
    [l.securityDirOffset + 8, l.certTableOffset]
  ]
  const buf = Buffer.alloc(CHUNK)
  for (const [from, to] of ranges) {
    for (let pos = from; pos < to; ) {
      const n = Math.min(CHUNK, to - pos)
      const { bytesRead } = await fh.read(buf, 0, n, pos)
      if (bytesRead !== n) throw new Error('PE truncated')
      h.update(buf.subarray(0, n))
      pos += n
    }
  }
  return h.digest()
}

