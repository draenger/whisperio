import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { createHash } from 'crypto'

/** downloadFileSecure with a SHA-256 pin: checked before promotion and before any record is stored. */
const testDir = join(tmpdir(), `whisperio-pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const netRequest = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  net: { request: (...args: unknown[]) => netRequest(...args) }
}))

import { downloadFileSecure } from '../src/main/modelManager'
import { getStoredHash } from '../src/main/downloadIntegrity'

type Handler = (...args: any[]) => void
function fakeReq() {
  const h = new Map<string, Handler[]>()
  const req = {
    on: (e: string, cb: Handler) => { h.set(e, [...(h.get(e) ?? []), cb]); return req },
    end: vi.fn(), abort: vi.fn(), followRedirect: vi.fn(),
    emit: (e: string, ...a: any[]) => { for (const cb of h.get(e) ?? []) cb(...a) }
  }
  return req
}
function fakeRes(len: number) {
  const h = new Map<string, Handler[]>()
  return {
    statusCode: 200,
    headers: { 'content-length': String(len) },
    on: (e: string, cb: Handler) => { h.set(e, [...(h.get(e) ?? []), cb]) },
    emit: (e: string, ...a: any[]) => { for (const cb of h.get(e) ?? []) cb(...a) }
  }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))
const URL_OK = 'https://huggingface.co/x/y/resolve/abc/f.bin'

async function run(pin: string | null, body: Buffer): Promise<{ result: Promise<string>; dest: string }> {
  const dest = join(testDir, 'models', 'pk', 'f.bin')
  const req = fakeReq()
  netRequest.mockReturnValue(req)
  const result = downloadFileSecure('parakeet:f.bin', URL_OK, dest, pin)
  result.catch(() => {})
  const res = fakeRes(body.length)
  req.emit('response', res)
  res.emit('data', body)
  await tick()
  res.emit('end')
  await tick()
  return { result, dest }
}

describe('downloadFileSecure with a pin', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(join(testDir, 'models', 'pk'), { recursive: true })
    netRequest.mockReset()
  })
  afterEach(() => rmSync(testDir, { recursive: true, force: true }))

  it('a pin mismatch rejects, does not promote the file and leaves NO stored integrity record', async () => {
    const body = Buffer.from('corrupt-bytes')
    const { result, dest } = await run('ab'.repeat(32), body)
    await expect(result).rejects.toThrow(/SHA-256 mismatch/)
    expect(existsSync(dest)).toBe(false)
    expect(getStoredHash('parakeet:f.bin')).toBeNull()
  })

  it('after a rejected file, a later correct download is not blocked by a wrong TOFU record', async () => {
    await (await run('ab'.repeat(32), Buffer.from('bad'))).result.catch(() => {})
    const good = Buffer.from('good-bytes')
    const pin = createHash('sha256').update(good).digest('hex')
    const { result, dest } = await run(pin, good)
    await expect(result).resolves.toBe(dest)
    expect(getStoredHash('parakeet:f.bin')).toBe(pin)
  })
})
