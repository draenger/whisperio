import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

// Gap tests for modelManager.ts download paths: redirect header shapes, a
// redirected request that fails, Content-Length sent as an array,
// backpressure, the minimum plausible size without Content-Length, a short
// write detected on disk, and downloadFileSecure's guards.

const testDir = join(tmpdir(), `whisperio-mm-gaps-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const netRequest = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  net: { request: (...a: unknown[]) => netRequest(...a) }
}))

// Real fs, except statSync can be told to lie about one path (a short write
// that only shows up when the flushed file is measured).
const statLie = { path: '', size: 0 }
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  const statSync = ((p: string, ...rest: unknown[]) => {
    const s = (actual.statSync as (...a: unknown[]) => import('fs').Stats)(p, ...rest)
    return statLie.path && String(p) === statLie.path ? { ...s, size: statLie.size } : s
  }) as typeof actual.statSync
  return { ...actual, default: { ...actual, statSync }, statSync }
})

import {
  downloadModel,
  downloadFileSecure,
  cancelDownload,
  getAvailableModels,
  setDownloadProgressCallback,
  type DownloadProgress
} from '../src/main/modelManager'
import { unpinCatalogModelsForEachTest } from './helpers/unpinCatalogModel'

unpinCatalogModelsForEachTest()

const MODELS_DIR = join(testDir, 'models')
type Handler = (...a: any[]) => void

function fakeReq() {
  const h = new Map<string, Handler[]>()
  const req = {
    on: (e: string, cb: Handler) => { h.set(e, [...(h.get(e) ?? []), cb]); return req },
    end: vi.fn(), abort: vi.fn(), followRedirect: vi.fn(),
    emit: (e: string, ...a: any[]) => { for (const cb of h.get(e) ?? []) cb(...a) }
  }
  return req
}
function fakeRes(statusCode: number, headers: Record<string, string | string[]> = {}) {
  const h = new Map<string, Handler[]>()
  return {
    statusCode, headers, pause: vi.fn(), resume: vi.fn(),
    on: (e: string, cb: Handler) => { h.set(e, [...(h.get(e) ?? []), cb]) },
    emit: (e: string, ...a: any[]) => { for (const cb of h.get(e) ?? []) cb(...a) }
  }
}
const settle = <T,>(p: Promise<T>): Promise<T | Error> => p.then((v) => v, (e: Error) => e)
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(MODELS_DIR, { recursive: true })
  netRequest.mockReset()
  statLie.path = ''
  setDownloadProgressCallback(() => {})
})
afterEach(async () => {
  // activeDownloads is module state: settle anything a test left running.
  for (const id of ['tiny', 'p1', 'p2', 'p3', 'p4']) cancelDownload(id)
  await tick()
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
})

describe('downloadModel redirects', () => {
  it('follows the first entry of a Location header sent as an array', async () => {
    const [r1, r2] = [fakeReq(), fakeReq()]
    netRequest.mockReturnValueOnce(r1).mockReturnValueOnce(r2)
    const p = downloadModel('tiny')
    r1.emit('response', fakeRes(301, { location: ['https://cdn.example/a.bin', 'https://cdn.example/b.bin'] }))
    expect(netRequest.mock.calls[1][0]).toMatchObject({ url: 'https://cdn.example/a.bin' })
    const res = fakeRes(200, { 'content-length': '3' })
    r2.emit('response', res)
    res.emit('data', Buffer.from('abc'))
    res.emit('end')
    expect(await p).toBe(join(MODELS_DIR, 'ggml-tiny.bin'))
  })

  it('a redirect without a Location is a failure, not a second request', async () => {
    const r1 = fakeReq()
    netRequest.mockReturnValueOnce(r1)
    const p = settle(downloadModel('tiny'))
    r1.emit('response', fakeRes(302, {}))
    expect(((await p) as Error).message).toBe('Download failed: HTTP 302')
    expect(netRequest).toHaveBeenCalledTimes(1)
  })

  it('a redirect target that fails rejects and frees the slot for a retry', async () => {
    const [r1, r2] = [fakeReq(), fakeReq()]
    netRequest.mockReturnValueOnce(r1).mockReturnValueOnce(r2)
    const p = settle(downloadModel('tiny'))
    r1.emit('response', fakeRes(302, { location: 'https://cdn.example/x.bin' }))
    r2.emit('response', fakeRes(404))
    expect(((await p) as Error).message).toBe('Download failed: HTTP 404')
    expect(existsSync(join(MODELS_DIR, 'ggml-tiny.bin'))).toBe(false)

    netRequest.mockReturnValueOnce(fakeReq())
    const retry = settle(downloadModel('tiny'))
    await tick()
    expect(netRequest).toHaveBeenCalledTimes(3)
    void retry
  })
})

describe('handleDownloadResponse', () => {
  it('reads a Content-Length sent as an array for progress and the size check', async () => {
    const seen: DownloadProgress[] = []
    setDownloadProgressCallback((pr) => seen.push(pr))
    const req = fakeReq()
    netRequest.mockReturnValueOnce(req)
    const p = settle(downloadModel('tiny'))
    const res = fakeRes(200, { 'content-length': ['4', '999'] })
    req.emit('response', res)
    res.emit('data', Buffer.from('ab'))
    res.emit('end')

    const err = (await p) as Error
    expect(err.message).toMatch(/got 2 of 4 bytes/)
    expect(seen[0]).toMatchObject({ percent: 50, downloadedBytes: 2, totalBytes: 4 })
  })

  it('pauses the network stream when the disk buffer is full and resumes on drain', async () => {
    const req = fakeReq()
    netRequest.mockReturnValueOnce(req)
    const big = Buffer.alloc(256 * 1024, 7)
    const p = downloadModel('tiny')
    const res = fakeRes(200, { 'content-length': String(big.length) })
    req.emit('response', res)
    res.emit('data', big)
    expect(res.pause).toHaveBeenCalledTimes(1)
    await tick(100)
    expect(res.resume).toHaveBeenCalledTimes(1)
    res.emit('end')
    const out = await p
    expect(readFileSync(out).equals(big)).toBe(true)
  })

  describe('without Content-Length (catalog model)', () => {
    let saved = 0
    beforeEach(() => {
      const tiny = getAvailableModels().find((m) => m.id === 'tiny')!
      saved = tiny.sizeBytes
      tiny.sizeBytes = 100 // minimum plausible size = 50 bytes
    })
    afterEach(() => {
      getAvailableModels().find((m) => m.id === 'tiny')!.sizeBytes = saved
    })

    it.each([[50, true], [49, false]])('%i bytes accepted: %s', async (n, ok) => {
      const req = fakeReq()
      netRequest.mockReturnValueOnce(req)
      const p = settle(downloadModel('tiny'))
      const res = fakeRes(200)
      req.emit('response', res)
      res.emit('data', Buffer.alloc(n, 1))
      res.emit('end')
      const out = await p
      const final = join(MODELS_DIR, 'ggml-tiny.bin')
      if (ok) {
        expect(out).toBe(final)
        expect(existsSync(final)).toBe(true)
      } else {
        expect((out as Error).message).toMatch(/no Content-Length and only 49 bytes \(expected at least 50\)/)
        expect(existsSync(final)).toBe(false)
      }
    })
  })

  it('a short write seen on disk after flush is rejected and never promoted', async () => {
    const final = join(MODELS_DIR, 'ggml-tiny.bin')
    writeFileSync(final, 'old good model')
    statLie.path = final + '.downloading'
    statLie.size = 2
    const req = fakeReq()
    netRequest.mockReturnValueOnce(req)
    const p = settle(downloadModel('tiny'))
    const res = fakeRes(200, { 'content-length': '6' })
    req.emit('response', res)
    res.emit('data', Buffer.from('abcdef'))
    res.emit('end')

    expect(((await p) as Error).message).toBe('Download verification failed for tiny: wrote 2 of 6 bytes.')
    expect(readFileSync(final, 'utf8')).toBe('old good model')
    expect(existsSync(final + '.downloading')).toBe(false)
  })
})

describe('downloadFileSecure guards', () => {
  const dest = (): string => join(MODELS_DIR, 'part.onnx')

  it('refuses plain http from a public host before any request', async () => {
    const err = (await settle(downloadFileSecure('p1', 'http://example.com/a.onnx', dest()))) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/Refusing insecure http/)
    expect(netRequest).not.toHaveBeenCalled()
  })

  it('a second download with the same id is refused while the first runs', async () => {
    netRequest.mockReturnValueOnce(fakeReq())
    void settle(downloadFileSecure('p2', 'https://h.example/a.onnx', dest()))
    const err = (await settle(downloadFileSecure('p2', 'https://h.example/a.onnx', dest()))) as Error
    expect(err.message).toBe('Already downloading: p2')
    expect(netRequest).toHaveBeenCalledTimes(1)
  })

  it('a non-200 response rejects and frees the id', async () => {
    const req = fakeReq()
    netRequest.mockReturnValueOnce(req)
    const p = settle(downloadFileSecure('p3', 'https://h.example/a.onnx', dest()))
    req.emit('response', fakeRes(500))
    expect(((await p) as Error).message).toBe('Download failed: HTTP 500')

    netRequest.mockReturnValueOnce(fakeReq())
    void settle(downloadFileSecure('p3', 'https://h.example/a.onnx', dest()))
    expect(netRequest).toHaveBeenCalledTimes(2)
  })

  it('a redirect to plain http on a public host aborts, cleans up and frees the id', async () => {
    const req = fakeReq()
    netRequest.mockReturnValueOnce(req)
    writeFileSync(dest() + '.downloading', 'stale')
    const p = settle(downloadFileSecure('p4', 'https://h.example/a.onnx', dest()))
    req.emit('redirect', 302, 'GET', 'http://evil.example/a.onnx')

    const err = (await p) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/Refusing insecure http/)
    expect(req.abort).toHaveBeenCalled()
    expect(req.followRedirect).not.toHaveBeenCalled()
    expect(existsSync(dest() + '.downloading')).toBe(false)

    netRequest.mockReturnValueOnce(fakeReq())
    void settle(downloadFileSecure('p4', 'https://h.example/a.onnx', dest()))
    expect(netRequest).toHaveBeenCalledTimes(2)
  })
})
