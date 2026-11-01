/**
 * RMS energy silence gate. Pure (no DOM / Electron) so it is unit-testable.
 *
 * Purpose: skip uploading recordings that contain no speech — saves STT cost
 * and avoids hallucinated transcripts ("Thank you.") on silent audio.
 * This is deliberately simple energy detection, not a neural VAD.
 */

export interface SpeechAnalysis {
  hasSpeech: boolean
  /** Highest frame RMS in dBFS (-Infinity for empty / silent input). */
  peakDbfs: number
  /** Total duration of voiced frames, in ms. */
  voicedMs: number
}

export interface SilenceGateOptions {
  /** Frame length in ms (default 25). */
  frameMs?: number
  /** Absolute voiced threshold in dBFS (default -50). */
  thresholdDbfs?: number
  /** Minimum voiced duration to count as speech (default 200 ms). */
  minVoicedMs?: number
}

export const DEFAULT_THRESHOLD_DBFS = -50
export const MIN_THRESHOLD_DBFS = -70
export const MAX_THRESHOLD_DBFS = -30

const DEFAULTS = { frameMs: 25, thresholdDbfs: DEFAULT_THRESHOLD_DBFS, minVoicedMs: 200 }

/** Clamp a user-supplied threshold into the supported range; junk -> default. */
export function clampThresholdDbfs(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLD_DBFS
  return Math.min(MAX_THRESHOLD_DBFS, Math.max(MIN_THRESHOLD_DBFS, n))
}

/**
 * The gate may only drop a clip when it is enabled AND the clip is safely on
 * disk: with no saved copy a misjudged drop would lose the audio forever.
 */
export function shouldApplySilenceGate(enabled: boolean | undefined, recordingSaved: boolean): boolean {
  return enabled === true && recordingSaved
}

function toDbfs(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

/** Per-frame RMS in dBFS (trailing partial frame ignored). Shared with silenceTrim. */
export function frameEnergiesDbfs(samples: Float32Array, frameLen: number): number[] {
  const frameCount = Math.floor(samples.length / frameLen)
  const energies: number[] = []
  for (let f = 0; f < frameCount; f++) {
    let sum = 0
    const start = f * frameLen
    for (let i = start; i < start + frameLen; i++) {
      const v = samples[i]
      // NaN / Infinity samples count as silence rather than poisoning the frame.
      if (Number.isFinite(v)) sum += v * v
    }
    energies.push(toDbfs(Math.sqrt(sum / frameLen)))
  }
  return energies
}

export function analyzeSpeech(
  samples: Float32Array,
  sampleRate: number,
  opts: SilenceGateOptions = {}
): SpeechAnalysis {
  const o = { ...DEFAULTS, ...opts }
  const none: SpeechAnalysis = { hasSpeech: false, peakDbfs: -Infinity, voicedMs: 0 }
  if (!samples || samples.length === 0 || !(sampleRate > 0)) return none

  const frameLen = Math.max(1, Math.round((sampleRate * o.frameMs) / 1000))
  const energies = frameEnergiesDbfs(samples, frameLen)
  if (energies.length === 0) return none

  // Absolute threshold only: a relative noise-floor requirement would reject
  // real speech over steady background noise and clips with no silence.
  const gate = o.thresholdDbfs

  let voiced = 0
  let peak = -Infinity
  for (const e of energies) {
    if (e > peak) peak = e
    if (e >= gate) voiced++
  }
  const voicedMs = (voiced * frameLen * 1000) / sampleRate
  return { hasSpeech: voicedMs >= o.minVoicedMs, peakDbfs: peak, voicedMs }
}

/** Mix an AudioBuffer-like set of channels down to mono. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length
  return out
}
