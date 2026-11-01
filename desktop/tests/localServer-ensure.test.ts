import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { readFileSync } from 'fs'
import { EventEmitter } from 'events'

// Mock active-win in case anything in the import graph pulls it in.
vi.mock('active-win', () => ({ default: vi.fn() }))

const testDir = join(tmpdir(), `whisperio-ensure-${Date.now()}`)
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  net: { request: vi.fn() }
}))

const mockExistsSync = vi.fn()
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (...a: unknown[]) => mockExistsSync(...a),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    createWriteStream: vi.fn()
  }
})

// Integrity (SHA-256 pin/TOFU) is covered by tests/serverIntegrity.test.ts; the fake exe here does not exist on disk.
vi.mock('../src/main/downloadIntegrity', async () => {
  const { createHash } = await import('crypto')
  return {
    IntegrityError: class IntegrityError extends Error {},
    newHasher: () => createHash('sha256'),
    checkDigest: () => ({ mode: 'pinned', commit: () => {} }),
    hashFile: () => 'h',
    getStoredHash: () => 'h',
    storeHash: () => {},
    forgetHash: () => {}
  }
})

const mockPortAnswers = { value: false }
vi.mock('net', () => ({
  createConnection: () => {
    const s = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: () => void }
    s.setTimeout = (): void => {}
    s.destroy = (): void => {}
    queueMicrotask(() => s.emit(mockPortAnswers.value ? 'connect' : 'error', new Error('ECONNREFUSED')))
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

const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

interface FakeProc extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
  killed: boolean
}
const procs: FakeProc[] = []
function wireSpawn(): void {
  mockExecFile.mockImplementation(() => {
    const p = new EventEmitter() as FakeProc
    p.stdout = new EventEmitter()
    p.stderr = new EventEmitter()
    p.killed = false
    p.kill = vi.fn(() => { p.killed = true; return true })
    procs.push(p)
    queueMicrotask(() => p.stdout.emit('data', 'whisper server listening at http://127.0.0.1:8178\n'))
    return p
  })
}

describe('localServer on-demand restart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    procs.length = 0
    mockPortAnswers.value = false
    mockExistsSync.mockReturnValue(true)
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    wireSpawn()
  })
  afterEach(() => {
    vi.useRealTimers()
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
  })

  it('restarts after the idle sweep stopped it', async () => {
    vi.useFakeTimers()
    const mod = await fresh()
    mod.setIdleTtlMs(1000)
    await mod.startServer('ggml-base.bin')
    expect(mod.getServerStatus().status).toBe('running')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mod.getServerStatus().status).toBe('stopped')
    expect(procs[0].kill).toHaveBeenCalled()

    await mod.ensureManagedServerForUrl('http://127.0.0.1:8178', 'ggml-base')
    expect(mod.getServerStatus().status).toBe('running')
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('concurrent ensure shares one spawn', async () => {
    const mod = await fresh()
    await Promise.all([
      mod.ensureLocalServer('ggml-base.bin'),
      mod.ensureLocalServer('ggml-base.bin'),
      mod.ensureManagedServerForUrl('http://127.0.0.1:8178', 'ggml-base')
    ])
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(mod.getServerStatus().status).toBe('running')
  })

  it('does not spawn when something already serves the port', async () => {
    const mod = await fresh()
    mockPortAnswers.value = true
    await mod.ensureManagedServerForUrl('http://127.0.0.1:8178', 'ggml-base')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('uses a start/readiness timeout below the 60 s hotkey safety timer', async () => {
    const mod = await fresh()
    expect(mod.ENSURE_TIMEOUT_MS).toBeLessThanOrEqual(20_000)
    vi.useFakeTimers()
    // spawn that never prints the ready line
    mockExecFile.mockImplementation(() => {
      const p = new EventEmitter() as FakeProc
      p.stdout = new EventEmitter()
      p.stderr = new EventEmitter()
      p.killed = false
      p.kill = vi.fn(() => true)
      return p
    })
    const pr = mod.ensureLocalServer('ggml-base.bin')
    const assertion = expect(pr).rejects.toThrow(/Timed out/)
    await vi.advanceTimersByTimeAsync(21_000)
    await assertion
  })

  it('does not touch manual (non-managed) servers', async () => {
    const mod = await fresh()
    await mod.ensureManagedServerForUrl('http://192.168.1.5:9000', 'ggml-base')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('does nothing when the model file is missing', async () => {
    const mod = await fresh()
    mockExistsSync.mockImplementation((p: string) => !String(p).endsWith('.bin'))
    await mod.ensureManagedServerForUrl('http://127.0.0.1:8178', 'ggml-base')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('stopServer (called on quit) kills the process', async () => {
    const mod = await fresh()
    await mod.startServer('ggml-base.bin')
    mod.stopServer()
    expect(procs[0].kill).toHaveBeenCalled()
    expect(mod.getServerStatus().status).toBe('stopped')
  })

  it('index.ts stops the server on before-quit', () => {
    const src = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf-8')
    const m = src.match(/app\.on\('before-quit', \(\) => \{[\s\S]*?\n\}\)/)
    expect(m?.[0]).toContain('stopServer()')
  })

  const BS = String.fromCharCode(92)
  it.each(['../x.bin', `..${BS}x.bin`, 'sub/x.bin', `C:${BS}evil.bin`, '/etc/x.bin', 'x.txt', 'x'])(
    'startServer rejects %s',
    async (name) => {
      const mod = await fresh()
      await expect(mod.startServer(name)).rejects.toThrow(/Invalid model filename/)
      expect(mockExecFile).not.toHaveBeenCalled()
    }
  )

  it('accepts a plain .bin inside the models dir', async () => {
    const mod = await fresh()
    expect(mod.resolveModelPath('ggml-base.bin').startsWith(join(testDir, 'models'))).toBe(true)
  })
})
