import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ud', getAppPath: () => '/tmp/app' },
  net: { request: vi.fn() }
}))

import { parakeetTranscribe, shutdownParakeet, deps } from '../src/main/stt/parakeet'

class FakeWorker extends EventEmitter {
  posted: unknown[] = []
  terminated = false
  postMessage(m: unknown): void {
    this.posted.push(m)
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
  deps.loadSherpa = () => ({ path: '/x/sherpa' })
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

  it('rejects pending requests when the worker exits', async () => {
    const p = parakeetTranscribe(wav(1600))
    p.catch(() => {})
    fw.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(0)
    fw.emit('exit', 1)
    await expect(p).rejects.toThrow(/exited unexpectedly/)
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
})
