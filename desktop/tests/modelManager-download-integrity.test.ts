import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Model-download artifact integrity and cancellation.
 *
 * Three defects are pinned here:
 *
 *  1. A truncated body still ends the response cleanly, so a partial model was
 *     renamed over the real file and REPORTED AS A SUCCESSFUL DOWNLOAD — the
 *     user ends up with a corrupt .bin and no indication the download failed.
 *  2. cancelDownload() aborted the socket and tried to unlink the temp file,
 *     but never destroyed the open write stream — so the unlink failed on
 *     Windows and the `.downloading` file leaked.
 *  3. cancelDownload() never settled the download promise, leaving the awaiting
 *     IPC call pending for the rest of the app's lifetime.
 *
 * Harness mirrors tests/modelManager.test.ts.
 */

const testDir = join(tmpdir(), `whisperio-dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const netRequest = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  net: { request: (...args: unknown[]) => netRequest(...args) }
}))

import {
  downloadModel,
  cancelDownload,
  setDownloadProgressCallback,
  DownloadCancelledError
} from '../src/main/modelManager'

const MODELS_DIR = join(testDir, 'models')
const TINY_BIN = join(MODELS_DIR, 'ggml-tiny.bin')

type Handler = (...args: any[]) => void

function makeFakeRequest() {
  const handlers = new Map<string, Handler[]>()
  const req = {
    on: (event: string, cb: Handler) => {
      const arr = handlers.get(event) ?? []
      arr.push(cb)
      handlers.set(event, arr)
      return req
    },
    end: vi.fn(),
    abort: vi.fn(),
    write: vi.fn(),
    setHeader: vi.fn(),
    emit: (event: string, ...args: any[]) => {
      for (const cb of handlers.get(event) ?? []) cb(...args)
    }
  }
  return req
}

function makeFakeResponse(statusCode: number, headers: Record<string, string | string[]> = {}) {
  const handlers = new Map<string, Handler[]>()
  const res = {
    statusCode,
    headers,
    on: (event: string, cb: Handler) => {
      const arr = handlers.get(event) ?? []
      arr.push(cb)
      handlers.set(event, arr)
    },
    // The write stream is a real fs stream; give it a tick to flush.
    emit: (event: string, ...args: any[]) => {
      for (const cb of handlers.get(event) ?? []) cb(...args)
    }
  }
  return res
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

function tempArtifacts(): string[] {
  if (!existsSync(MODELS_DIR)) return []
  return readdirSync(MODELS_DIR).filter((f) => f.endsWith('.downloading'))
}

describe('modelManager — download artifact integrity', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    netRequest.mockReset()
    setDownloadProgressCallback(() => {})
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    vi.restoreAllMocks()
  })

  it('rejects a truncated download instead of reporting success', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')
    const assertion = expect(promise).rejects.toThrow(/incomplete/i)

    // Server promised 1000 bytes but the connection dropped after 300.
    const res = makeFakeResponse(200, { 'content-length': '1000' })
    req.emit('response', res)
    res.emit('data', Buffer.alloc(300, 1))
    await tick()
    res.emit('end')

    await assertion
    await tick()

    // The partial file must NOT have been promoted to the real model path...
    expect(existsSync(TINY_BIN)).toBe(false)
    // ...nor left behind as a temp artifact.
    expect(tempArtifacts()).toEqual([])
  })

  it('does not overwrite an existing good model with a truncated download', async () => {
    mkdirSync(MODELS_DIR, { recursive: true })
    writeFileSync(TINY_BIN, Buffer.from('previously-downloaded-good-model'))

    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')
    const assertion = expect(promise).rejects.toThrow(/incomplete/i)

    const res = makeFakeResponse(200, { 'content-length': '5000' })
    req.emit('response', res)
    res.emit('data', Buffer.alloc(10, 1))
    await tick()
    res.emit('end')

    await assertion
    await tick()

    expect(readFileSync(TINY_BIN, 'utf-8')).toBe('previously-downloaded-good-model')
  })

  it('rejects a zero-byte download', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')
    const assertion = expect(promise).rejects.toThrow(/empty file/i)

    const res = makeFakeResponse(200, {})
    req.emit('response', res)
    await tick()
    res.emit('end')

    await assertion
    await tick()
    expect(existsSync(TINY_BIN)).toBe(false)
    expect(tempArtifacts()).toEqual([])
  })

  it('accepts a complete download whose byte count matches content-length', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')

    const res = makeFakeResponse(200, { 'content-length': '512' })
    req.emit('response', res)
    res.emit('data', Buffer.alloc(512, 7))
    await tick()
    res.emit('end')

    await expect(promise).resolves.toBe(TINY_BIN)
    expect(readFileSync(TINY_BIN).length).toBe(512)
    expect(tempArtifacts()).toEqual([])
  })

  it('accepts a download when the server sends no content-length', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')

    const res = makeFakeResponse(200, {})
    req.emit('response', res)
    res.emit('data', Buffer.alloc(64, 3))
    await tick()
    res.emit('end')

    await expect(promise).resolves.toBe(TINY_BIN)
    expect(readFileSync(TINY_BIN).length).toBe(64)
  })
})

describe('modelManager — download cancellation', () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    netRequest.mockReset()
    setDownloadProgressCallback(() => {})
  })

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    vi.restoreAllMocks()
  })

  it('settles the download promise when cancelled mid-body', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')
    const assertion = expect(promise).rejects.toBeInstanceOf(DownloadCancelledError)

    const res = makeFakeResponse(200, { 'content-length': '100000' })
    req.emit('response', res)
    res.emit('data', Buffer.alloc(4096, 1))
    await tick()

    expect(cancelDownload('tiny')).toBe(true)

    // Before the fix this promise never settled — the renderer's `await`
    // hung forever and the UI kept showing a phantom download.
    await assertion
  })

  it('aborts the underlying request and removes the partial file on cancel', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')
    promise.catch(() => {})

    const res = makeFakeResponse(200, { 'content-length': '100000' })
    req.emit('response', res)
    res.emit('data', Buffer.alloc(4096, 1))
    await tick()

    cancelDownload('tiny')
    await tick()

    expect(req.abort).toHaveBeenCalled()
    // The write stream is destroyed before the unlink, so the temp file is
    // actually removable (on Windows an open handle made this unlink fail).
    expect(tempArtifacts()).toEqual([])
    expect(existsSync(TINY_BIN)).toBe(false)
  })

  it('settles the promise when cancelled before the response arrives', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')
    const assertion = expect(promise).rejects.toBeInstanceOf(DownloadCancelledError)

    expect(cancelDownload('tiny')).toBe(true)

    await assertion
  })

  it('does not promote a partial file to the real model path after cancellation', async () => {
    const req = makeFakeRequest()
    netRequest.mockReturnValue(req)

    const promise = downloadModel('tiny')
    promise.catch(() => {})

    const res = makeFakeResponse(200, { 'content-length': '100000' })
    req.emit('response', res)
    res.emit('data', Buffer.alloc(2048, 9))
    await tick()

    cancelDownload('tiny')
    await tick()

    // A late 'end' from the aborted socket must not resurrect the download.
    res.emit('end')
    await tick()

    expect(existsSync(TINY_BIN)).toBe(false)
    expect(tempArtifacts()).toEqual([])
  })

  it('frees the download slot so the model can be retried after a cancel', async () => {
    const req1 = makeFakeRequest()
    netRequest.mockReturnValueOnce(req1)

    const first = downloadModel('tiny')
    first.catch(() => {})
    cancelDownload('tiny')
    await tick()

    // A retry must not be rejected with "Already downloading".
    const req2 = makeFakeRequest()
    netRequest.mockReturnValueOnce(req2)
    const second = downloadModel('tiny')

    const res = makeFakeResponse(200, { 'content-length': '32' })
    req2.emit('response', res)
    res.emit('data', Buffer.alloc(32, 5))
    await tick()
    res.emit('end')

    await expect(second).resolves.toBe(TINY_BIN)
  })

  it('reports false when cancelling a download that is not running', () => {
    expect(cancelDownload('tiny')).toBe(false)
  })
})
