/**
 * Minimal strict DER reader for the Authenticode verifier (definite lengths only, no BER).
 * Every node keeps its absolute offsets so callers can hash/verify the exact encoded bytes.
 */

export interface DerNode {
  tag: number
  /** Offset of the tag byte. */
  start: number
  /** Offset of the first content byte. */
  contentStart: number
  /** Offset one past the last content byte. */
  end: number
  readonly children: DerNode[]
}

const MAX_DEPTH = 32

export function parseDer(buf: Uint8Array, offset = 0, limit = buf.length, depth = 0): DerNode {
  if (depth > MAX_DEPTH) throw new Error('DER nesting too deep')
  if (offset + 2 > limit) throw new Error('DER truncated header')
  const tag = buf[offset]
  if ((tag & 0x1f) === 0x1f) throw new Error('DER multi-byte tags unsupported')
  let p = offset + 1
  let len = buf[p++]
  if (len === 0x80) throw new Error('DER indefinite length not allowed')
  if (len & 0x80) {
    const n = len & 0x7f
    if (n > 4 || p + n > limit) throw new Error('DER bad length')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[p++]
  }
  const end = p + len
  if (end > limit) throw new Error('DER content past end')
  // Children are parsed lazily: only the path the verifier walks is decoded, so opaque or
  // BER-ish parts elsewhere in a signature (extensions, unsigned attributes) cannot break it.
  let kids: DerNode[] | null = null
  return {
    tag,
    start: offset,
    contentStart: p,
    end,
    get children(): DerNode[] {
      if (kids) return kids
      kids = []
      if (tag & 0x20) {
        for (let q = p; q < end; ) {
          const c = parseDer(buf, q, end, depth + 1)
          kids.push(c)
          q = c.end
        }
      }
      return kids
    }
  }
}

export function content(buf: Uint8Array, n: DerNode): Uint8Array {
  return buf.subarray(n.contentStart, n.end)
}

export function encoded(buf: Uint8Array, n: DerNode): Uint8Array {
  return buf.subarray(n.start, n.end)
}

export function child(n: DerNode, i: number, tag?: number): DerNode {
  const c = n.children[i]
  if (!c) throw new Error(`DER missing child ${i}`)
  if (tag !== undefined && c.tag !== tag) throw new Error(`DER child ${i}: tag 0x${c.tag.toString(16)} != 0x${tag.toString(16)}`)
  return c
}

/** Dotted OID string from an OBJECT IDENTIFIER node. */
export function oid(buf: Uint8Array, n: DerNode): string {
  if (n.tag !== 0x06) throw new Error('DER not an OID')
  const b = content(buf, n)
  if (b.length === 0) throw new Error('DER empty OID')
  const parts: number[] = [Math.floor(b[0] / 40), b[0] % 40]
  let v = 0
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f)
    if (!(b[i] & 0x80)) { parts.push(v); v = 0 }
  }
  return parts.join('.')
}

export const TAG = {
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  OID: 0x06,
  SEQUENCE: 0x30,
  SET: 0x31,
  CTX0: 0xa0,
  CTX1: 0xa1
} as const
