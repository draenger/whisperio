import { describe, it, expect } from 'vitest'
import { parseDer, child, content, encoded, oid, TAG } from '../src/main/updateSignature/der'

const u = (...b: number[]): Uint8Array => Uint8Array.from(b)

describe('parseDer', () => {
  it('parses a primitive node with absolute offsets', () => {
    const buf = u(0x04, 0x03, 1, 2, 3)
    const n = parseDer(buf)
    expect(n).toMatchObject({ tag: TAG.OCTET_STRING, start: 0, contentStart: 2, end: 5 })
    expect(n.children).toEqual([]) // primitive: no children
    expect(Array.from(content(buf, n))).toEqual([1, 2, 3])
    expect(Array.from(encoded(buf, n))).toEqual([0x04, 0x03, 1, 2, 3])
  })

  it('decodes nested constructed nodes and keeps offsets relative to the whole buffer', () => {
    // SEQUENCE { INTEGER 5, OCTET STRING "ab" } preceded by 2 junk bytes
    const buf = u(0xff, 0xff, 0x30, 0x07, 0x02, 0x01, 0x05, 0x04, 0x02, 0x61, 0x62)
    const n = parseDer(buf, 2)
    expect(n.tag).toBe(TAG.SEQUENCE)
    expect(n.children.map((c) => c.tag)).toEqual([TAG.INTEGER, TAG.OCTET_STRING])
    expect(n.children[1].start).toBe(7)
    expect(Array.from(content(buf, child(n, 1, TAG.OCTET_STRING)))).toEqual([0x61, 0x62])
  })

  it('reads long-form lengths (0x81 / 0x82)', () => {
    const body = new Uint8Array(300).fill(7)
    const buf = new Uint8Array([0x04, 0x82, 0x01, 0x2c, ...body])
    const n = parseDer(buf)
    expect(n.contentStart).toBe(4)
    expect(n.end - n.contentStart).toBe(300)
    expect(parseDer(u(0x04, 0x81, 0x02, 9, 9)).end).toBe(5)
  })

  it('caches children (same array instance on repeated access)', () => {
    const n = parseDer(u(0x30, 0x03, 0x02, 0x01, 0x01))
    expect(n.children).toBe(n.children)
  })

  it('rejects malformed input with specific errors', () => {
    expect(() => parseDer(u(0x04))).toThrow('truncated header')
    expect(() => parseDer(u())).toThrow('truncated header')
    expect(() => parseDer(u(0x1f, 0x00))).toThrow('multi-byte tags')
    expect(() => parseDer(u(0x30, 0x80, 0x00, 0x00))).toThrow('indefinite length')
    expect(() => parseDer(u(0x04, 0x85, 0, 0, 0, 0, 1))).toThrow('bad length') // 5 length octets
    expect(() => parseDer(u(0x04, 0x82, 0x01))).toThrow('bad length') // length octets past limit
    expect(() => parseDer(u(0x04, 0x05, 1, 2))).toThrow('content past end')
  })

  it('respects the limit: a child cannot extend past its parent', () => {
    // SEQUENCE of length 3 whose child claims 5 bytes (buffer has plenty more)
    const n = parseDer(u(0x30, 0x03, 0x04, 0x05, 1, 2, 3, 4, 5))
    expect(() => n.children).toThrow('content past end')
  })

  it('malformed parts the walk never touches do not break it (lazy children)', () => {
    // SEQUENCE { INTEGER 1, SEQUENCE { OCTET STRING with indefinite length } }
    const buf = u(0x30, 0x07, 0x02, 0x01, 0x01, 0x30, 0x02, 0x04, 0x80)
    const root = parseDer(buf)
    expect(root.children[0].tag).toBe(TAG.INTEGER)
    expect(() => root.children[1].children).toThrow('indefinite length')
  })

  it('rejects nesting deeper than 32 levels', () => {
    let inner = u(0x05, 0x00)
    for (let i = 0; i < 40; i++) {
      const out = new Uint8Array(2 + inner.length)
      out[0] = 0x30
      out[1] = inner.length
      out.set(inner, 2)
      inner = out
    }
    const walk = (n: ReturnType<typeof parseDer>): void => { n.children.forEach(walk) }
    expect(() => walk(parseDer(inner))).toThrow('nesting too deep')
  })
})

describe('child', () => {
  const n = parseDer(u(0x30, 0x03, 0x02, 0x01, 0x01))
  it('returns the child, optionally asserting the tag', () => {
    expect(child(n, 0).tag).toBe(TAG.INTEGER)
    expect(child(n, 0, TAG.INTEGER).tag).toBe(TAG.INTEGER)
  })
  it('throws on missing index and on tag mismatch (hex in message)', () => {
    expect(() => child(n, 1)).toThrow('missing child 1')
    expect(() => child(n, 0, TAG.SEQUENCE)).toThrow('child 0: tag 0x2 != 0x30')
  })
})

describe('oid', () => {
  const dec = (...b: number[]): string => {
    const buf = u(0x06, b.length, ...b)
    return oid(buf, parseDer(buf))
  }
  it('decodes the first two arcs from one byte', () => {
    expect(dec(0x2a, 0x03)).toBe('1.2.3')
    expect(dec(0x55, 0x04, 0x03)).toBe('2.5.4.3')
  })
  it('decodes multi-byte (base-128) arcs: pkcs7 signedData and sha256', () => {
    expect(dec(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02)).toBe('1.2.840.113549.1.7.2')
    expect(dec(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01)).toBe('2.16.840.1.101.3.4.2.1')
  })
  it('rejects non-OID nodes and empty OIDs', () => {
    const notOid = u(0x04, 0x01, 0x2a)
    expect(() => oid(notOid, parseDer(notOid))).toThrow('not an OID')
    const empty = u(0x06, 0x00)
    expect(() => oid(empty, parseDer(empty))).toThrow('empty OID')
  })
})
