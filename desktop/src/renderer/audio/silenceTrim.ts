/**
 * Trim long leading/trailing silence before upload. Pure (no DOM / Electron).
 * Uses the same frame energies and absolute threshold as the silence gate.
 * Only the ends are ever cut — never the middle.
 */
import { frameEnergiesDbfs, type SilenceGateOptions } from './silenceGate'

export interface TrimOptions extends SilenceGateOptions {
  /** Silence kept around the speech on each trimmed side (default 300 ms). */
  padMs?: number
  /** A side is trimmed only if at least this much would be removed (default 500 ms). */
  minTrimMs?: number
}

export interface SpeechBounds {
  startSample: number
  /** Exclusive. */
  endSample: number
}

const DEFAULTS = { frameMs: 25, thresholdDbfs: -45, minVoicedMs: 200, padMs: 300, minTrimMs: 500 }

/**
 * Returns the [start, end) range to keep, or null when there is no speech
 * (or the input is unusable). A side that would lose < minTrimMs is left as is.
 */
export function findSpeechBounds(
  samples: Float32Array,
  sampleRate: number,
  opts: TrimOptions = {}
): SpeechBounds | null {
  const o = { ...DEFAULTS, ...opts }
  if (!samples || samples.length === 0 || !(sampleRate > 0)) return null
  const frameLen = Math.max(1, Math.round((sampleRate * o.frameMs) / 1000))
  const energies = frameEnergiesDbfs(samples, frameLen)

  let first = -1
  let last = -1
  let voiced = 0
  for (let f = 0; f < energies.length; f++) {
    if (energies[f] >= o.thresholdDbfs) {
      if (first < 0) first = f
      last = f
      voiced++
    }
  }
  if (first < 0) return null
  if ((voiced * frameLen * 1000) / sampleRate < o.minVoicedMs) return null

  const msToSamples = (ms: number): number => Math.round((sampleRate * ms) / 1000)
  const pad = msToSamples(o.padMs)
  const minTrim = msToSamples(o.minTrimMs)

  let start = Math.max(0, first * frameLen - pad)
  let end = Math.min(samples.length, (last + 1) * frameLen + pad)
  if (start < minTrim) start = 0
  if (samples.length - end < minTrim) end = samples.length
  // Never keep less than the minimum voiced duration (cannot happen given the
  // voiced check above, but guards against option misuse).
  if (end - start < msToSamples(o.minVoicedMs)) return { startSample: 0, endSample: samples.length }
  return { startSample: start, endSample: end }
}

/** Encode mono float PCM as a 16-bit PCM WAV (44-byte header). */
export function encodeWavMono16(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = pcm.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) {
    const v = Number.isFinite(pcm[i]) ? Math.max(-1, Math.min(1, pcm[i])) : 0
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return buf
}

/**
 * Trim `samples` and WAV-encode the result — only when trimming removed at
 * least `minTotalRemovedMs` in total. Returns null when nothing worth trimming.
 */
export function trimToWav(
  samples: Float32Array,
  sampleRate: number,
  opts: TrimOptions & { minTotalRemovedMs?: number } = {}
): ArrayBuffer | null {
  const bounds = findSpeechBounds(samples, sampleRate, opts)
  if (!bounds) return null
  const removed = samples.length - (bounds.endSample - bounds.startSample)
  if ((removed * 1000) / sampleRate < (opts.minTotalRemovedMs ?? 1000)) return null
  return encodeWavMono16(samples.subarray(bounds.startSample, bounds.endSample), sampleRate)
}
