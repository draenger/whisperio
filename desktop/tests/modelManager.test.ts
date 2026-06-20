import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

// net.request is a vi.fn() we drive per-test.
const netRequest = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir)
  },
  net: {
    request: (...args: unknown[]) => netRequest(...args)
  }
}))

import {
  getAvailableModels,
  getLocalModels,
  getModelPath,
  deleteModel,
  getCustomModels,
  downloadModel,
  downloadCustomModel,
  cancelDownload,
  setDownloadProgressCallback,
  type DownloadProgress
} from '../src/main/modelManager'

const MODELS_DIR = join(testDir, 'models')

// ---- Fake net.request / response helpers -----------------------------------

type Handler = (...args: any[]) => void

interface FakeRequest {
  on: (event: string, cb: Handler) => FakeRequest
  end: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: any[]) => void
}

interface FakeResponse {
  statusCode: number
  headers: Record<string, string | string[]>
  on: (event: string, cb: Handler) => void
  emit: (event: string, ...args: any[]) => void
}

function makeFakeRequest(): FakeRequest {
  const handlers = new Map<string, Handler[]>()
  const req: FakeRequest = {
    on: (event, cb) => {
      const arr = handlers.get(event) ?? []
      arr.push(cb)
      handlers.set(event, arr)
      return req
    },
    end: vi.fn(),
    abort: vi.fn(),
    write: vi.fn(),
    setHeader: vi.fn(),
    emit: (event, ...args) => {
      for (const cb of handlers.get(event) ?? []) cb(...args)
    }
  }
  return req
}

function makeFakeResponse(
  statusCode: number,
  headers: Record<string, string | string[]> = {}
): FakeResponse {
  const handlers = new Map<string, Handler[]>()
  const res: FakeResponse = {
    statusCode,
    headers,
    on: (event, cb) => {
      const arr = handlers.get(event) ?? []
      arr.push(cb)
      handlers.set(event, arr)
    },
    emit: (event, ...args) => {
      for (const cb of handlers.get(event) ?? []) cb(...args)
    }
  }
  return res
}

describe('modelManager', () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    mkdirSync(testDir, { recursive: true })
    netRequest.mockReset()
    setDownloadProgressCallback(() => {})
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    vi.restoreAllMocks()
  })

  describe('getAvailableModels', () => {
    it('returns the 6 known models with correct shape', () => {
      const models = getAvailableModels()
      expect(models).toHaveLength(6)
      expect(models.map((m) => m.id)).toEqual([
        'tiny',
        'base',
        'small',
        'medium',
        'large-v3-turbo',
        'large-v3'
      ])
      for (const m of models) {
        expect(typeof m.name).toBe('string')
        expect(typeof m.size).toBe('string')
        expect(typeof m.sizeBytes).toBe('number')
        expect(typeof m.description).toBe('string')
        expect(m.filename).toMatch(/^ggml-.*\.bin$/)
        expect(m.url).toContain('https://')
      }
    })
  })

  describe('getLocalModels', () => {
    it('reports all models as not downloaded when none exist', () => {
      const local = getLocalModels()
      expect(local).toHaveLength(6)
      expect(local.every((m) => m.downloaded === false)).toBe(true)
      expect(local.every((m) => m.size === 0)).toBe(true)
    })

    it('reports a model as downloaded with correct size after its .bin file is written', () => {
      mkdirSync(MODELS_DIR, { recursive: true })
      const content = Buffer.from('a'.repeat(1234))
      writeFileSync(join(MODELS_DIR, 'ggml-tiny.bin'), content)

      const tiny = getLocalModels().find((m) => m.id === 'tiny')!
      expect(tiny.downloaded).toBe(true)
      expect(tiny.size).toBe(1234)
      expect(tiny.filepath).toBe(join(MODELS_DIR, 'ggml-tiny.bin'))
    })

    it('reports a zero-byte file as not downloaded', () => {
      mkdirSync(MODELS_DIR, { recursive: true })
      writeFileSync(join(MODELS_DIR, 'ggml-base.bin'), Buffer.alloc(0))

      const base = getLocalModels().find((m) => m.id === 'base')!
      expect(base.size).toBe(0)
      expect(base.downloaded).toBe(false)
    })
  })

  describe('getModelPath', () => {
    it('returns null for an unknown id', () => {
      expect(getModelPath('does-not-exist')).toBeNull()
    })

    it('returns null when the file is absent', () => {
      expect(getModelPath('tiny')).toBeNull()
    })

    it('returns the path when the file is present', () => {
      mkdirSync(MODELS_DIR, { recursive: true })
      writeFileSync(join(MODELS_DIR, 'ggml-tiny.bin'), Buffer.from('x'))
      expect(getModelPath('tiny')).toBe(join(MODELS_DIR, 'ggml-tiny.bin'))
    })
  })

  describe('deleteModel', () => {
    it("deletes a known model's file and returns true", () => {
      mkdirSync(MODELS_DIR, { recursive: true })
      const filepath = join(MODELS_DIR, 'ggml-tiny.bin')
      writeFileSync(filepath, Buffer.from('x'))

      expect(deleteModel('tiny')).toBe(true)
      expect(existsSync(filepath)).toBe(false)
    })

    it('returns false when a known model file is absent', () => {
      expect(deleteModel('tiny')).toBe(false)
    })

    it('returns false for an unknown id with no matching file', () => {
      expect(deleteModel('nope.bin')).toBe(false)
    })

    it('deletes via the custom-filename branch when a raw filename exists', () => {
      mkdirSync(MODELS_DIR, { recursive: true })
      const filepath = join(MODELS_DIR, 'my-custom.bin')
      writeFileSync(filepath, Buffer.from('x'))

      expect(deleteModel('my-custom.bin')).toBe(true)
      expect(existsSync(filepath)).toBe(false)
    })
  })

  describe('getCustomModels', () => {
    it('returns [] when the models dir is missing', () => {
      // getModelsDir creates it lazily, but with no files it stays empty.
      expect(getCustomModels()).toEqual([])
    })

    it('lists only non-known .bin files, excluding known + .downloading files', () => {
      mkdirSync(MODELS_DIR, { recursive: true })
      writeFileSync(join(MODELS_DIR, 'ggml-tiny.bin'), Buffer.from('known'))
      writeFileSync(join(MODELS_DIR, 'custom-a.bin'), Buffer.from('aaaa'))
      writeFileSync(join(MODELS_DIR, 'custom-b.bin'), Buffer.from('bb'))
      writeFileSync(join(MODELS_DIR, 'ggml-base.bin.downloading'), Buffer.from('temp'))
      writeFileSync(join(MODELS_DIR, 'notes.txt'), Buffer.from('ignore'))

      const custom = getCustomModels()
      expect(custom.map((m) => m.id).sort()).toEqual(['custom:custom-a.bin', 'custom:custom-b.bin'])

      const a = custom.find((m) => m.id === 'custom:custom-a.bin')!
      expect(a.name).toBe('custom-a')
      expect(a.filename).toBe('custom-a.bin')
      expect(a.size).toBe(4)
      expect(a.downloaded).toBe(true)
    })
  })

  describe('downloadModel', () => {
    it('rejects for an unknown id', async () => {
      await expect(downloadModel('bogus')).rejects.toThrow('Unknown model: bogus')
    })

    it('rejects "Already downloading" when called twice', async () => {
      // First call: never-ending request (no response emitted).
      const req1 = makeFakeRequest()
      netRequest.mockReturnValueOnce(req1)
      const first = downloadModel('tiny')

      await expect(downloadModel('tiny')).rejects.toThrow('Already downloading: tiny')

      // Clean up the dangling download so it doesn't leak into other tests.
      cancelDownload('tiny')
      await expect(Promise.race([first, Promise.resolve('pending')])).resolves.toBe('pending')
    })

    it('resolves to the final path on the success path and renames the temp file', async () => {
      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)

      const promise = downloadModel('tiny')

      const res = makeFakeResponse(200, { 'content-length': '6' })
      req.emit('response', res)
      res.emit('data', Buffer.from('abc'))
      res.emit('data', Buffer.from('def'))
      res.emit('end')

      const finalPath = await promise
      expect(finalPath).toBe(join(MODELS_DIR, 'ggml-tiny.bin'))
      expect(existsSync(finalPath)).toBe(true)
      expect(existsSync(finalPath + '.downloading')).toBe(false)
    })

    it('rejects "Download failed: HTTP" when statusCode is not 200', async () => {
      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)

      const promise = downloadModel('tiny')
      req.emit('response', makeFakeResponse(404))

      await expect(promise).rejects.toThrow('Download failed: HTTP 404')
    })

    it('follows a 302 redirect and resolves to the final path', async () => {
      const req1 = makeFakeRequest()
      const req2 = makeFakeRequest()
      netRequest.mockReturnValueOnce(req1).mockReturnValueOnce(req2)

      const promise = downloadModel('base')

      // First response: redirect.
      req1.emit('response', makeFakeResponse(302, { location: 'https://cdn.example/ggml-base.bin' }))

      // Second request driven to completion.
      const res2 = makeFakeResponse(200, { 'content-length': '4' })
      req2.emit('response', res2)
      res2.emit('data', Buffer.from('data'))
      res2.emit('end')

      const finalPath = await promise
      expect(finalPath).toBe(join(MODELS_DIR, 'ggml-base.bin'))
      expect(existsSync(finalPath)).toBe(true)
      expect(netRequest).toHaveBeenCalledTimes(2)
      expect(netRequest.mock.calls[1][0]).toMatchObject({ url: 'https://cdn.example/ggml-base.bin' })
    })

    it('rejects on request error', async () => {
      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)

      const promise = downloadModel('tiny')
      req.emit('error', new Error('boom'))

      await expect(promise).rejects.toThrow('boom')
    })
  })

  describe('downloadCustomModel', () => {
    it('resolves to the final path on the success path and renames the temp file', async () => {
      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)

      const promise = downloadCustomModel('https://example.com/my-model.bin', 'my-model.bin')

      const res = makeFakeResponse(200, { 'content-length': '6' })
      req.emit('response', res)
      res.emit('data', Buffer.from('abc'))
      res.emit('data', Buffer.from('def'))
      res.emit('end')

      const finalPath = await promise
      expect(finalPath).toBe(join(MODELS_DIR, 'my-model.bin'))
      expect(existsSync(finalPath)).toBe(true)
      expect(existsSync(finalPath + '.downloading')).toBe(false)
      expect(netRequest.mock.calls[0][0]).toMatchObject({
        url: 'https://example.com/my-model.bin'
      })
    })

    it('rejects "Already downloading" when called twice for the same filename', async () => {
      const req1 = makeFakeRequest()
      netRequest.mockReturnValueOnce(req1)
      const first = downloadCustomModel('https://example.com/dup.bin', 'dup.bin')

      await expect(
        downloadCustomModel('https://example.com/dup.bin', 'dup.bin')
      ).rejects.toThrow('Already downloading: dup.bin')

      // Clean up the dangling download so it doesn't leak into other tests.
      cancelDownload('custom:dup.bin')
      await expect(Promise.race([first, Promise.resolve('pending')])).resolves.toBe('pending')
    })

    it('rejects "Download failed: HTTP" when statusCode is not 200', async () => {
      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)

      const promise = downloadCustomModel('https://example.com/missing.bin', 'missing.bin')
      req.emit('response', makeFakeResponse(403))

      await expect(promise).rejects.toThrow('Download failed: HTTP 403')
    })

    it('follows a 302 redirect and resolves to the final path', async () => {
      const req1 = makeFakeRequest()
      const req2 = makeFakeRequest()
      netRequest.mockReturnValueOnce(req1).mockReturnValueOnce(req2)

      const promise = downloadCustomModel('https://example.com/redir.bin', 'redir.bin')

      // First response: redirect.
      req1.emit('response', makeFakeResponse(301, { location: 'https://cdn.example/redir.bin' }))

      // Second request driven to completion.
      const res2 = makeFakeResponse(200, { 'content-length': '4' })
      req2.emit('response', res2)
      res2.emit('data', Buffer.from('data'))
      res2.emit('end')

      const finalPath = await promise
      expect(finalPath).toBe(join(MODELS_DIR, 'redir.bin'))
      expect(existsSync(finalPath)).toBe(true)
      expect(netRequest).toHaveBeenCalledTimes(2)
      expect(netRequest.mock.calls[1][0]).toMatchObject({ url: 'https://cdn.example/redir.bin' })
    })
  })

  describe('handleDownloadResponse error handling', () => {
    it('rejects and cleans up the temp file when the response emits an error mid-stream', async () => {
      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)

      const promise = downloadModel('tiny')

      const res = makeFakeResponse(200, { 'content-length': '100' })
      req.emit('response', res)
      res.emit('data', Buffer.from('partial'))
      res.emit('error', new Error('stream blew up'))

      await expect(promise).rejects.toThrow('stream blew up')

      const finalPath = join(MODELS_DIR, 'ggml-tiny.bin')
      expect(existsSync(finalPath)).toBe(false)
      expect(existsSync(finalPath + '.downloading')).toBe(false)
    })
  })

  describe('cancelDownload', () => {
    it('returns false when nothing is active', () => {
      expect(cancelDownload('tiny')).toBe(false)
    })

    it('returns true after starting a (never-ending) download', async () => {
      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)
      const pending = downloadModel('tiny')

      expect(cancelDownload('tiny')).toBe(true)
      expect(req.abort).toHaveBeenCalled()

      // The pending promise never resolves/rejects (aborted, no response). Ensure no leak.
      await expect(Promise.race([pending, Promise.resolve('pending')])).resolves.toBe('pending')
    })
  })

  describe('setDownloadProgressCallback', () => {
    it('fires the progress callback during a mocked download', async () => {
      const events: DownloadProgress[] = []
      setDownloadProgressCallback((p) => events.push(p))

      // Force Date.now to advance past the 200ms throttle on each data chunk.
      let t = 0
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        t += 1000
        return t
      })

      const req = makeFakeRequest()
      netRequest.mockReturnValueOnce(req)

      const promise = downloadModel('tiny')
      const res = makeFakeResponse(200, { 'content-length': '10' })
      req.emit('response', res)
      res.emit('data', Buffer.from('12345'))
      res.emit('data', Buffer.from('67890'))
      res.emit('end')

      await promise
      nowSpy.mockRestore()

      // At least one mid-download progress event plus the final 100%.
      expect(events.length).toBeGreaterThanOrEqual(2)
      const mid = events.find((e) => e.percent === 50)
      expect(mid).toBeDefined()
      expect(mid!.downloadedBytes).toBe(5)
      expect(mid!.totalBytes).toBe(10)
      expect(mid!.modelId).toBe('tiny')

      const final = events[events.length - 1]
      expect(final.percent).toBe(100)
      expect(final.downloadedBytes).toBe(10)
    })
  })
})
