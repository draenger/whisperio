import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { verifyAuthenticode, type SignerPins } from '../src/main/updateSignature/authenticode'
import { child, parseDer, TAG, type DerNode } from '../src/main/updateSignature/der'

// Optional PKCS#7 SignedData parts the pinned fixture does not carry: a CRL field [1] after the
// certificates, and a non-certificate entry inside the certificate set. Neither is covered by the
// signature (it signs only the authenticated attributes), so both are legal and must not break
// verification; a missing certificate set must be refused by its own check.

const TEST_PIN: SignerPins = { spkiSha256: ['2D4546D608C512052B381FF6BE79539A3BE4C3261C6109B4CF53366B3BC1EE25'] }
const fixture = readFileSync(join(__dirname, 'fixtures', 'updateSignature', 'pinned-sha256.exe'))
const tmp = mkdtempSync(join(tmpdir(), 'whisperio-authenticode-structure-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Placeholder DER element of 8 bytes: [tag] { OCTET STRING(4) }. */
const element = (tag: number): Buffer => Buffer.from([tag, 0x06, 0x04, 0x04, 0x00, 0x00, 0x00, 0x00])

function secDir(b: Buffer): number {
  const opt = b.readUInt32LE(0x3c) + 24
  return opt + (b.readUInt16LE(opt) === 0x20b ? 112 : 96) + 32
}

function header(tag: number, len: number): Buffer {
  if (len < 0x80) return Buffer.from([tag, len])
  const bytes: number[] = []
  for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff)
  return Buffer.from([tag, 0x80 | bytes.length, ...bytes])
}

/** Re-encodes `node`, inserting `extra` as child number `at` of `target` (lengths fixed on the way up). */
function rebuild(blob: Buffer, node: DerNode, target: DerNode, at: number, extra: Buffer): Buffer {
  const inside = target.start >= node.start && target.end <= node.end
  if (!inside) return blob.subarray(node.start, node.end)
  const parts = node.children.map((c) => rebuild(blob, c, target, at, extra))
  if (node === target) parts.splice(at, 0, extra)
  const body = Buffer.concat(parts)
  return Buffer.concat([header(node.tag, body.length), body])
}

interface Parts {
  blob: Buffer
  contentInfo: DerNode
  signedData: DerNode
  certs: DerNode
}

function parts(b: Buffer): Parts {
  const table = b.readUInt32LE(secDir(b))
  const blob = b.subarray(table + 8, table + b.readUInt32LE(table))
  const contentInfo = parseDer(blob)
  const signedData = child(child(contentInfo, 1, TAG.CTX0), 0, TAG.SEQUENCE)
  const certs = child(signedData, 3, TAG.CTX0)
  return { blob, contentInfo, signedData, certs }
}

/** Fixture with a new PKCS#7 blob: one WIN_CERTIFICATE entry, padded to 8, security dir resized. */
function withBlob(name: string, newBlob: Buffer): string {
  const table = fixture.readUInt32LE(secDir(fixture))
  const pad = (8 - ((8 + newBlob.length) % 8)) % 8
  const entry = Buffer.concat([Buffer.alloc(8), newBlob, Buffer.alloc(pad)])
  entry.writeUInt32LE(entry.length, 0)
  entry.writeUInt16LE(0x0200, 4)
  entry.writeUInt16LE(0x0002, 6)
  const out = Buffer.concat([fixture.subarray(0, table), entry])
  out.writeUInt32LE(entry.length, secDir(out) + 4)
  const p = join(tmp, name)
  writeFileSync(p, out)
  return p
}

describe('verifyAuthenticode: optional SignedData parts', () => {
  it('the rebuild helper is neutral: re-encoding the untouched fixture still verifies', async () => {
    const { blob, contentInfo } = parts(fixture)
    const same = rebuild(blob, contentInfo, contentInfo, contentInfo.children.length, Buffer.alloc(0))
    expect(same.equals(blob.subarray(0, contentInfo.end))).toBe(true)
    expect(await verifyAuthenticode(withBlob('neutral.exe', same), TEST_PIN)).toMatchObject({ ok: true })
  })

  it('accepts a signature that carries a CRL field [1] between the certificates and the signer infos', async () => {
    const { blob, contentInfo, signedData } = parts(fixture)
    expect(signedData.children[4].tag).toBe(TAG.SET) // the fixture has no CRL field yet
    const p = withBlob('with-crls.exe', rebuild(blob, contentInfo, signedData, 4, element(TAG.CTX1)))
    expect(parts(readFileSync(p)).signedData.children[4].tag).toBe(TAG.CTX1)
    expect(await verifyAuthenticode(p, TEST_PIN)).toMatchObject({ ok: true, digest: 'sha256' })
  })

  it('skips a non-certificate entry (attribute certificate [2]) inside the certificate set', async () => {
    const { blob, contentInfo, certs } = parts(fixture)
    const p = withBlob('attr-cert.exe', rebuild(blob, contentInfo, certs, 0, element(0xa2)))
    expect(parts(readFileSync(p)).certs.children[0].tag).toBe(0xa2)
    expect(await verifyAuthenticode(p, TEST_PIN)).toMatchObject({ ok: true, digest: 'sha256' })
  })

  it('rejects SignedData without a certificate set', async () => {
    const { blob, contentInfo, certs } = parts(fixture)
    const edited = Buffer.from(blob.subarray(0, contentInfo.end))
    edited[certs.start] = 0xa2 // [0] certificates retagged, so no certificate set is present
    expect(await verifyAuthenticode(withBlob('no-certs.exe', edited), TEST_PIN)).toEqual({
      ok: false,
      reason: 'no certificates in signature'
    })
  })
})
