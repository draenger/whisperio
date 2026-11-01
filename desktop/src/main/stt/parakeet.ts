// EXPERIMENTAL (spike, behind settings.experimentalParakeet): local STT with
// NVIDIA Parakeet TDT 0.6B V3 through sherpa-onnx-node.
//
// - `sherpa-onnx-node` is NOT a declared dependency yet. It is loaded lazily
//   with a guarded require; when absent we throw ParakeetRuntimeMissingError so
//   the provider chain falls through (offline invariant: never break dictation).
// - Recognition runs in a worker_thread (spike; the spec's target is an Electron
//   utilityProcess) so a 640 MB model load cannot freeze the main process. The
//   worker body is the pure function `recognizeWith`, serialized via toString().
import { app } from 'electron'
import { createRequire } from 'module'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getParakeetModelPaths } from './parakeetModel'

export const TARGET_SAMPLE_RATE = 16000
export const SHERPA_PACKAGE = 'sherpa-onnx-node'
const IDLE_TTL_MS = 15 * 60 * 1000

export class ParakeetRuntimeMissingError extends Error {
  constructor(detail?: string) {
    super(
      'Experimental Parakeet runtime is not installed (missing "sherpa-onnx-node"). ' +
        'This build cannot run on-device Parakeet yet.' +
        (detail ? ` (${detail})` : '')
    )
    this.name = 'ParakeetRuntimeMissingError'
  }
}

export interface RecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number }
  modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string }
    tokens: string
    numThreads: number
    provider: string
    debug: number
    modelType: string
  }
}

export function buildRecognizerConfig(paths: {
  encoder: string
  decoder: string
  joiner: string
  tokens: string
}): RecognizerConfig {
  return {
    featConfig: { sampleRate: TARGET_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: paths.encoder, decoder: paths.decoder, joiner: paths.joiner },
      tokens: paths.tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer'
    }
  }
}

/** Guarded lazy load. Returns the resolved module path (for the worker) and the module. */
export function loadSherpa(): { path: string; module: unknown } {
  try {
    const req = createRequire(join(app.getAppPath(), 'package.json'))
    const path = req.resolve(SHERPA_PACKAGE)
    return { path, module: req(SHERPA_PACKAGE) }
  } catch (err) {
    throw new ParakeetRuntimeMissingError(err instanceof Error ? err.message : undefined)
  }
}

export function isParakeetRuntimeInstalled(): boolean {
  try {
    const req = createRequire(join(app.getAppPath(), 'package.json'))
    req.resolve(SHERPA_PACKAGE)
    return true
  } catch {
    return false
  }
}

/**
 * Decode a RIFF/WAVE buffer (PCM16 or float32) to mono Float32 at 16 kHz
 * (channel average + linear resample). Throws on anything else (e.g. webm).
 */
export function wavToPcm16k(buf: Buffer): Float32Array {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Parakeet needs WAV audio (16-bit PCM); got a non-WAV buffer.')
  }
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null
  let data: Buffer | null = null
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      }
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length))
      break
    }
    off = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('Malformed WAV: missing fmt or data chunk.')
  const isPcm16 = fmt.format === 1 && fmt.bits === 16
  const isFloat32 = fmt.format === 3 && fmt.bits === 32
  if (!isPcm16 && !isFloat32) throw new Error(`Unsupported WAV format (format=${fmt.format}, bits=${fmt.bits}).`)
  const ch = Math.max(1, fmt.channels)
  const bytes = isPcm16 ? 2 : 4
  const frames = Math.floor(data.length / (bytes * ch))
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < ch; c++) {
      const p = (i * ch + c) * bytes
      sum += isPcm16 ? data.readInt16LE(p) / 32768 : data.readFloatLE(p)
    }
    mono[i] = sum / ch
  }
  if (fmt.rate === TARGET_SAMPLE_RATE || frames === 0) return mono
  const outLen = Math.max(1, Math.floor((frames * TARGET_SAMPLE_RATE) / fmt.rate))
  const out = new Float32Array(outLen)
  const ratio = fmt.rate / TARGET_SAMPLE_RATE
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, frames - 1)
    const frac = pos - i0
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac
  }
  return out
}

/**
 * Pure recognition step (self-contained: it is serialized into the worker).
 * `sherpa` is the sherpa-onnx-node module.
 */
export function recognizeWith(
  sherpa: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  recognizer: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  samples: Float32Array,
  sampleRate: number
): string {
  void sherpa
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate, samples })
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  return String(result?.text ?? '').trim()
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads')
const recognizeWith = ${recognizeWith.toString()}
let sherpa, recognizer
try {
  sherpa = require(workerData.sherpaPath)
  recognizer = new sherpa.OfflineRecognizer(workerData.config)
  parentPort.postMessage({ type: 'ready' })
} catch (e) {
  parentPort.postMessage({ type: 'fatal', error: String(e && e.message || e) })
}
parentPort.on('message', (m) => {
  try {
    const text = recognizeWith(sherpa, recognizer, m.samples, m.sampleRate)
    parentPort.postMessage({ type: 'result', id: m.id, text })
  } catch (e) {
    parentPort.postMessage({ type: 'result', id: m.id, error: String(e && e.message || e) })
  }
})
`


export const READY_TIMEOUT_MS = 120_000
export const MIN_REQUEST_TIMEOUT_MS = 30_000

type Pending = {
  resolve: (t: string) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

interface Host {
  worker: Worker
  ready: Promise<void>
}

// Seams so the lifecycle can be unit-tested without the native addon.
export const deps = {
  loadSherpa: (): { path: string } => loadSherpa(),
  getModelPaths: getParakeetModelPaths,
  createWorker: (source: string, workerData: unknown): Worker =>
    new Worker(source, { eval: true, workerData }),
  readyTimeoutMs: READY_TIMEOUT_MS,
  minRequestTimeoutMs: MIN_REQUEST_TIMEOUT_MS
}

let host: Host | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function rejectAll(err: Error): void {
  for (const p of pending.values()) {
    if (p.timer) clearTimeout(p.timer)
    p.reject(err)
  }
  pending.clear()
}

/** Terminate the worker, reject every in-flight request, resolve once it is gone. */
export async function stopWorker(reason = 'Parakeet worker stopped.'): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const h = host
  host = null
  rejectAll(new Error(reason))
  if (h) {
    try {
      await h.worker.terminate()
    } catch {
      /* already gone */
    }
  }
}

function ensureHost(): Host {
  if (host) return host
  const { path } = deps.loadSherpa()
  const config = buildRecognizerConfig(deps.getModelPaths())
  const w = deps.createWorker(WORKER_SOURCE, { sherpaPath: path, config })
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let settled = false
  let resolveReady!: () => void
  let rejectReady!: (e: Error) => void
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res
    rejectReady = rej
  })
  ready.catch(() => {}) // avoid unhandled rejection when nobody awaits
  const h: Host = { worker: w, ready }
  const failAll = (err: Error): void => {
    if (!settled) {
      settled = true
      if (readyTimer) clearTimeout(readyTimer)
      rejectReady(err)
    }
    rejectAll(err)
    if (host === h) {
      host = null
      void Promise.resolve(w.terminate()).catch(() => {})
    }
  }
  readyTimer = setTimeout(
    () => failAll(new Error('Parakeet worker did not become ready in time.')),
    deps.readyTimeoutMs
  )
  readyTimer.unref?.()
  w.on('message', (m: { type: string; id?: number; text?: string; error?: string }) => {
    if (m.type === 'ready') {
      if (!settled) {
        settled = true
        if (readyTimer) clearTimeout(readyTimer)
        resolveReady()
      }
    } else if (m.type === 'fatal') {
      failAll(new Error(`Parakeet failed to start: ${m.error}`))
    } else if (m.type === 'result' && m.id !== undefined) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (p) {
        if (p.timer) clearTimeout(p.timer)
        if (m.error) p.reject(new Error(m.error))
        else p.resolve(m.text ?? '')
      }
    }
  })
  w.on('error', (err: Error) => failAll(err))
  w.on('exit', (code: number) => failAll(new Error(`Parakeet worker exited unexpectedly (code ${code}).`)))
  host = h
  return h
}

/** Transcribe a WAV clip on-device. Rejects (never hangs) on any runtime/model error. */
export async function parakeetTranscribe(audio: Buffer): Promise<string> {
  const samples = wavToPcm16k(audio)
  if (samples.length === 0) return ''
  const h = ensureHost()
  await h.ready
  if (host !== h) throw new Error('Parakeet worker stopped.')
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void stopWorker('Parakeet worker idle.'), IDLE_TTL_MS)
  idleTimer.unref?.()
  const id = nextId++
  const durationMs = (samples.length / TARGET_SAMPLE_RATE) * 1000
  const timeoutMs = Math.max(deps.minRequestTimeoutMs, 3 * durationMs)
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      void stopWorker(`Parakeet transcription timed out after ${Math.round(timeoutMs / 1000)}s.`)
    }, timeoutMs)
    timer.unref?.()
    pending.set(id, { resolve, reject, timer })
    h.worker.postMessage({ id, samples, sampleRate: TARGET_SAMPLE_RATE })
  })
}

export function shutdownParakeet(): Promise<void> {
  return stopWorker()
}
