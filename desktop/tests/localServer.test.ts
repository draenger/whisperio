import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'

const testDir = join(tmpdir(), `whisperio-server-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

// The exact line whisper.cpp's server prints once its HTTP listener is bound —
// the ONLY output localServer treats as "ready" (see READY_LINE_RE).
const READY_LINE = 'whisper server listening at http://127.0.0.1:8178\n'

// --- Electron mock ---
const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir)
  },
  net: {
    request: (...args: unknown[]) => mockNetRequest(...args)
  }
}))

// --- fs mock ---
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockUnlinkSync = vi.fn()
const mockCreateWriteStream = vi.fn()
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args)
}))

// --- child_process mock ---
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args)
}))

// --- Fake ChildProcess helper ---
interface FakeChildProcess {
  stdout: EventEmitter
  stderr: EventEmitter
  on: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  killed: boolean
  emit: (event: string, ...args: unknown[]) => boolean
}

function makeFakeProc(): FakeChildProcess {
  const emitter = new EventEmitter()
  const proc = emitter as unknown as FakeChildProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.killed = false
  proc.kill = vi.fn(() => {
    proc.killed = true
    return true
  })
  // wrap .on so it still chains through the EventEmitter
  const origOn = emitter.on.bind(emitter)
  proc.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    origOn(event, listener)
    return proc
  })
  return proc
}

type LocalServerModule = typeof import('../src/main/localServer')

async function freshModule(): Promise<LocalServerModule> {
  vi.resetModules()
  return import('../src/main/localServer')
}

// --- platform override helper ---
const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('localServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
  })

  afterEach(() => {
    // restore platform after every test
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
  })

  describe('getServerStatus', () => {
    it('returns stopped/null/port 8178 initially', async () => {
      const mod = await freshModule()
      const status = mod.getServerStatus()
      expect(status.status).toBe('stopped')
      expect(status.model).toBeNull()
      expect(status.port).toBe(8178)
      expect(status.platform).toBe(process.platform)
    })

    it('reflects the current process.platform', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      expect(mod.getServerStatus().platform).toBe('win32')
    })
  })

  describe('isServerBinaryAvailable', () => {
    it('returns false on non-win32 regardless of fs', async () => {
      setPlatform('darwin')
      mockExistsSync.mockReturnValue(true)
      const mod = await freshModule()
      expect(mod.isServerBinaryAvailable()).toBe(false)
    })

    it('returns true on win32 when the exe exists', async () => {
      setPlatform('win32')
      mockExistsSync.mockReturnValue(true)
      const mod = await freshModule()
      expect(mod.isServerBinaryAvailable()).toBe(true)
    })

    it('returns false on win32 when the exe is missing', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      // exe absent: getServerDir() existsSync(dir)=true (skip mkdir), exe existsSync=false
      mockExistsSync.mockImplementation((p: string) =>
        !String(p).endsWith('whisper-server.exe')
      )
      expect(mod.isServerBinaryAvailable()).toBe(false)
    })

    it('creates the server dir when it does not exist (getServerDir branch)', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      // dir missing -> mkdir called; exe present -> available
      mockExistsSync.mockImplementation((p: string) => String(p).endsWith('whisper-server.exe'))
      expect(mod.isServerBinaryAvailable()).toBe(true)
      expect(mockMkdirSync).toHaveBeenCalledWith(
        join(testDir, 'whisper-server'),
        { recursive: true }
      )
    })
  })

  describe('downloadServerBinary', () => {
    it('throws on non-win32', async () => {
      setPlatform('darwin')
      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).rejects.toThrow(/only available on Windows/)
    })
  })

  describe('startServer', () => {
    it('throws on non-win32', async () => {
      setPlatform('darwin')
      const mod = await freshModule()
      await expect(mod.startServer('model.bin')).rejects.toThrow(/only available on Windows/)
    })

    it('throws "already running" when status is running', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      // exe present, model present, drive a successful start first
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      proc.stdout.emit('data', READY_LINE)
      await startP
      expect(mod.getServerStatus().status).toBe('running')

      // second call should reject as already running
      await expect(mod.startServer('model.bin')).rejects.toThrow(/already running/)

      mod.stopServer()
    })

    it('throws "Model not found" when the model file is missing', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      // exe present, model absent
      mockExistsSync.mockImplementation((p: string) => {
        const s = String(p)
        if (s.endsWith('model.bin')) return false
        return true
      })
      await expect(mod.startServer('model.bin')).rejects.toThrow(/Model not found: model.bin/)
    })

    it('resolves to running on the whisper-server ready line and fires the status callback', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)

      const updates: string[] = []
      mod.setServerStatusCallback((s) => updates.push(s.status))

      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      // before resolution the status should be 'starting'
      expect(mod.getServerStatus().status).toBe('starting')

      proc.stdout.emit('data', READY_LINE)
      await startP

      const status = mod.getServerStatus()
      expect(status.status).toBe('running')
      expect(status.model).toBe('model.bin')

      // callback observed the transition through starting -> running
      expect(updates).toContain('starting')
      expect(updates).toContain('running')

      // execFile invoked with model path + port args
      const [exe, args] = mockExecFile.mock.calls[0]
      expect(String(exe)).toMatch(/whisper-server\.exe$/)
      expect(args).toContain('--port')
      expect(args).toContain('8178')

      mod.stopServer()
    })

    it('only resolves once even if multiple trigger lines arrive', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      proc.stderr.emit('data', READY_LINE)
      proc.stdout.emit('data', READY_LINE) // ignored, already started
      await startP
      expect(mod.getServerStatus().status).toBe('running')
      mod.stopServer()
    })

    it('ignores incidental "running"/"ready" chatter and only starts on the real ready line', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      let resolved = false
      const startP = mod.startServer('model.bin').then(() => { resolved = true })

      // Real whisper.cpp startup chatter that the old loose substring check
      // ('running' / 'ready' / 'listening' anywhere) would have accepted.
      proc.stderr.emit('data', 'whisper_init_state: kv self size = 12.00 MB\n')
      proc.stdout.emit('data', 'ggml backend CPU is running\n')
      proc.stderr.emit('data', 'loading model from C:\models\ready-v3.bin\n')
      proc.stdout.emit('data', 'warming up: model loaded, not listening yet\n')
      await new Promise((r) => setImmediate(r))

      expect(resolved).toBe(false)
      expect(mod.getServerStatus().status).toBe('starting')

      // Now the genuine ready line.
      proc.stdout.emit('data', READY_LINE)
      await startP
      expect(resolved).toBe(true)
      expect(mod.getServerStatus().status).toBe('running')
      mod.stopServer()
    })

    it('matches the ready line even when it is split across stdout chunks', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      // A pipe read can cut the line anywhere — neither half matches alone.
      proc.stdout.emit('data', 'whisper server list')
      await new Promise((r) => setImmediate(r))
      expect(mod.getServerStatus().status).toBe('starting')

      proc.stdout.emit('data', 'ening at http://127.0.0.1:8178\n')
      await startP
      expect(mod.getServerStatus().status).toBe('running')
      mod.stopServer()
    })

    it('rejects when the process emits an error before start', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      proc.emit('error', new Error('spawn failed'))
      await expect(startP).rejects.toThrow(/spawn failed/)
      expect(mod.getServerStatus().status).toBe('error')
    })

    it('rejects when the process exits before start', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      proc.emit('exit', 1)
      await expect(startP).rejects.toThrow(/exited with code 1/)
      expect(mod.getServerStatus().status).toBe('error')
    })

    it('resolves via the 30s fallback timeout when no output arrives', async () => {
      vi.useFakeTimers()
      try {
        setPlatform('win32')
        const mod = await freshModule()
        mockExistsSync.mockReturnValue(true)
        const proc = makeFakeProc()
        mockExecFile.mockReturnValue(proc)

        const startP = mod.startServer('model.bin')
        // no stdout; advance past the 30s fallback
        await vi.advanceTimersByTimeAsync(30_000)
        await startP
        expect(mod.getServerStatus().status).toBe('running')
        mod.stopServer()
      } finally {
        vi.useRealTimers()
      }
    })

    it('marks status stopped when a running server later exits', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      proc.stdout.emit('data', READY_LINE)
      await startP
      expect(mod.getServerStatus().status).toBe('running')

      // process exits after running -> status goes back to stopped
      proc.emit('exit', 0)
      expect(mod.getServerStatus().status).toBe('stopped')
    })
  })

  describe('stopServer', () => {
    it('kills the process, clears status/model, and fires the callback', async () => {
      setPlatform('win32')
      const mod = await freshModule()
      mockExistsSync.mockReturnValue(true)
      const proc = makeFakeProc()
      mockExecFile.mockReturnValue(proc)

      const startP = mod.startServer('model.bin')
      proc.stdout.emit('data', READY_LINE)
      await startP

      const updates: Array<{ status: string; model: string | null }> = []
      mod.setServerStatusCallback((s) => updates.push({ status: s.status, model: s.model }))

      mod.stopServer()

      expect(proc.kill).toHaveBeenCalled()
      const status = mod.getServerStatus()
      expect(status.status).toBe('stopped')
      expect(status.model).toBeNull()
      expect(updates.at(-1)).toEqual({ status: 'stopped', model: null })
    })

    it('is a no-op for the process when nothing is running', async () => {
      const mod = await freshModule()
      const cb = vi.fn()
      mod.setServerStatusCallback(cb)
      mod.stopServer()
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped', model: null }))
    })
  })

  describe('downloadServerBinary (win32 happy path)', () => {
    // Fake net.request emitting a 200 response.
    function wireNet(responseFactory: () => EventEmitter & { statusCode: number; headers: Record<string, unknown> }): void {
      mockNetRequest.mockImplementation(() => {
        const req = new EventEmitter() as EventEmitter & { end: () => void }
        req.end = vi.fn(() => {
          // emit response on next tick
          setImmediate(() => {
            const res = responseFactory()
            req.emit('response', res)
          })
        })
        return req
      })
    }

    function makeResponse(statusCode: number, headers: Record<string, unknown> = {}): EventEmitter & { statusCode: number; headers: Record<string, unknown> } {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, unknown> }
      res.statusCode = statusCode
      res.headers = headers
      return res
    }

    beforeEach(() => {
      setPlatform('win32')
      mockExistsSync.mockReturnValue(true)
      // createWriteStream returns a fake stream (write returns true so the
      // backpressure pause/resume path is not exercised; on/once/destroy are
      // present because the implementation attaches an 'error' listener).
      mockCreateWriteStream.mockImplementation(() => ({
        write: vi.fn(() => true),
        end: vi.fn((cb?: () => void) => cb && cb()),
        on: vi.fn(),
        once: vi.fn(),
        destroy: vi.fn()
      }))
      // powershell extract execFile calls its callback with no error
      mockExecFile.mockImplementation((cmd: string, _args: unknown[], cb?: (err: Error | null) => void) => {
        if (cmd === 'powershell' && cb) {
          setImmediate(() => cb(null))
        }
        return makeFakeProc()
      })
    })

    it('downloads (200) + extracts and returns the exe path', async () => {
      const res = makeResponse(200)
      mockNetRequest.mockImplementation(() => {
        const req = new EventEmitter() as EventEmitter & { end: () => void }
        req.end = vi.fn(() => {
          setImmediate(() => {
            req.emit('response', res)
            res.emit('data', Buffer.from('zipbytes'))
            res.emit('end')
          })
        })
        return req
      })

      const mod = await freshModule()
      const path = await mod.downloadServerBinary()
      expect(path).toMatch(/whisper-server\.exe$/)
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it("delegates redirects to net.request({ redirect: 'follow' }) instead of chasing them by hand", async () => {
      // The GitHub release URL always redirects to a CDN host; Electron's net
      // stack follows that internally, so 'response' only ever fires for the
      // final hop. A 3xx reaching the handler means the chain genuinely failed
      // and must be reported, not re-requested by hand (which used to loop
      // through downloadFile a second time).
      wireNet(() => makeResponse(302, { location: 'https://redirected/file.zip' }))

      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).rejects.toThrow(/HTTP 302/)
      expect(mockNetRequest).toHaveBeenCalledTimes(1)
      const [opts] = mockNetRequest.mock.calls[0] as [{ url: string; redirect: string }]
      expect(opts.redirect).toBe('follow')
      expect(opts.url).toMatch(/whisper-bin-x64\.zip$/)
    })

    it('fails loudly when extraction succeeds but the exe never appears', async () => {
      // powershell's per-entry copy loop exits 0 even when it matched nothing
      // (e.g. the release archive got a new layout) — the missing exe has to
      // surface here, not later as an opaque spawn ENOENT.
      wireNet(() => {
        const res = makeResponse(200)
        setImmediate(() => res.emit('end'))
        return res
      })
      mockExistsSync.mockImplementation((path: string) => !String(path).endsWith('whisper-server.exe'))

      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).rejects.toThrow(
        /Extraction reported success but whisper-server\.exe is missing/
      )
    })

    it('returns the exe path when extraction really did produce the exe', async () => {
      // Same flow as above, but the exe materializes once powershell has run —
      // the verification must not reject the legitimate happy path.
      let extracted = false
      wireNet(() => {
        const res = makeResponse(200)
        setImmediate(() => res.emit('end'))
        return res
      })
      mockExistsSync.mockImplementation((path: string) =>
        String(path).endsWith('whisper-server.exe') ? extracted : true
      )
      mockExecFile.mockImplementation((cmd: string, _args: unknown[], cb?: (err: Error | null) => void) => {
        if (cmd === 'powershell' && cb) {
          extracted = true
          setImmediate(() => cb(null))
        }
        return makeFakeProc()
      })

      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).resolves.toMatch(/whisper-server\.exe$/)
    })

    it('rejects on non-200 status', async () => {
      wireNet(() => makeResponse(404))
      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).rejects.toThrow(/HTTP 404/)
    })

    it('rejects when the response stream emits an error', async () => {
      mockNetRequest.mockImplementation(() => {
        const req = new EventEmitter() as EventEmitter & { end: () => void }
        req.end = vi.fn(() => {
          setImmediate(() => {
            const res = makeResponse(200)
            req.emit('response', res)
            res.emit('error', new Error('stream broke'))
          })
        })
        return req
      })
      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).rejects.toThrow(/stream broke/)
    })

    it('rejects when the request emits an error', async () => {
      mockNetRequest.mockImplementation(() => {
        const req = new EventEmitter() as EventEmitter & { end: () => void }
        req.end = vi.fn(() => {
          setImmediate(() => req.emit('error', new Error('net down')))
        })
        return req
      })
      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).rejects.toThrow(/net down/)
    })

    it('rejects when extraction (powershell) fails', async () => {
      wireNet(() => {
        const res = makeResponse(200)
        setImmediate(() => res.emit('end'))
        return res
      })
      mockExecFile.mockImplementation((cmd: string, _args: unknown[], cb?: (err: Error | null) => void) => {
        if (cmd === 'powershell' && cb) setImmediate(() => cb(new Error('boom')))
        return makeFakeProc()
      })
      const mod = await freshModule()
      await expect(mod.downloadServerBinary()).rejects.toThrow(/Failed to extract: boom/)
    })

    it('startServer downloads the binary when the exe is absent', async () => {
      // exe absent (triggers download) until powershell extracts it, then present
      let exeChecks = 0
      let extracted = false
      mockExistsSync.mockImplementation((p: string) => {
        const s = String(p)
        if (s.endsWith('whisper-server.exe')) {
          exeChecks++
          return extracted // absent -> triggers downloadServerBinary
        }
        return true // dir + model present
      })

      const res = makeResponse(200)
      mockNetRequest.mockImplementation(() => {
        const req = new EventEmitter() as EventEmitter & { end: () => void }
        req.end = vi.fn(() => {
          setImmediate(() => {
            req.emit('response', res)
            res.emit('end')
          })
        })
        return req
      })

      const serverProc = makeFakeProc()
      mockExecFile.mockImplementation((cmd: string, _args: unknown[], cb?: (err: Error | null) => void) => {
        if (cmd === 'powershell' && cb) {
          extracted = true // the extraction really wrote the exe
          setImmediate(() => cb(null))
          return makeFakeProc()
        }
        return serverProc // the actual server spawn
      })

      const mod = await freshModule()
      const startP = mod.startServer('model.bin')
      // give the async download a chance, then signal listening
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
      serverProc.stdout.emit('data', READY_LINE)
      await startP
      expect(mod.getServerStatus().status).toBe('running')
      expect(exeChecks).toBeGreaterThan(0)
      mod.stopServer()
    })
  })

  describe('idle TTL sweep', () => {
    it('auto-stops a running server once it has been idle past the TTL', async () => {
      vi.useFakeTimers()
      try {
        setPlatform('win32')
        const mod = await freshModule()
        mockExistsSync.mockReturnValue(true)
        mod.setIdleTtlMs(1_000) // reclaim after 1s idle
        const proc = makeFakeProc()
        mockExecFile.mockReturnValue(proc)

        const startP = mod.startServer('model.bin')
        proc.stdout.emit('data', READY_LINE)
        await startP
        expect(mod.getServerStatus().status).toBe('running')

        // Advance past the TTL and at least one sweep interval (60s).
        await vi.advanceTimersByTimeAsync(61_000)

        expect(mod.getServerStatus().status).toBe('stopped')
        expect(proc.kill).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not reclaim a server that keeps being used (markServerUsed resets the clock)', async () => {
      vi.useFakeTimers()
      try {
        setPlatform('win32')
        const mod = await freshModule()
        mockExistsSync.mockReturnValue(true)
        mod.setIdleTtlMs(120_000) // 2 min idle TTL
        const proc = makeFakeProc()
        mockExecFile.mockReturnValue(proc)

        const startP = mod.startServer('model.bin')
        proc.stdout.emit('data', READY_LINE)
        await startP

        // 90s pass (< TTL), then a transcription request resets the idle clock.
        await vi.advanceTimersByTimeAsync(90_000)
        expect(mod.getServerStatus().status).toBe('running')
        mod.markServerUsed()

        // Another 90s: 180s since start but only 90s since last use → still alive.
        await vi.advanceTimersByTimeAsync(90_000)
        expect(mod.getServerStatus().status).toBe('running')

        mod.stopServer()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('setServerStatusCallback', () => {
    it('replaces the callback so only the latest receives updates', async () => {
      const mod = await freshModule()
      const first = vi.fn()
      const second = vi.fn()
      mod.setServerStatusCallback(first)
      mod.setServerStatusCallback(second)
      mod.stopServer()
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalled()
    })
  })
})
