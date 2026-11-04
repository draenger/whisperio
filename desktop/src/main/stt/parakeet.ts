// EXPERIMENTAL (spike, behind settings.experimentalParakeet): local STT with
// NVIDIA Parakeet TDT 0.6B V3 through sherpa-onnx-node.
//
// - `sherpa-onnx-node` is NOT a declared dependency yet. The main process only RESOLVES its path
//   (never require()s it); when absent we throw ParakeetRuntimeMissingError so the provider chain
//   falls through (offline invariant: never break dictation).
// - Loading the addon and recognition run in an Electron utilityProcess (parakeetHost.ts, a separate
//   OS process): a native crash there only ends that child and surfaces as an ordinary provider error.
import { app, utilityProcess } from 'electron'
import { createRequire } from 'module'
import { join } from 'path'
import { getParakeetModelPaths } from './parakeetModel'

export const TARGET_SAMPLE_RATE = 16000
export const PARAKEET_MAX_AUDIO_SECONDS = 300
export const SHERPA_PACKAGE = 'sherpa-onnx-node'
const IDLE_TTL_MS = 15 * 60 * 1000
const SUPPORTED_LANGUAGES = new Set('bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk'.split(' '))

export class ParakeetClipTooLongError extends Error {
  constructor() {
    super('Clip too long for the local model (max 5 min)')
    this.name = 'ParakeetClipTooLongError'
  }
}

export class ParakeetLanguageUnsupportedError extends Error {
  constructor(language: string) {
    super(`Language ${language} is not supported by the local model.`)
    this.name = 'ParakeetLanguageUnsupportedError'
  }
}

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

/** Resolve (never load) the addon path; throws ParakeetRuntimeMissingError when it is absent. */
export function resolveSherpa(): { path: string } {
  try {
    const req = createRequire(join(app.getAppPath(), 'package.json'))
    return { path: req.resolve(SHERPA_PACKAGE) }
  } catch (err) {
    throw new ParakeetRuntimeMissingError(err instanceof Error ? err.message : undefined)
  }
}

/** Packaged builds keep the native addon in app.asar.unpacked; a child process cannot read inside the asar. */
export function toUnpackedPath(p: string): string {
  return p.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked')
}

/**
 * The flag only counts when the native addon is actually packaged. Release builds exclude
 * sherpa-onnx (only the lab build ships it, see .devops/electron-builder.lab.cjs), so there a
 * stale experimentalParakeet=true acts as OFF and the UI hides the card.
 */
export function parakeetAllowed(settings: { experimentalParakeet?: boolean }): boolean {
  return settings.experimentalParakeet === true && isParakeetRuntimeInstalled()
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
 * Keep this JS decoder: sherpa's own `readWave` throws 'External buffers are not
 * allowed' inside Electron (V8 memory cage), verified on the Mac run of #47.
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

/** What the host logic needs from the child process (a utilityProcess in production, a fake in tests). */
export interface ParakeetChild {
  postMessage(m: unknown): void
  on(event: 'message', cb: (m: any) => void): unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  on(event: 'error', cb: (e: Error) => void): unknown
  on(event: 'exit', cb: (code: number | null) => void): unknown
  terminate(): Promise<unknown> | unknown
}

function createChild(): ParakeetChild {
  const proc = utilityProcess.fork(join(__dirname, 'parakeetHost.js'), [], {
    serviceName: 'whisperio-parakeet',
    stdio: 'pipe'
  })
  // Diagnostics only (addon/onnxruntime logs); transcripts never travel over stdio.
  proc.stdout?.on('data', (d: Buffer) => console.log('[parakeet]', String(d).trimEnd()))
  proc.stderr?.on('data', (d: Buffer) => console.error('[parakeet]', String(d).trimEnd()))
  let exited = false
  const gone = new Promise<void>((res) => {
    proc.once('exit', () => {
      exited = true
      res()
    })
  })
  return {
    postMessage: (m) => proc.postMessage(m),
    on: (event: string, cb: (...a: any[]) => void) => proc.on(event as 'exit', cb), // eslint-disable-line @typescript-eslint/no-explicit-any
    terminate: async () => {
      if (exited) return
      proc.kill()
      await Promise.race([gone, new Promise((res) => setTimeout(res, 2000).unref?.())])
    }
  }
}

export const READY_TIMEOUT_MS = 120_000
export const MIN_REQUEST_TIMEOUT_MS = 30_000

type Pending = {
  resolve: (t: string) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  /** The worker this request was posted to; only that worker's failure may reject it. */
  owner: Host
}

interface Host {
  worker: ParakeetChild
  ready: Promise<void>
}

// Seams so the lifecycle can be unit-tested without the native addon.
export const deps = {
  resolveSherpa: (): { path: string } => resolveSherpa(),
  getModelPaths: getParakeetModelPaths,
  createWorker: (): ParakeetChild => createChild(),
  readyTimeoutMs: READY_TIMEOUT_MS,
  minRequestTimeoutMs: MIN_REQUEST_TIMEOUT_MS
}

let host: Host | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function rejectAll(err: Error, owner?: Host): void {
  for (const [id, p] of pending) {
    if (owner && p.owner !== owner) continue
    if (p.timer) clearTimeout(p.timer)
    p.reject(err)
    pending.delete(id)
  }
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
  const { path } = deps.resolveSherpa()
  const config = buildRecognizerConfig(deps.getModelPaths())
  const w = deps.createWorker()
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
    rejectAll(err, h)
    if (host === h) {
      host = null
      void Promise.resolve(w.terminate()).catch(() => {})
    }
  }
  readyTimer = setTimeout(
    () => failAll(new Error('Parakeet process did not become ready in time.')),
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
  w.on('exit', (code: number | null) => failAll(new Error(`Parakeet process exited unexpectedly (code ${code}).`)))
  w.postMessage({ type: 'init', sherpaPath: toUnpackedPath(path), config })
  host = h
  return h
}

/** Clip length from the WAV header (data size / fmt byteRate) without decoding; null if not a WAV. */
function wavDurationSeconds(audio: Buffer): number | null {
  if (audio.length < 12 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return null
  let off = 12
  let byteRate = TARGET_SAMPLE_RATE * 2 // PCM16 mono 16 kHz unless the fmt chunk says otherwise
  while (off + 8 <= audio.length) {
    const size = audio.readUInt32LE(off + 4)
    const id = audio.toString('ascii', off, off + 4)
    if (id === 'fmt ' && off + 16 <= audio.length) byteRate = audio.readUInt32LE(off + 16) || byteRate
    if (id === 'data') return size / byteRate
    off += 8 + size + (size % 2)
  }
  return null
}

/** Transcribe a WAV clip on-device. Rejects (never hangs) on any runtime/model error. */
export async function parakeetTranscribe(
  audio: Buffer,
  options: { durationSeconds?: number; language?: string } = {}
): Promise<string> {
  const language = options.language?.trim().toLowerCase()
  if (language && language !== 'auto' && !SUPPORTED_LANGUAGES.has(language)) {
    throw new ParakeetLanguageUnsupportedError(language)
  }
  const durationSeconds = options.durationSeconds ?? wavDurationSeconds(audio)
  if (durationSeconds !== null && durationSeconds > PARAKEET_MAX_AUDIO_SECONDS) {
    throw new ParakeetClipTooLongError()
  }
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
    pending.set(id, { resolve, reject, timer, owner: h })
    h.worker.postMessage({ id, samples, sampleRate: TARGET_SAMPLE_RATE })
  })
}

export function shutdownParakeet(): Promise<void> {
  return stopWorker()
}
