import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'
import { createHash } from 'crypto'

// Gap tests for localServer.ts: ensure* while a start is in flight, model-name
// normalisation in ensureManagedServerForUrl, non-Error start failures, the
// 30 s assume-running timer after a real ready line, and downloadFile's
// backpressure / single-failure handling.

const testDir = join(tmpdir(), `whisperio-gaps-${Date.now()}`)
const READY = 'whisper server listening at http://127.0.0.1:8178\n'

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  net: { request: (...a: unknown[]) => mockNetRequest(...a) }
}))

const mockExistsSync = vi.fn()
const mockUnlinkSync = vi.fn()
const mockCreateWriteStream = vi.fn()
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  mkdirSync: vi.fn(),
  unlinkSync: (...a: unknown[]) => mockUnlinkSync(...a),
  createWriteStream: (...a: unknown[]) => mockCreateWriteStream(...a)
}))

const digests: string[] = []
vi.mock('../src/main/downloadIntegrity', async () => {
  const { createHash: ch } = await import('crypto')
  return {
    IntegrityError: class IntegrityError extends Error {},
    newHasher: () => ch('sha256'),
    checkDigest: (_k: string, _l: string, digest: string) => {
      digests.push(digest)
      return { mode: 'pinned', commit: () => {} }
    },
    hashFile: () => 'h',
    getStoredHash: () => 'h',
    storeHash: () => {},
    forgetHash: () => {}
  }
})

const portProbes = { count: 0, answers: false }
vi.mock('net', () => ({
  createConnection: () => {
    portProbes.count++
    const s = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: () => void }
    s.setTimeout = (): void => {}
    s.destroy = (): void => {}
    queueMicrotask(() => s.emit(portProbes.answers ? 'connect' : 'error', new Error('ECONNREFUSED')))
    return s
  }
}))

const mockExecFile = vi.fn()
vi.mock('child_process', () => ({ execFile: (...a: unknown[]) => mockExecFile(...a) }))

type Mod = typeof import('../src/main/localServer')
async function fresh(): Promise<Mod> {
  vi.resetModules()
  return import('../src/main/localServer')
}

interface FakeProc extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
  killed: boolean
}
const procs: FakeProc[] = []
function spawnWith(autoReady: boolean): void {
  mockExecFile.mockImplementation(() => {
    const p = new EventEmitter() as FakeProc
    p.stdout = new EventEmitter()
    p.stderr = new EventEmitter()
    p.killed = false
    p.kill = vi.fn(() => { p.killed = true; return true })
    procs.push(p)
    if (autoReady) queueMicrotask(() => p.stdout.emit('data', READY))
    return p
  })
}

const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

beforeEach(() => {
  vi.clearAllMocks()
  procs.length = 0
  digests.length = 0
  portProbes.count = 0
  portProbes.answers = false
  mockExistsSync.mockReturnValue(true)
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  spawnWith(true)
})
afterEach(() => {
  vi.useRealTimers()
  if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
})

describe('ensureLocalServer', () => {
  it('when already running: no spawn, no port probe, and it resets the idle clock', async () => {
    vi.useFakeTimers()
    const mod = await fresh()
    mod.setIdleTtlMs(120_000)
    await mod.startServer('ggml-base.bin')
    await vi.advanceTimersByTimeAsync(100_000)

    await mod.ensureLocalServer('ggml-base.bin')
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(portProbes.count).toBe(0)

    // Without the stamp the sweep at t=120 s would stop it (120 s idle).
    await vi.advanceTimersByTimeAsync(70_000)
    expect(mod.getServerStatus().status).toBe('running')
    expect(procs[0].kill).not.toHaveBeenCalled()
  })

  it('while a start is in flight: waits for it and shares the one process', async () => {
    spawnWith(false)
    const mod = await fresh()
    const start = mod.startServer('ggml-base.bin')
    await flush()
    expect(mod.getServerStatus().status).toBe('starting')

    let ensured = false
    const ensure = mod.ensureLocalServer('ggml-base.bin').then(() => { ensured = true })
    await new Promise((r) => setTimeout(r, 150))
    expect(ensured).toBe(false)

    procs[0].stdout.emit('data', READY)
    await Promise.all([start, ensure])
    expect(ensured).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(portProbes.count).toBe(0)
  })

  it('while a start is in flight that then fails: rejects with a clear error', async () => {
    spawnWith(false)
    const mod = await fresh()
    const start = mod.startServer('ggml-base.bin')
    const startResult = start.catch((e: Error) => e)
    await flush()

    const ensure = mod.ensureLocalServer('ggml-base.bin')
    const ensureResult = ensure.catch((e: Error) => e)
    procs[0].emit('exit', 3)

    expect(((await startResult) as Error).message).toBe('Server exited with code 3')
    expect(((await ensureResult) as Error).message).toBe('Local whisper server failed to start.')
    expect(mod.getServerStatus().status).toBe('error')
  })
})

describe('ensureManagedServerForUrl model names', () => {
  const modelArg = (): string => {
    const args = mockExecFile.mock.calls[0][1] as string[]
    return args[args.indexOf('-m') + 1]
  }

  it.each(['ggml-base.bin', 'GGML-BASE.BIN', ' ggml-base.bin '])('keeps an existing .bin suffix (%j)', async (name) => {
    const mod = await fresh()
    await mod.ensureManagedServerForUrl('http://127.0.0.1:8178', name)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(modelArg()).toBe(join(testDir, 'models', name.trim()))
  })

  it('appends .bin to a bare model name', async () => {
    const mod = await fresh()
    await mod.ensureManagedServerForUrl('http://localhost:8178/v1', 'ggml-small')
    expect(modelArg()).toBe(join(testDir, 'models', 'ggml-small.bin'))
  })

  it.each([['', 'empty'], ['   ', 'blank'], [undefined, 'missing']])('does nothing for an %s model (%s)', async (name) => {
    const mod = await fresh()
    await mod.ensureManagedServerForUrl('http://127.0.0.1:8178', name as unknown as string)
    expect(mockExecFile).not.toHaveBeenCalled()
    expect(portProbes.count).toBe(0)
  })

  it.each(['../evil', 'sub/x', 'a\0b'])('silently ignores an unsafe model name %j', async (name) => {
    const mod = await fresh()
    await expect(mod.ensureManagedServerForUrl('http://127.0.0.1:8178', name)).resolves.toBeUndefined()
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('a running server is still used (and stamped) after its model file disappears', async () => {
    vi.useFakeTimers()
    const mod = await fresh()
    mod.setIdleTtlMs(120_000)
    await mod.startServer('ggml-base.bin')
    await vi.advanceTimersByTimeAsync(100_000)
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('.bin'))
    await mod.ensureManagedServerForUrl('http://127.0.0.1:8178', 'ggml-base')
    // The use was stamped, so the sweep at t=120 s keeps the server up.
    await vi.advanceTimersByTimeAsync(70_000)
    expect(mod.getServerStatus().status).toBe('running')
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })
})

describe('startServer edge cases', () => {
  it('a non-Error failure is reported as text and does not wedge the status', async () => {
    const mod = await fresh()
    const seen: { status: string; error?: string }[] = []
    mod.setServerStatusCallback((s) => seen.push(s))
    mockExecFile.mockImplementationOnce(() => { throw 'spawn refused' })

    await expect(mod.startServer('ggml-base.bin')).rejects.toBe('spawn refused')
    expect(mod.getServerStatus().status).toBe('error')
    expect(seen.at(-1)).toMatchObject({ status: 'error', error: 'spawn refused' })

    await mod.startServer('ggml-base.bin')
    expect(mod.getServerStatus().status).toBe('running')
  })

  // The ready line both cancels the fallback timer and sets `started`; either
  // one alone keeps the timer from re-announcing 'running'.
  it('the 30 s fallback timer does nothing once the ready line was seen', async () => {
    vi.useFakeTimers()
    const mod = await fresh()
    const seen: string[] = []
    mod.setServerStatusCallback((s) => seen.push(s.status))
    await mod.startServer('ggml-base.bin')
    expect(seen).toEqual(['starting', 'running'])

    mod.setIdleTtlMs(10 * 60_000)
    await vi.advanceTimersByTimeAsync(31_000)
    expect(seen).toEqual(['starting', 'running'])
    expect(mod.getServerStatus().status).toBe('running')
  })
})

describe('downloadServerBinary stream handling', () => {
  type Res = EventEmitter & { statusCode: number; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> }
  type Ws = EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
  let res: Res
  let ws: Ws
  let writeResults: boolean[]

  beforeEach(() => {
    writeResults = []
    res = Object.assign(new EventEmitter(), { statusCode: 200, pause: vi.fn(), resume: vi.fn() }) as Res
    ws = Object.assign(new EventEmitter(), {
      write: vi.fn(() => writeResults.shift() ?? true),
      end: vi.fn((cb?: () => void) => cb && cb()),
      destroy: vi.fn()
    }) as Ws
    mockCreateWriteStream.mockReturnValue(ws)
    mockNetRequest.mockImplementation(() => {
      const req = new EventEmitter() as EventEmitter & { end: () => void }
      req.end = vi.fn(() => setImmediate(() => req.emit('response', res)))
      return req
    })
    mockExecFile.mockImplementation((cmd: string, _a: unknown[], cb?: (e: Error | null) => void) => {
      if (cmd === 'powershell' && cb) setImmediate(() => cb(null))
      return new EventEmitter()
    })
  })

  const zipUnlinks = (): number =>
    mockUnlinkSync.mock.calls.filter(([p]) => String(p).endsWith('whisper-bin-x64.zip')).length

  it('pauses on backpressure, resumes on drain, and hashes every byte', async () => {
    const mod = await fresh()
    const p = mod.downloadServerBinary()
    await flush()
    writeResults = [false, true]
    res.emit('data', Buffer.from('ab'))
    expect(res.pause).toHaveBeenCalledTimes(1)
    expect(res.resume).not.toHaveBeenCalled()
    ws.emit('drain')
    expect(res.resume).toHaveBeenCalledTimes(1)
    res.emit('data', Buffer.from('cd'))
    res.emit('end')

    await expect(p).resolves.toMatch(/whisper-server\.exe$/)
    expect(res.pause).toHaveBeenCalledTimes(1)
    expect(digests).toEqual([createHash('sha256').update('abcd').digest('hex')])
  })

  it('a drain after a write failure does not resume the download', async () => {
    const mod = await fresh()
    const p = mod.downloadServerBinary().catch((e: Error) => e)
    await flush()
    writeResults = [false]
    res.emit('data', Buffer.from('ab'))
    ws.emit('error', new Error('disk full'))
    ws.emit('drain')

    expect(((await p) as Error).message).toBe('disk full')
    expect(res.resume).not.toHaveBeenCalled()
  })

  it('fails once: later errors, data and end after the first failure are ignored', async () => {
    const mod = await fresh()
    const p = mod.downloadServerBinary().catch((e: Error) => e)
    await flush()
    res.emit('data', Buffer.from('ab'))
    ws.emit('error', new Error('disk full'))
    res.emit('error', new Error('socket reset'))
    res.emit('data', Buffer.from('cd'))
    res.emit('end')

    expect(((await p) as Error).message).toBe('disk full')
    expect(ws.write).toHaveBeenCalledTimes(1)
    expect(ws.destroy).toHaveBeenCalledTimes(1)
    expect(ws.end).not.toHaveBeenCalled()
    expect(zipUnlinks()).toBe(1)
    expect(digests).toEqual([])
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('a non-Error stream failure is rejected as an Error with its text', async () => {
    const mod = await fresh()
    const p = mod.downloadServerBinary().catch((e: unknown) => e)
    await flush()
    res.emit('error', 'cable unplugged')

    const err = await p
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('cable unplugged')
  })
})
