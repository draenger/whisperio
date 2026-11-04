import { vi, describe, it, expect } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ud', getAppPath: () => '/tmp/app' },
  net: { request: vi.fn() }
}))

import {
  wavToPcm16k,
  buildRecognizerConfig,
  resolveSherpa,
  toUnpackedPath,
  isParakeetRuntimeInstalled,
  parakeetAllowed,
  parakeetTranscribe,
  ParakeetRuntimeMissingError,
  ParakeetClipTooLongError,
  ParakeetLanguageUnsupportedError,
  PARAKEET_MAX_AUDIO_SECONDS
} from '../src/main/stt/parakeet'
import { recognizeWith, runHost } from '../src/main/stt/parakeetHost'
import { readFileSync } from 'fs'
import { join } from 'path'

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
  it('resolveSherpa throws a clear experimental-runtime error', () => {
    expect(() => resolveSherpa()).toThrow(ParakeetRuntimeMissingError)
    expect(() => resolveSherpa()).toThrow(/runtime is not installed/)
    expect(isParakeetRuntimeInstalled()).toBe(false)
  })
  it('a stale experimentalParakeet=true counts as OFF when the addon is not packaged (release build)', () => {
    expect(parakeetAllowed({ experimentalParakeet: true })).toBe(false)
    expect(parakeetAllowed({ experimentalParakeet: false })).toBe(false)
  })
  it('parakeetTranscribe rejects (does not hang) on a valid clip', async () => {
    await expect(parakeetTranscribe(makeWav([1, 2, 3, 4]))).rejects.toThrow(/not installed|incomplete/)
  })
})

describe('Parakeet input guards', () => {
  it('exports a five-minute limit and accepts 299 seconds supplied by the caller', async () => {
    expect(PARAKEET_MAX_AUDIO_SECONDS).toBe(300)
    await expect(parakeetTranscribe(makeWav([1]), { durationSeconds: 299 })).rejects.toThrow(ParakeetRuntimeMissingError)
  })

  it('rejects 301 seconds before loading the runtime', async () => {
    await expect(parakeetTranscribe(makeWav([1]), { durationSeconds: 301 })).rejects.toThrow(ParakeetClipTooLongError)
    await expect(parakeetTranscribe(makeWav([1]), { durationSeconds: 301 })).rejects.toThrow(
      'Clip too long for the local model (max 5 min)'
    )
  })

  it('rejects an unsupported language and accepts auto and pl', async () => {
    await expect(parakeetTranscribe(makeWav([1]), { language: 'ja' })).rejects.toThrow(ParakeetLanguageUnsupportedError)
    await expect(parakeetTranscribe(makeWav([1]), { language: 'auto' })).rejects.toThrow(ParakeetRuntimeMissingError)
    await expect(parakeetTranscribe(makeWav([1]), { language: 'pl' })).rejects.toThrow(ParakeetRuntimeMissingError)
  })
})

describe('asar unpacked path', () => {
  it('rewrites app.asar to app.asar.unpacked (posix and windows) and leaves other paths alone', () => {
    expect(toUnpackedPath('/r/app.asar/node_modules/s/i.js')).toBe('/r/app.asar.unpacked/node_modules/s/i.js')
    expect(toUnpackedPath('C:\\r\\app.asar\\node_modules\\s\\i.js')).toBe('C:\\r\\app.asar.unpacked\\node_modules\\s\\i.js')
    expect(toUnpackedPath('/r/app.asar.unpacked/n/i.js')).toBe('/r/app.asar.unpacked/n/i.js')
    expect(toUnpackedPath('/dev/node_modules/s/i.js')).toBe('/dev/node_modules/s/i.js')
  })
})

describe('parakeetHost protocol', () => {
  function port() {
    let cb!: (e: { data: unknown }) => void
    const sent: any[] = []
    return {
      sent,
      send: (data: unknown) => cb({ data }),
      p: { on: (_: 'message', f: typeof cb) => (cb = f), postMessage: (m: unknown) => sent.push(m) }
    }
  }
  const rec = { createStream: () => ({ acceptWaveform() {} }), decode() {}, getResult: () => ({ text: ' hi ' }) }
  it('init loads the addon from sherpaPath, replies ready, then answers requests', () => {
    const { p, send, sent } = port()
    const load = vi.fn(() => ({ OfflineRecognizer: function () { return rec } }))
    runHost(p, load as never)
    send({ type: 'init', sherpaPath: '/p', config: {} })
    expect(load).toHaveBeenCalledWith('/p')
    send({ id: 4, samples: new Float32Array(1), sampleRate: 16000 })
    expect(sent).toEqual([{ type: 'ready' }, { type: 'result', id: 4, text: 'hi' }])
  })
  it('replies fatal when loading fails and per-request errors otherwise', () => {
    const { p, send, sent } = port()
    runHost(p, () => { throw new Error('dll missing') })
    send({ type: 'init', sherpaPath: '/p', config: {} })
    send({ id: 1, samples: new Float32Array(1), sampleRate: 16000 })
    expect(sent[0]).toEqual({ type: 'fatal', error: 'dll missing' })
    expect(sent[1]).toMatchObject({ type: 'result', id: 1 })
    expect(sent[1].error).toMatch(/not initialised/)
  })
})

describe('build config', () => {
  it('electron.vite.config.ts emits the parakeetHost utilityProcess bundle', () => {
    const cfg = readFileSync(join(__dirname, '..', 'electron.vite.config.ts'), 'utf8')
    expect(cfg).toMatch(/parakeetHost:\s*resolve\(__dirname, 'src\/main\/stt\/parakeetHost\.ts'\)/)
  })
})
