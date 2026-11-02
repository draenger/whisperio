import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { open } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { readLayout, readSignature, imageHash } from '../src/main/updateSignature/peImage'

const dir = mkdtempSync(join(tmpdir(), 'pe-image-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const PE_OFFSET = 0x80
const OPT = PE_OFFSET + 24
let seq = 0

interface Opts {
  magic?: number
  mz?: boolean
  peSig?: boolean
  payloadLen?: number
  /** raw WIN_CERTIFICATE table appended after the payload (8-aligned); omit for unsigned */
  cert?: Buffer
}

/** Minimal synthetic PE with deterministic non-zero filler. */
function buildPe(o: Opts = {}): { path: string; buf: Buffer } {
  const magic = o.magic ?? 0x10b
  const headerEnd = OPT + (magic === 0x20b ? 240 : 224)
  const base = Math.ceil((headerEnd + (o.payloadLen ?? 64)) / 8) * 8
  const cert = o.cert
  const buf = Buffer.alloc(base + (cert?.length ?? 0))
  for (let i = 0; i < base; i++) buf[i] = (i * 31 + 7) & 0xff
  if (o.mz !== false) buf.writeUInt16LE(0x5a4d, 0)
  buf.writeUInt32LE(PE_OFFSET, 0x3c)
  buf.writeUInt32LE(o.peSig === false ? 0 : 0x00004550, PE_OFFSET)
  buf.writeUInt16LE(magic, OPT)
  const secDir = OPT + (magic === 0x20b ? 112 : 96) + 32
  if (cert) {
    buf.writeUInt32LE(base, secDir)
    buf.writeUInt32LE(cert.length, secDir + 4)
    cert.copy(buf, base)
  } else {
    buf.writeUInt32LE(0, secDir)
    buf.writeUInt32LE(0, secDir + 4)
  }
  const path = join(dir, `pe-${seq++}.bin`)
  writeFileSync(path, buf)
  return { path, buf }
}

function winCert(
  blob: Buffer,
  over: { revision?: number; type?: number; length?: number; pad?: number } = {}
): Buffer {
  const length = over.length ?? 8 + blob.length
  const total = Math.ceil((8 + blob.length) / 8) * 8 + (over.pad ?? 0)
  const t = Buffer.alloc(total)
  t.writeUInt32LE(length, 0)
  t.writeUInt16LE(over.revision ?? 0x0200, 4)
  t.writeUInt16LE(over.type ?? 0x0002, 6)
  blob.copy(t, 8)
  return t
}

async function withFile<T>(path: string, fn: (fh: FileHandle) => Promise<T>): Promise<T> {
  const fh = await open(path, 'r')
  try {
    return await fn(fh)
  } finally {
    await fh.close()
  }
}

const sigOf = (path: string): Promise<Buffer> =>
  withFile(path, async (fh) => readSignature(fh, await readLayout(fh)))

describe('readLayout', () => {
  it('locates checksum, security directory and cert table for PE32', async () => {
    const { path, buf } = buildPe({ cert: winCert(Buffer.from('sig')) })
    const l = await withFile(path, readLayout)
    expect(l.size).toBe(buf.length)
    expect(l.checksumOffset).toBe(OPT + 64)
    expect(l.securityDirOffset).toBe(OPT + 96 + 32)
    expect(l.certTableOffset).toBe(buf.length - 16)
    expect(l.certTableSize).toBe(16)
  })

  it('uses the larger data-directory offset for PE32+ (0x20b)', async () => {
    const { path } = buildPe({ magic: 0x20b, cert: winCert(Buffer.from('sig')) })
    const l = await withFile(path, readLayout)
    expect(l.securityDirOffset).toBe(OPT + 112 + 32)
    expect(l.certTableSize).toBe(16)
  })

  it('reports an unsigned file as a zero cert table', async () => {
    const l = await withFile(buildPe().path, readLayout)
    expect(l.certTableOffset).toBe(0)
    expect(l.certTableSize).toBe(0)
  })

  it('rejects non-PE inputs with specific errors', async () => {
    await expect(withFile(buildPe({ mz: false }).path, readLayout)).rejects.toThrow('no MZ')
    await expect(withFile(buildPe({ peSig: false }).path, readLayout)).rejects.toThrow('no PE signature')
    await expect(withFile(buildPe({ magic: 0x1234 }).path, readLayout)).rejects.toThrow('unknown optional header magic')
    const tiny = join(dir, 'tiny.bin')
    writeFileSync(tiny, Buffer.alloc(10))
    await expect(withFile(tiny, readLayout)).rejects.toThrow('PE truncated')
  })

  it('rejects a PE header offset pointing past the end of the file', async () => {
    const { path, buf } = buildPe()
    buf.writeUInt32LE(buf.length, 0x3c)
    writeFileSync(path, buf)
    await expect(withFile(path, readLayout)).rejects.toThrow('PE header out of range')
  })
})

describe('readSignature', () => {
  it('returns the PKCS#7 blob without the WIN_CERTIFICATE header or padding', async () => {
    const out = await sigOf(buildPe({ cert: winCert(Buffer.from('PKCS7-BLOB!')) }).path)
    expect(out.toString()).toBe('PKCS7-BLOB!')
  })

  it('refuses unsigned files', async () => {
    await expect(sigOf(buildPe().path)).rejects.toThrow('not signed')
  })

  it('refuses unsupported revision / type', async () => {
    await expect(sigOf(buildPe({ cert: winCert(Buffer.from('x'), { revision: 0x0100 }) }).path)).rejects.toThrow(
      'unsupported WIN_CERTIFICATE'
    )
    await expect(sigOf(buildPe({ cert: winCert(Buffer.from('x'), { type: 0x0001 }) }).path)).rejects.toThrow(
      'unsupported WIN_CERTIFICATE'
    )
  })

  it('refuses a bad WIN_CERTIFICATE length (too small / larger than the table)', async () => {
    await expect(sigOf(buildPe({ cert: winCert(Buffer.from('xxxxxxxx'), { length: 4 }) }).path)).rejects.toThrow(
      'bad WIN_CERTIFICATE length'
    )
    await expect(sigOf(buildPe({ cert: winCert(Buffer.from('xxxxxxxx'), { length: 4096 }) }).path)).rejects.toThrow(
      'bad WIN_CERTIFICATE length'
    )
  })

  it('refuses extra entries / slack and non-zero padding', async () => {
    await expect(sigOf(buildPe({ cert: winCert(Buffer.from('abcdefgh'), { pad: 8 }) }).path)).rejects.toThrow(
      'slack or extra entries'
    )
    // length 10 -> padded to 16; smuggle a non-zero byte into the padding
    const t = winCert(Buffer.from('ab'))
    t[t.length - 1] = 0x41
    await expect(sigOf(buildPe({ cert: t }).path)).rejects.toThrow('padding is not zero')
  })

  it('refuses data appended after the cert table (not covered by the signature)', async () => {
    const { path, buf } = buildPe({ cert: winCert(Buffer.from('sig')) })
    writeFileSync(path, Buffer.concat([buf, Buffer.from('EVIL-TRAILER')]))
    await expect(sigOf(path)).rejects.toThrow('not at the end')
  })

  it('refuses an oversized (>1 MiB) certificate table', async () => {
    await expect(sigOf(buildPe({ cert: winCert(Buffer.alloc((1 << 20) + 16)) }).path)).rejects.toThrow('too large')
  })

  it('refuses a misaligned cert table offset', async () => {
    const { path, buf } = buildPe({ cert: winCert(Buffer.from('sig')) })
    const l = await withFile(path, readLayout)
    buf.writeUInt32LE(l.certTableOffset + 4, l.securityDirOffset)
    buf.writeUInt32LE(l.certTableSize - 4, l.securityDirOffset + 4)
    writeFileSync(path, buf)
    await expect(sigOf(path)).rejects.toThrow('misaligned')
  })
})

function expectedHash(buf: Buffer, l: Awaited<ReturnType<typeof readLayout>>, algo: string): Buffer {
  return createHash(algo)
    .update(buf.subarray(0, l.checksumOffset))
    .update(buf.subarray(l.checksumOffset + 4, l.securityDirOffset))
    .update(buf.subarray(l.securityDirOffset + 8, l.certTableOffset))
    .digest()
}

describe('imageHash', () => {
  it('hashes the file minus checksum, security dir entry and cert table', async () => {
    const { path, buf } = buildPe({ cert: winCert(Buffer.from('sig')) })
    const l = await withFile(path, readLayout)
    const got = await withFile(path, (fh) => imageHash(fh, l, 'sha256'))
    expect(got.equals(expectedHash(buf, l, 'sha256'))).toBe(true)
  })

  it('ignores the excluded regions but reacts to any other byte', async () => {
    const { path, buf } = buildPe({ cert: winCert(Buffer.from('sig')) })
    const l = await withFile(path, readLayout)
    const base = await withFile(path, (fh) => imageHash(fh, l, 'sha256'))

    const excluded = Buffer.from(buf)
    excluded.writeUInt32LE(0xdeadbeef, l.checksumOffset)
    excluded[l.certTableOffset + 9] ^= 0xff
    writeFileSync(path, excluded)
    expect((await withFile(path, (fh) => imageHash(fh, l, 'sha256'))).equals(base)).toBe(true)

    const tampered = Buffer.from(buf)
    tampered[l.securityDirOffset + 8] ^= 0x01 // first covered byte after the dir entry
    writeFileSync(path, tampered)
    expect((await withFile(path, (fh) => imageHash(fh, l, 'sha256'))).equals(base)).toBe(false)
  })

  it('supports other algorithms and streams payloads larger than one 1 MiB chunk', async () => {
    const { path, buf } = buildPe({ payloadLen: (1 << 20) + 4096, cert: winCert(Buffer.from('sig')) })
    const l = await withFile(path, readLayout)
    const got = await withFile(path, (fh) => imageHash(fh, l, 'sha1'))
    expect(got.equals(expectedHash(buf, l, 'sha1'))).toBe(true)
  })

  it('fails when the file is shorter than the layout claims', async () => {
    const { path, buf } = buildPe({ cert: winCert(Buffer.from('sig')) })
    const l = await withFile(path, readLayout)
    writeFileSync(path, buf.subarray(0, l.certTableOffset - 10))
    await expect(withFile(path, (fh) => imageHash(fh, l, 'sha256'))).rejects.toThrow('PE truncated')
  })
})
