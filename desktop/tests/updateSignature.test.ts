import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { verifyAuthenticode } from '../src/main/updateSignature/authenticode'
import { createUpdateVerifier } from '../src/main/updateSignature/updateVerifier'

// Fixtures are signed with a THROWAWAY test cert (never the release cert, so no committed binary is a
// valid release update). See fixtures/updateSignature/README.md.
const TEST_PIN = ['F52FCA9BE37A14C24FF516628067F177AF6A7B96']
const fx = (name: string): string => join(__dirname, 'fixtures', 'updateSignature', name)
const tmp = mkdtempSync(join(tmpdir(), 'whisperio-authenticode-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Copy of the pinned fixture with `edit` applied to its bytes. */
function variant(name: string, edit: (b: Buffer) => Buffer): string {
  const p = join(tmp, name)
  writeFileSync(p, edit(readFileSync(fx('pinned-sha256.exe'))))
  return p
}
function secDir(b: Buffer): number {
  const opt = b.readUInt32LE(0x3c) + 24
  return opt + (b.readUInt16LE(opt) === 0x20b ? 112 : 96) + 32
}

describe('verifyAuthenticode', () => {
  it('accepts a sha256 signature by the pinned cert', async () => {
    expect(await verifyAuthenticode(fx('pinned-sha256.exe'), TEST_PIN)).toEqual({ ok: true, thumbprint: TEST_PIN[0], digest: 'sha256' })
  })

  it('rejects an unsigned file', async () => {
    expect(await verifyAuthenticode(fx('unsigned.exe'), TEST_PIN)).toEqual({ ok: false, reason: 'file is not signed' })
  })

  it('rejects a valid signature by a different cert with the same CN as the release cert', async () => {
    const r = await verifyAuthenticode(fx('foreign-sha256.exe'), ['2A917C6457B67B928C52413DB00FA34CAAF15206'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Jarvis \(Daniel Kasprzyk\)\) is not a pinned publisher/)
  })

  it('rejects a sha1 signature even from the pinned cert', async () => {
    const r = await verifyAuthenticode(fx('pinned-sha1.exe'), TEST_PIN)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not accepted/)
  })

  it('rejects one changed byte in the signed image', async () => {
    const p = variant('tampered.exe', (b) => { b[2000] ^= 0xff; return b })
    expect(await verifyAuthenticode(p, TEST_PIN)).toEqual({ ok: false, reason: 'file hash does not match the signature (modified file)' })
  })

  it('rejects one changed byte in the signature value', async () => {
    const p = variant('badsig.exe', (b) => {
      const table = b.readUInt32LE(secDir(b))
      const blobEnd = table + b.readUInt32LE(table)
      b[blobEnd - 40] ^= 0x01 // inside encryptedDigest, the last field of the signer info
      return b
    })
    expect(await verifyAuthenticode(p, TEST_PIN)).toEqual({ ok: false, reason: 'signature does not verify' })
  })

  it('rejects data appended after the certificate table', async () => {
    const p = join(tmp, 'appended.exe')
    copyFileSync(fx('pinned-sha256.exe'), p)
    appendFileSync(p, Buffer.from('payload'))
    expect((await verifyAuthenticode(p, TEST_PIN)).ok).toBe(false)
  })

  it('rejects a payload hidden in the table by growing the security-dir size (CVE-2013-3900 style)', async () => {
    const p = variant('slack.exe', (b) => {
      const extra = Buffer.alloc(4096, 0x41)
      const out = Buffer.concat([b, extra])
      out.writeUInt32LE(out.readUInt32LE(secDir(out) + 4) + extra.length, secDir(out) + 4)
      return out
    })
    expect(await verifyAuthenticode(p, TEST_PIN)).toEqual({ ok: false, reason: 'certificate table has slack or extra entries' })
  })

  it('rejects a payload hidden after the PKCS#7 blob by growing dwLength too', async () => {
    const p = variant('dwlength.exe', (b) => {
      const extra = Buffer.alloc(4096, 0x41)
      const out = Buffer.concat([b, extra])
      const sd = secDir(out)
      out.writeUInt32LE(out.readUInt32LE(sd + 4) + extra.length, sd + 4)
      const table = out.readUInt32LE(sd)
      out.writeUInt32LE(out.readUInt32LE(table) + extra.length, table)
      return out
    })
    expect(await verifyAuthenticode(p, TEST_PIN)).toEqual({ ok: false, reason: 'unsigned data after the signature blob' })
  })

  it('rejects a second WIN_CERTIFICATE entry', async () => {
    const p = variant('second.exe', (b) => {
      const entry = Buffer.alloc(64, 0x42)
      entry.writeUInt32LE(64, 0); entry.writeUInt16LE(0x0200, 4); entry.writeUInt16LE(0x0002, 6)
      const out = Buffer.concat([b, entry])
      out.writeUInt32LE(out.readUInt32LE(secDir(out) + 4) + entry.length, secDir(out) + 4)
      return out
    })
    expect(await verifyAuthenticode(p, TEST_PIN)).toEqual({ ok: false, reason: 'certificate table has slack or extra entries' })
  })

  it('rejects a non-PE and a missing file without throwing', async () => {
    const p = join(tmp, 'notpe.exe')
    writeFileSync(p, Buffer.alloc(4096, 0x41))
    expect((await verifyAuthenticode(p, TEST_PIN)).ok).toBe(false)
    expect((await verifyAuthenticode(join(tmp, 'missing.exe'), TEST_PIN)).ok).toBe(false)
  })
})

describe('createUpdateVerifier (electron-updater hook)', () => {
  it('returns null for a good update and an error string otherwise', async () => {
    const logs: string[] = []
    const v = createUpdateVerifier(TEST_PIN, (m) => logs.push(m))
    expect(await v([], fx('pinned-sha256.exe'))).toBeNull()
    expect(await v([], fx('foreign-sha256.exe'))).toMatch(/^update signature rejected/)
    expect(await v([], fx('unsigned.exe'))).toMatch(/not signed/)
    expect(logs.some((l) => l.includes('REJECTED'))).toBe(true)
  })

  it('the production pin is the release cert, not the test cert', async () => {
    const { PINNED_UPDATE_SIGNERS } = await import('../src/main/updateSignature/updateVerifier')
    expect(PINNED_UPDATE_SIGNERS).toEqual(['2A917C6457B67B928C52413DB00FA34CAAF15206'])
    expect((await verifyAuthenticode(fx('pinned-sha256.exe'), PINNED_UPDATE_SIGNERS)).ok).toBe(false)
  })
})
