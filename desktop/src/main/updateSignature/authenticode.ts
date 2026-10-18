/**
 * Authenticode verification in pure Node (no script shell, no native addon): Bitdefender
 * blocks script shells spawned by the app, which is what electron-updater's built-in
 * check does. Trust anchor = a pinned signer-certificate SHA-1 thumbprint, not a CN and
 * not the Windows trust store, so a different cert with the same name is rejected.
 *
 * Checks, all required:
 *  1. PE certificate table present, last in the file, one PKCS#7 SignedData blob;
 *  2. SpcIndirectDataContent digest == Authenticode image hash of the file (sha256+ only);
 *  3. signed attribute messageDigest == hash of the SpcIndirectDataContent;
 *  4. the signer's signature over the signed attributes verifies with the signer cert key;
 *  5. the signer cert's thumbprint is pinned.
 * Not checked: chain/expiry/timestamps (the pin replaces the chain) and nested signatures.
 */

import { X509Certificate, createHash, verify } from 'crypto'
import { open } from 'fs/promises'
import { TAG, child, content, encoded, oid, parseDer, type DerNode } from './der'
import { imageHash, readLayout, readSignature } from './peImage'

export type AuthenticodeResult = { ok: true; thumbprint: string; digest: string } | { ok: false; reason: string }

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_SPC_INDIRECT_DATA = '1.3.6.1.4.1.311.2.1.4'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3'
const DIGESTS: Record<string, string> = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512'
}

function digestName(buf: Uint8Array, algId: DerNode): string {
  const id = oid(buf, child(algId, 0, TAG.OID))
  const name = DIGESTS[id]
  if (!name) throw new Error(`digest algorithm ${id} not accepted (sha256/384/512 only)`)
  return name
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

function findSignerCert(buf: Uint8Array, certs: DerNode, issuer: Uint8Array, serial: Uint8Array): Uint8Array {
  for (const c of certs.children) {
    if (c.tag !== TAG.SEQUENCE) continue
    const tbs = child(c, 0, TAG.SEQUENCE)
    const hasVersion = tbs.children[0]?.tag === TAG.CTX0
    const certSerial = child(tbs, hasVersion ? 1 : 0, TAG.INTEGER)
    const certIssuer = child(tbs, hasVersion ? 3 : 2, TAG.SEQUENCE)
    if (same(content(buf, certSerial), serial) && same(encoded(buf, certIssuer), issuer)) return encoded(buf, c)
  }
  throw new Error('signer certificate not embedded')
}

export async function verifyAuthenticode(file: string, pinnedThumbprints: readonly string[]): Promise<AuthenticodeResult> {
  const pins = pinnedThumbprints.map((t) => t.replace(/[^0-9a-f]/gi, '').toUpperCase())
  let fh: Awaited<ReturnType<typeof open>> | null = null
  try {
    fh = await open(file, 'r')
    const layout = await readLayout(fh)
    const buf = await readSignature(fh, layout)

    const contentInfo = parseDer(buf)
    // Only zero padding (signtool aligns the blob) may follow the signature inside the entry.
    if (buf.length - contentInfo.end >= 8 || buf.subarray(contentInfo.end).some((b) => b !== 0)) {
      throw new Error('unsigned data after the signature blob')
    }
    if (oid(buf, child(contentInfo, 0, TAG.OID)) !== OID_SIGNED_DATA) throw new Error('not PKCS#7 SignedData')
    const signedData = child(child(contentInfo, 1, TAG.CTX0), 0, TAG.SEQUENCE)

    // 2. The file hash the signer committed to.
    const encap = child(signedData, 2, TAG.SEQUENCE)
    if (oid(buf, child(encap, 0, TAG.OID)) !== OID_SPC_INDIRECT_DATA) throw new Error('not an Authenticode signature')
    const spc = child(child(encap, 1, TAG.CTX0), 0, TAG.SEQUENCE)
    const digestInfo = child(spc, 1, TAG.SEQUENCE)
    const imageAlg = digestName(buf, child(digestInfo, 0, TAG.SEQUENCE))
    const committed = content(buf, child(digestInfo, 1, TAG.OCTET_STRING))
    if (!same(await imageHash(fh, layout, imageAlg), committed)) return { ok: false, reason: 'file hash does not match the signature (modified file)' }

    // Signer info (the first one; nested signatures are ignored).
    let idx = 3
    const certs = signedData.children[idx]?.tag === TAG.CTX0 ? signedData.children[idx++] : null
    if (!certs) throw new Error('no certificates in signature')
    if (signedData.children[idx]?.tag === TAG.CTX1) idx++
    const signerInfo = child(child(signedData, idx, TAG.SET), 0, TAG.SEQUENCE)
    const sid = child(signerInfo, 1, TAG.SEQUENCE)
    const signerAlg = digestName(buf, child(signerInfo, 2, TAG.SEQUENCE))
    const attrs = child(signerInfo, 3, TAG.CTX0)
    const signature = content(buf, child(signerInfo, 5, TAG.OCTET_STRING))

    // 3. contentType attribute says SpcIndirectData; messageDigest == hash(SpcIndirectDataContent contents).
    const ct = attrs.children.find((a) => oid(buf, child(a, 0, TAG.OID)) === OID_CONTENT_TYPE)
    if (!ct || oid(buf, child(child(ct, 1, TAG.SET), 0, TAG.OID)) !== OID_SPC_INDIRECT_DATA) throw new Error('signed contentType is not SpcIndirectData')
    const md = attrs.children.find((a) => oid(buf, child(a, 0, TAG.OID)) === OID_MESSAGE_DIGEST)
    if (!md) throw new Error('no messageDigest attribute')
    const mdValue = content(buf, child(child(md, 1, TAG.SET), 0, TAG.OCTET_STRING))
    if (!same(createHash(signerAlg).update(content(buf, spc)).digest(), mdValue)) {
      return { ok: false, reason: 'signed attributes do not match the signed content' }
    }

    // 4. Signature over the attributes, re-tagged as SET OF (0x31) per CMS.
    const certDer = findSignerCert(buf, certs, encoded(buf, child(sid, 0, TAG.SEQUENCE)), content(buf, child(sid, 1, TAG.INTEGER)))
    const signed = Buffer.from(encoded(buf, attrs))
    signed[0] = TAG.SET
    const cert = new X509Certificate(Buffer.from(certDer))
    if (!verify(signerAlg, signed, cert.publicKey, Buffer.from(signature))) return { ok: false, reason: 'signature does not verify' }

    // 5. Pinned signer.
    const thumbprint = createHash('sha1').update(certDer).digest('hex').toUpperCase()
    if (!pins.includes(thumbprint)) return { ok: false, reason: `signer ${thumbprint} (${cert.subject.replace(/\n/g, ', ')}) is not a pinned publisher` }
    return { ok: true, thumbprint, digest: imageAlg }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  } finally {
    await fh?.close()
  }
}
