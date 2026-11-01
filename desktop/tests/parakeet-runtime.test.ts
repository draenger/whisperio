import { vi, describe, it, expect } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ud', getAppPath: () => '/tmp/app' },
  net: { request: vi.fn() }
}))

import {
  wavToPcm16k,
  buildRecognizerConfig,
  recognizeWith,
  loadSherpa,
  isParakeetRuntimeInstalled,
  parakeetTranscribe,
  ParakeetRuntimeMissingError
} from '../src/main/stt/parakeet'

function makeWav(samples: number[], rate = 16000, channels = 1): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2))
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * channels * 2, 28)
  h.writeUInt16LE(channels * 2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

describe('wavToPcm16k', () => {
  it('converts PCM16 mono 16k to floats', () => {
    const out = wavToPcm16k(makeWav([0, 16384, -32768]))
    expect(Array.from(out)).toEqual([0, 0.5, -1])
  })
  it('downmixes stereo', () => {
    const out = wavToPcm16k(makeWav([32767, -32767, 16384, 16384], 16000, 2))
    expect(out).toHaveLength(2)
    expect(out[0]).toBeCloseTo(0, 3)
    expect(out[1]).toBeCloseTo(0.5, 3)
  })
  it('resamples 48k to 16k (length / 3)', () => {
    const out = wavToPcm16k(makeWav(new Array(4800).fill(1000), 48000))
    expect(out.length).toBe(1600)
  })
  it('rejects non-WAV (webm)', () => {
    expect(() => wavToPcm16k(Buffer.from('not a wav file at all, definitely not riff data......'))).toThrow(/WAV/)
  })
})

describe('recognizer', () => {
  it('builds the sherpa-onnx NeMo transducer config from model paths', () => {
    const cfg = buildRecognizerConfig({ encoder: '/m/e', decoder: '/m/d', joiner: '/m/j', tokens: '/m/t' })
    expect(cfg.modelConfig.transducer).toEqual({ encoder: '/m/e', decoder: '/m/d', joiner: '/m/j' })
    expect(cfg.modelConfig.tokens).toBe('/m/t')
    expect(cfg.modelConfig.modelType).toBe('nemo_transducer')
    expect(cfg.featConfig.sampleRate).toBe(16000)
  })

  it('recognizeWith drives stream, decode, getResult and trims', () => {
    const stream = { acceptWaveform: vi.fn() }
    const rec = {
      createStream: vi.fn(() => stream),
      decode: vi.fn(),
      getResult: vi.fn(() => ({ text: '  hello world ' }))
    }
    const samples = new Float32Array([0.1, 0.2])
    expect(recognizeWith({}, rec, samples, 16000)).toBe('hello world')
    expect(stream.acceptWaveform).toHaveBeenCalledWith({ sampleRate: 16000, samples })
    expect(rec.decode).toHaveBeenCalledWith(stream)
  })
})

describe('runtime missing (sherpa-onnx-node is not a dependency yet)', () => {
  it('loadSherpa throws a clear experimental-runtime error', () => {
    expect(() => loadSherpa()).toThrow(ParakeetRuntimeMissingError)
    expect(() => loadSherpa()).toThrow(/runtime is not installed/)
    expect(isParakeetRuntimeInstalled()).toBe(false)
  })
  it('parakeetTranscribe rejects (does not hang) on a valid clip', async () => {
    await expect(parakeetTranscribe(makeWav([1, 2, 3, 4]))).rejects.toThrow(/not installed|incomplete/)
  })
})
