import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

// fs instrumentation: which paths received zero-writes, plus failure injection.
const h = vi.hoisted(() => ({
  fdPath: new Map<number, string>(),
  zeroed: [] as string[],
  failOpen: false,
  failWrite: false,
  failUnlink: false,
  failLink: false
}))

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    openSync: (p: string, flags: string, ...rest: unknown[]) => {
      if (h.failOpen && flags === 'r+') throw new Error('EACCES')
      const fd = (real.openSync as (...a: unknown[]) => number)(p, flags, ...rest)
      h.fdPath.set(fd, String(p))
      return fd
    },
    writeSync: (fd: number, buf: Buffer, ...rest: unknown[]) => {
      if (h.failWrite) throw new Error('EIO')
      if (Buffer.isBuffer(buf) && buf.every((b) => b === 0)) h.zeroed.push(h.fdPath.get(fd) ?? '?')
      return (real.writeSync as (...a: unknown[]) => number)(fd, buf, ...rest)
    },
    unlinkSync: (p: string) => {
      if (h.failUnlink) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      return real.unlinkSync(p)
    },
    linkSync: (a: string, b: string) => {
      if (h.failLink) throw Object.assign(new Error('EXDEV'), { code: 'EPERM' })
      return real.linkSync(a, b)
    }
  }
})

import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  renameSync,
  openSync,
  readSync,
  closeSync,
  statSync
} from 'fs'
import { secureDeleteFile, pinForWipe, releasePin, sweepPendingWipes, WIPE_SUFFIX } from '../src/main/secureDelete'

const dir = join(tmpdir(), `whisperio-sdel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const SECRET = 'plaintext-transcript-zebra-42 '.repeat(5000) // > one 64 KiB chunk

describe('secureDelete (L4)', () => {
  beforeEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true })
    mkdirSync(dir, { recursive: true })
    h.fdPath.clear()
    h.zeroed.length = 0
    h.failOpen = h.failWrite = h.failUnlink = h.failLink = false
  })
  afterEach(() => {
    h.failOpen = h.failWrite = h.failUnlink = h.failLink = false
    if (existsSync(dir)) rmSync(dir, { recursive: true })
  })

  it('overwrites a file with zeros over its whole length, then unlinks it', () => {
    const p = join(dir, 'a.webm')
    writeFileSync(p, SECRET)
    expect(secureDeleteFile(p)).toBe('wiped')
    expect(existsSync(p)).toBe(false)
    expect(h.zeroed.filter((x) => x === p).length).toBeGreaterThan(1) // chunked
  })

  it.skipIf(process.platform === 'win32')('the old bytes really are zeros (read through a held fd)', () => {
    const p = join(dir, 'b.webm')
    writeFileSync(p, SECRET)
    const fd = openSync(p, 'r')
    try {
      expect(secureDeleteFile(p)).toBe('wiped')
      const buf = Buffer.alloc(Buffer.byteLength(SECRET))
      readSync(fd, buf, 0, buf.length, 0)
      expect(buf.every((b) => b === 0)).toBe(true) // same length, never truncated
    } finally {
      closeSync(fd)
    }
  })

  it('a missing file is not an error', () => {
    expect(secureDeleteFile(join(dir, 'nope'))).toBe('unlinked')
  })

  it('an empty file is just unlinked', () => {
    const p = join(dir, 'empty')
    writeFileSync(p, '')
    expect(secureDeleteFile(p)).toBe('unlinked')
    expect(existsSync(p)).toBe(false)
  })

  it('overwrite failure (open or write) falls back to a plain unlink, never throws', () => {
    const p = join(dir, 'c')
    writeFileSync(p, SECRET)
    h.failOpen = true
    expect(secureDeleteFile(p)).toBe('unlinked')
    expect(existsSync(p)).toBe(false)
    writeFileSync(p, SECRET)
    h.failOpen = false
    h.failWrite = true
    expect(secureDeleteFile(p)).toBe('unlinked')
    expect(existsSync(p)).toBe(false)
  })

  it('unlink failure is reported as failed, never thrown', () => {
    const p = join(dir, 'd')
    writeFileSync(p, SECRET)
    h.failUnlink = true
    expect(secureDeleteFile(p)).toBe('failed')
  })

  it('never zeroes an inode that still has another name (nlink > 1)', () => {
    const p = join(dir, 'live.json')
    writeFileSync(p, SECRET)
    const pin = pinForWipe(p)
    expect(pin).toBe(`${p}${WIPE_SUFFIX}`)
    expect(statSync(p).nlink).toBe(2)
    // Replace failed: releasing the pin must leave the live file intact.
    expect(releasePin(pin)).toBe('unlinked')
    expect(readFileSync(p, 'utf-8')).toBe(SECRET)
    expect(h.zeroed).toEqual([])
  })

  it('pin + atomic replace + release zeroes the REPLACED plaintext, keeps the new file', () => {
    const p = join(dir, 'index.json')
    writeFileSync(p, SECRET)
    const pin = pinForWipe(p)
    writeFileSync(`${p}.tmp`, 'SEALED')
    renameSync(`${p}.tmp`, p)
    expect(releasePin(pin)).toBe('wiped')
    expect(h.zeroed).toContain(pin)
    expect(readFileSync(p, 'utf-8')).toBe('SEALED')
    expect(existsSync(pin!)).toBe(false)
  })

  it('pin returns null when hard links are unsupported or the file is missing', () => {
    expect(pinForWipe(join(dir, 'missing'))).toBeNull()
    const p = join(dir, 'e')
    writeFileSync(p, 'x')
    h.failLink = true
    expect(pinForWipe(p)).toBeNull()
    expect(releasePin(null)).toBeNull()
  })

  it('a stale pin is replaced, not reused', () => {
    const p = join(dir, 'f')
    writeFileSync(p, 'new')
    writeFileSync(`${p}${WIPE_SUFFIX}`, 'stale plaintext')
    const pin = pinForWipe(p)
    expect(readFileSync(pin!, 'utf-8')).toBe('new')
    expect(h.zeroed).toContain(pin) // the stale one (sole name) was zeroed
  })

  it('sweepPendingWipes wipes orphan pins, leaves other files, tolerates a missing dir', () => {
    writeFileSync(join(dir, `a.webm${WIPE_SUFFIX}`), SECRET)
    writeFileSync(join(dir, 'keep.webm'), 'k')
    expect(sweepPendingWipes(dir)).toBe(1)
    expect(existsSync(join(dir, `a.webm${WIPE_SUFFIX}`))).toBe(false)
    expect(existsSync(join(dir, 'keep.webm'))).toBe(true)
    expect(sweepPendingWipes(join(dir, 'nope'))).toBe(0)
  })

  it('sweepPendingWipes does not zero a pin that aliases a live file (crash before replace)', () => {
    const p = join(dir, 'g.webm')
    writeFileSync(p, SECRET)
    pinForWipe(p)
    h.zeroed.length = 0
    expect(sweepPendingWipes(dir)).toBe(1)
    expect(readFileSync(p, 'utf-8')).toBe(SECRET)
    expect(h.zeroed).toEqual([])
  })
})
