import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ud', getAppPath: () => '/tmp/app' },
  net: { request: vi.fn() }
}))

import { parakeetTranscribe, shutdownParakeet, wavToPcm16k, deps } from '../src/main/stt/parakeet'

// WAV parsing edge cases (lab-only on-device STT), and a crashing worker whose terminate() also
// rejects: the failure must reach the caller and nothing may escape as an unhandled rejection.

function chunk(id: string, body: Buffer): Buffer {
  const h = Buffer.alloc(8)
  h.write(id, 0, 'ascii')
  h.writeUInt32LE(body.length, 4)
  return Buffer.concat([h, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}
function fmt(format: number, bits: number, channels = 1, rate = 16000): Buffer {
  const b = Buffer.alloc(16)
  b.writeUInt16LE(format, 0)
  b.writeUInt16LE(channels, 2)
  b.writeUInt32LE(rate, 4)
  b.writeUInt32LE((rate * channels * bits) / 8, 8)
  b.writeUInt16LE((channels * bits) / 8, 12)
  b.writeUInt16LE(bits, 14)
  return chunk('fmt ', b)
}
function riff(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), ...chunks])
  const h = Buffer.alloc(8)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(body.length, 4)
  return Buffer.concat([h, body])
}
function pcm16(values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 2)
  values.forEach((v, i) => b.writeInt16LE(v, i * 2))
  return b
}

describe('wavToPcm16k: malformed and unsupported files', () => {
  it('skips an unknown chunk with an odd size (padding byte) before the data chunk', () => {
    const out = wavToPcm16k(riff(fmt(1, 16), chunk('LIST', Buffer.from('abc')), chunk('data', pcm16([16384, -16384]))))
    expect(Array.from(out)).toEqual([0.5, -0.5])
  })

  it('refuses a file without a data chunk, or without a fmt chunk', () => {
    // (both padded past the 44-byte minimum, so the chunk check is what refuses them)
    expect(() => wavToPcm16k(riff(fmt(1, 16), chunk('LIST', Buffer.alloc(16))))).toThrow('Malformed WAV: missing fmt or data chunk.')
    expect(() => wavToPcm16k(riff(chunk('data', pcm16(new Array(20).fill(1)))))).toThrow('Malformed WAV: missing fmt or data chunk.')
  })

  it('refuses 8-bit and 24-bit PCM and 64-bit float, naming the format', () => {
    const data = chunk('data', Buffer.alloc(12))
    expect(() => wavToPcm16k(riff(fmt(1, 8), data))).toThrow('Unsupported WAV format (format=1, bits=8).')
    expect(() => wavToPcm16k(riff(fmt(1, 24), data))).toThrow('Unsupported WAV format (format=1, bits=24).')
    expect(() => wavToPcm16k(riff(fmt(3, 64), data))).toThrow('Unsupported WAV format (format=3, bits=64).')
  })
})

class FailingWorker extends EventEmitter {
  terminateCalls = 0
  postMessage(): void {}
  // Plain function on purpose: vitest attaches its own handler to vi.fn() promises, which would
  // hide a missing .catch in the code under test.
  terminate(): Promise<number> {
    this.terminateCalls++
    return Promise.reject(new Error('terminate failed'))
  }
}

describe('a crashing worker whose terminate() rejects', () => {
  const orig = { ...deps }
  const unhandled: unknown[] = []
  const onUnhandled = (r: unknown): void => {
    unhandled.push(r)
  }
  let fw: FailingWorker
  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    fw = new FailingWorker()
    deps.resolveSherpa = () => ({ path: '/x/sherpa' })
    deps.getModelPaths = () => ({ encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't' })
    deps.createWorker = () => fw as never
    deps.readyTimeoutMs = 60_000
  })
  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    deps.createWorker = () => new EventEmitter() as never
    await shutdownParakeet().catch(() => undefined)
    Object.assign(deps, orig)
  })

  it('rejects the pending transcription with the crash reason and raises no unhandled rejection', async () => {
    const p = parakeetTranscribe(riff(fmt(1, 16), chunk('data', pcm16(new Array(1600).fill(100)))))
    fw.emit('error', new Error('native addon crashed'))
    await expect(p).rejects.toThrow('native addon crashed')
    expect(fw.terminateCalls).toBe(1)
    await new Promise((r) => setTimeout(r, 20))
    expect(unhandled).toEqual([])
  })
})
