import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'

/**
 * startServer() recovery after a failed start.
 *
 * startServer() flips serverStatus to 'starting' before awaiting
 * downloadServerBinary(), and its own re-entry guard rejects when the status is
 * 'running' OR 'starting'. So when the binary download failed (offline, 404,
 * disk full) the status was left pinned at 'starting' forever: every later
 * attempt died with "Server is already running." and the local-model server
 * became unstartable until the whole app was restarted, with nothing the user
 * could do about it.
 *
 * Harness mirrors tests/localServer.test.ts.
 */

const testDir = join(tmpdir(), `whisperio-startrec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  net: { request: (...args: unknown[]) => mockNetRequest(...args) }
}))

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

const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args)
}))

type LocalServerModule = typeof import('../src/main/localServer')

async function freshModule(): Promise<LocalServerModule> {
  vi.resetModules()
  return import('../src/main/localServer')
}

const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

/** net.request that always answers with the given HTTP status and no body. */
function wireNetStatus(statusCode: number): void {
  mockNetRequest.mockImplementation(() => {
    const req = new EventEmitter() as EventEmitter & { end: () => void }
    req.end = (): void => {
      queueMicrotask(() => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number
          headers: Record<string, string>
        }
        res.statusCode = statusCode
        res.headers = {}
        req.emit('response', res)
      })
    }
    return req
  })
}

function makeFakeProc(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => boolean
  killed: boolean
} {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => boolean
    killed: boolean
  }
  emitter.stdout = new EventEmitter()
  emitter.stderr = new EventEmitter()
  emitter.killed = false
  emitter.kill = (): boolean => {
    emitter.killed = true
    return true
  }
  return emitter
}

describe('localServer — recovery from a failed start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
  })

  afterEach(() => {
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
  })

  it('leaves the status at "error", not "starting", when the binary download fails', async () => {
    setPlatform('win32')
    const mod = await freshModule()
    // exe absent -> triggers downloadServerBinary, which 404s.
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('whisper-server.exe'))
    wireNetStatus(404)

    await expect(mod.startServer('model.bin')).rejects.toThrow(/HTTP 404/)

    expect(mod.getServerStatus().status).toBe('error')
  })

  it('allows a retry after a failed binary download', async () => {
    setPlatform('win32')
    const mod = await freshModule()
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('whisper-server.exe'))
    wireNetStatus(404)

    await expect(mod.startServer('model.bin')).rejects.toThrow(/HTTP 404/)

    // The defect: this second attempt used to fail with "Server is already
    // running." because the status was stuck at 'starting'.
    await expect(mod.startServer('model.bin')).rejects.not.toThrow(/already running/)
  })

  it('starts successfully on a retry once the binary is present', async () => {
    setPlatform('win32')
    const mod = await freshModule()
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('whisper-server.exe'))
    wireNetStatus(500)

    await expect(mod.startServer('model.bin')).rejects.toThrow(/HTTP 500/)

    // User installs the binary manually / the next download works.
    mockExistsSync.mockReturnValue(true)
    const proc = makeFakeProc()
    mockExecFile.mockReturnValue(proc)

    const startP = mod.startServer('model.bin')
    await Promise.resolve()
    proc.stdout.emit('data', 'server listening on 127.0.0.1:8178')

    await expect(startP).resolves.toBeUndefined()
    expect(mod.getServerStatus().status).toBe('running')
    mod.stopServer()
  })

  it('reports the download failure through the status callback', async () => {
    setPlatform('win32')
    const mod = await freshModule()
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('whisper-server.exe'))
    wireNetStatus(404)

    const statuses: { status: string, error?: string }[] = []
    mod.setServerStatusCallback((s) => statuses.push({ status: s.status, error: s.error }))

    await expect(mod.startServer('model.bin')).rejects.toThrow()

    const last = statuses[statuses.length - 1]
    expect(last.status).toBe('error')
    expect(last.error).toMatch(/HTTP 404/)
  })

  it('does not pin the status at "starting" when the model is missing after a download', async () => {
    setPlatform('win32')
    const mod = await freshModule()
    // exe absent (download runs and succeeds), model file absent.
    mockExistsSync.mockImplementation((p: string) => {
      const s = String(p)
      if (s.endsWith('whisper-server.exe')) return false
      if (s.endsWith('model.bin')) return false
      return true
    })
    // Make the download succeed: 200 + a write stream that flushes, then a
    // successful powershell extract.
    mockNetRequest.mockImplementation(() => {
      const req = new EventEmitter() as EventEmitter & { end: () => void }
      req.end = (): void => {
        queueMicrotask(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number
            headers: Record<string, string>
            pause: () => void
            resume: () => void
          }
          res.statusCode = 200
          res.headers = {}
          res.pause = (): void => {}
          res.resume = (): void => {}
          req.emit('response', res)
          queueMicrotask(() => {
            res.emit('data', Buffer.from('zip'))
            res.emit('end')
          })
        })
      }
      return req
    })
    const ws = new EventEmitter() as EventEmitter & {
      write: () => boolean
      end: (cb: () => void) => void
      destroy: () => void
    }
    ws.write = (): boolean => true
    ws.end = (cb: () => void): void => cb()
    ws.destroy = (): void => {}
    mockCreateWriteStream.mockReturnValue(ws)
    mockExecFile.mockImplementation((_cmd, _args, cb: (err: Error | null) => void) => {
      cb(null)
      return makeFakeProc()
    })

    await expect(mod.startServer('model.bin')).rejects.toThrow(/Model not found/)

    expect(mod.getServerStatus().status).toBe('error')
    expect(mod.getServerStatus().model).toBeNull()
  })
})
