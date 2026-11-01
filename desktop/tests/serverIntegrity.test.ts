import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { createHash } from 'crypto'

const testDir = join(tmpdir(), `whisperio-integ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const netRequest = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  net: { request: (...args: unknown[]) => netRequest(...args) }
}))

import { downloadModel, downloadCustomModel, deleteModel, getAvailableModels } from '../src/main/modelManager'
import { checkDigest, getStoredHash, storeHash, hashFile, IntegrityError } from '../src/main/downloadIntegrity'
import { verifyInstalledServer } from '../src/main/localServer'

const MODELS_DIR = join(testDir, 'models')
type Handler = (...args: any[]) => void
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 15))

function fakeReq(): any {
  const h = new Map<string, Handler[]>()
  const req: any = {
    on: (e: string, cb: Handler) => { h.set(e, [...(h.get(e) ?? []), cb]); return req },
    end: vi.fn(), abort: vi.fn(), followRedirect: vi.fn(),
    emit: (e: string, ...a: any[]) => (h.get(e) ?? []).forEach((cb) => cb(...a))
  }
  return req
}
function fakeRes(headers: Record<string, string> = {}): any {
  const h = new Map<string, Handler[]>()
  const res: any = {
    statusCode: 200, headers,
    on: (e: string, cb: Handler) => { h.set(e, [...(h.get(e) ?? []), cb]) },
    emit: (e: string, ...a: any[]) => (h.get(e) ?? []).forEach((cb) => cb(...a))
  }
  return res
}
async function feed(req: any, p: Promise<string>, body: Buffer, headers: Record<string, string>): Promise<string | Error> {
  const res = fakeRes(headers)
  req.emit('response', res)
  res.emit('data', body)
  await tick()
  res.emit('end')
  return p.then((v) => v, (e) => e as Error)
}
function start(fn: () => Promise<string>): { req: any; p: Promise<string> } {
  const req = fakeReq()
  netRequest.mockReturnValue(req)
  return { req, p: fn() }
}
const temps = (): string[] => (existsSync(MODELS_DIR) ? readdirSync(MODELS_DIR).filter((f) => f.endsWith('.downloading')) : [])

describe('download integrity (pin / TOFU)', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    netRequest.mockReset()
  })
  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    vi.restoreAllMocks()
  })

  it('pinned match is accepted; mismatch throws', () => {
    const body = Buffer.from('abc')
    expect(checkDigest('k', 'x', sha(body), sha(body)).mode).toBe('pinned')
    expect(() => checkDigest('k', 'x', sha(body), 'f'.repeat(64))).toThrow(/mismatch/i)
  })

  it('model: TOFU records hash on first download, later different body is rejected and removed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const good = Buffer.alloc(100, 1)
    const a = start(() => downloadModel('tiny'))
    const r1 = await feed(a.req, a.p, good, { 'content-length': '100' })
    expect(r1).toBe(join(MODELS_DIR, 'ggml-tiny.bin'))
    expect(getStoredHash('model:ggml-tiny.bin')).toBe(sha(good))

    const b = start(() => downloadModel('tiny'))
    expect(await feed(b.req, b.p, good, { 'content-length': '100' })).toContain('ggml-tiny.bin')

    const evil = Buffer.alloc(100, 2)
    const c = start(() => downloadModel('tiny'))
    const r3 = await feed(c.req, c.p, evil, { 'content-length': '100' })
    expect(r3).toBeInstanceOf(Error)
    expect((r3 as Error).message).toMatch(/differs|mismatch/i)
    expect(readFileSync(join(MODELS_DIR, 'ggml-tiny.bin'))).toEqual(good)
    expect(temps()).toEqual([])

    expect(deleteModel('tiny')).toBe(true)
    expect(getStoredHash('model:ggml-tiny.bin')).toBeNull()
  })

  it('model with pinned sha256 in catalog: mismatch -> file removed + error; match -> ok', async () => {
    const body = Buffer.alloc(64, 7)
    const tiny = getAvailableModels().find((m) => m.id === 'tiny')!
    tiny.sha256 = 'a'.repeat(64)
    try {
      const a = start(() => downloadModel('tiny'))
      const r = await feed(a.req, a.p, body, { 'content-length': '64' })
      expect((r as Error).message).toMatch(/SHA-256 mismatch/)
      expect(existsSync(join(MODELS_DIR, 'ggml-tiny.bin'))).toBe(false)
      expect(temps()).toEqual([])

      tiny.sha256 = sha(body)
      const b = start(() => downloadModel('tiny'))
      expect(await feed(b.req, b.p, body, { 'content-length': '64' })).toContain('ggml-tiny.bin')
    } finally {
      tiny.sha256 = null
    }
  })

  it('no Content-Length + tiny body -> fails for catalog model', async () => {
    const a = start(() => downloadModel('tiny'))
    const r = await feed(a.req, a.p, Buffer.alloc(1000, 1), {})
    expect((r as Error).message).toMatch(/no Content-Length/i)
    expect(existsSync(join(MODELS_DIR, 'ggml-tiny.bin'))).toBe(false)
    expect(temps()).toEqual([])
  })

  it('no Content-Length -> custom model download is refused', async () => {
    const a = start(() => downloadCustomModel('https://example.com/m.bin', 'm.bin'))
    const r = await feed(a.req, a.p, Buffer.alloc(1000, 1), {})
    expect((r as Error).message).toMatch(/no Content-Length/i)
    expect(existsSync(join(MODELS_DIR, 'm.bin'))).toBe(false)
  })

  describe('whisper-server installed binary', () => {
    const dir = (): string => join(testDir, 'whisper-server')
    beforeEach(() => mkdirSync(dir(), { recursive: true }))

    it('legacy install without record is recorded (TOFU), then unchanged binary passes', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      writeFileSync(join(dir(), 'whisper-server.exe'), 'MZ-original')
      verifyInstalledServer()
      expect(getStoredHash('whisper-server-installed:v1.8.4:whisper-server.exe')).toBe(sha(Buffer.from('MZ-original')))
      expect(() => verifyInstalledServer()).not.toThrow()
    })

    it('tampered binary after install -> refuse with clear error', async () => {
      writeFileSync(join(dir(), 'whisper-server.exe'), 'MZ-original')
      storeHash('whisper-server-installed:v1.8.4:whisper-server.exe', hashFile(join(dir(), 'whisper-server.exe')))
      writeFileSync(join(dir(), 'whisper-server.exe'), 'MZ-evil')
      expect(() => verifyInstalledServer()).toThrow(/integrity check failed.*whisper-server\.exe.*Refusing to start/s)
      expect(() => verifyInstalledServer()).toThrow(IntegrityError)
    })
  })
})
