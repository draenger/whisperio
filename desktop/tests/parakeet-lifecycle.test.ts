import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ud', getAppPath: () => '/tmp/app' },
  net: { request: vi.fn() }
}))

import { parakeetTranscribe, shutdownParakeet, deps, ParakeetClipTooLongError } from '../src/main/stt/parakeet'

class FakeWorker extends EventEmitter {
  all: unknown[] = []
  /** Recognition requests only (the first message to the child is the init handshake). */
  get posted(): unknown[] {
    return this.all.filter((m) => (m as { type?: string }).type !== 'init')
  }
  terminated = false
  postMessage(m: unknown): void {
    this.all.push(m)
  }
  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(0)
  }
}

function wav(frames: number): Buffer {
  const data = Buffer.alloc(frames * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

let fw: FakeWorker
const orig = { ...deps }

beforeEach(() => {
  vi.useFakeTimers()
  fw = new FakeWorker()
  deps.resolveSherpa = () => ({ path: '/x/sherpa' })
  deps.getModelPaths = () => ({ encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't' })
  deps.createWorker = () => fw as never
  deps.readyTimeoutMs = 1000
  deps.minRequestTimeoutMs = 30_000
})
afterEach(async () => {
  await shutdownParakeet()
  Object.assign(deps, orig)
  vi.useRealTimers()
})

describe('parakeet worker lifecycle', () => {
  it('allows a caller-reported 299-second clip to reach the worker', async () => {
    const p = parakeetTranscribe(wav(1600), { durationSeconds: 299 })
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fw.posted).toHaveLength(1)
    const { id } = fw.posted[0] as { id: number }
    fw.emit('message', { type: 'result', id, text: 'ok' })
    await expect(p).resolves.toBe('ok')
  })

  it('refuses a 301-second WAV from its data chunk before starting a worker', async () => {
    const createWorker = vi.spyOn(deps, 'createWorker')
    await expect(parakeetTranscribe(wav(16000 * 301))).rejects.toThrow(ParakeetClipTooLongError)
    expect(fw.posted).toHaveLength(0)
    expect(createWorker).not.toHaveBeenCalled()
    createWorker.mockRestore()
  })
  it('waits for ready before posting, then resolves the result', async () => {
    const p = parakeetTranscribe(wav(1600))
    await Promise.resolve()
    expect(fw.posted).toHaveLength(0)
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fw.posted).toHaveLength(1)
    const { id } = fw.posted[0] as { id: number }
    fw.emit('message', { type: 'result', id, text: 'ok' })
    await expect(p).resolves.toBe('ok')
  })

  it('rejects when the worker never becomes ready', async () => {
    const p = parakeetTranscribe(wav(1600))
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(1001)
    await expect(p).rejects.toThrow(/ready in time/)
    expect(fw.terminated).toBe(true)
  })

  it('rejects pending requests when the process exits', async () => {
    const p = parakeetTranscribe(wav(1600))
    p.catch(() => {})
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    fw.emit('exit', 1)
    await expect(p).rejects.toThrow(/Parakeet process exited unexpectedly \(code 1\)/)
  })

  it('times out a stuck request, terminates the worker and rejects', async () => {
    const p = parakeetTranscribe(wav(1600))
    p.catch(() => {})
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_001)
    await expect(p).rejects.toThrow(/timed out/)
    expect(fw.terminated).toBe(true)
  })

  it('scales the timeout with audio length (3x duration, min 30s)', async () => {
    const p = parakeetTranscribe(wav(16000 * 20)) // 20 s clip -> 60 s timeout
    p.catch(() => {})
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(fw.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(20_001)
    await expect(p).rejects.toThrow(/timed out after 60s/)
  })

  it('shutdown awaits termination and rejects in-flight work', async () => {
    const p = parakeetTranscribe(wav(1600))
    p.catch(() => {})
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    await shutdownParakeet()
    expect(fw.terminated).toBe(true)
    await expect(p).rejects.toThrow(/stopped/)
  })

  it('a late exit of an OLD worker does not reject the NEW worker\'s pending request', async () => {
    const fw2 = new FakeWorker()
    const workers = [fw, fw2]
    deps.createWorker = () => workers.shift() as never
    const p1 = parakeetTranscribe(wav(1600))
    const p1Assert = expect(p1).rejects.toThrow(/timed out/)
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_001) // timeout -> stopWorker clears the host
    await p1Assert
    const p2 = parakeetTranscribe(wav(1600))
    fw2.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fw2.posted).toHaveLength(1)
    fw.emit('exit', 1) // late exit of the old worker
    await vi.advanceTimersByTimeAsync(0)
    const { id } = fw2.posted[0] as { id: number }
    fw2.emit('message', { type: 'result', id, text: 'still-ok' })
    await expect(p2).resolves.toBe('still-ok')
  })

  it('sends the init handshake with the addon path rewritten to app.asar.unpacked', async () => {
    deps.resolveSherpa = () => ({ path: '/Apps/W/resources/app.asar/node_modules/sherpa-onnx-node/sherpa-onnx.js' })
    const p = parakeetTranscribe(wav(1600))
    p.catch(() => {})
    const init = fw.all[0] as { type: string; sherpaPath: string; config: unknown }
    expect(init.type).toBe('init')
    expect(init.sherpaPath).toBe('/Apps/W/resources/app.asar.unpacked/node_modules/sherpa-onnx-node/sherpa-onnx.js')
    expect(init.config).toBeTruthy()
  })

  it('a native crash (child exit) while pending rejects clearly and the next call starts a NEW process', async () => {
    const fw2 = new FakeWorker()
    const workers = [fw, fw2]
    const create = vi.fn(() => workers.shift() as never)
    deps.createWorker = create
    const p1 = parakeetTranscribe(wav(1600))
    const p1Assert = expect(p1).rejects.toThrow('Parakeet process exited unexpectedly (code 3221225477).')
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    fw.emit('exit', 3221225477)
    await p1Assert
    expect(create).toHaveBeenCalledTimes(1)
    const p2 = parakeetTranscribe(wav(1600))
    fw2.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    expect(create).toHaveBeenCalledTimes(2)
    const { id } = fw2.posted[0] as { id: number }
    fw2.emit('message', { type: 'result', id, text: 'recovered' })
    await expect(p2).resolves.toBe('recovered')
  })

  it('a crash with a null exit code (signal) is also reported', async () => {
    const p = parakeetTranscribe(wav(1600))
    const a = expect(p).rejects.toThrow(/exited unexpectedly \(code null\)/)
    fw.emit('exit', null)
    await a
  })

  it('the main process only resolves the addon path, never loads it', async () => {
    const resolveSherpa = vi.fn(() => ({ path: '/x/sherpa' }))
    deps.resolveSherpa = resolveSherpa
    const p = parakeetTranscribe(wav(1600))
    p.catch(() => {})
    expect(resolveSherpa).toHaveBeenCalledTimes(1)
    // the seam returns a path only: there is no module object for main to hold or call
    expect(Object.keys(resolveSherpa.mock.results[0].value)).toEqual(['path'])
  })
})
