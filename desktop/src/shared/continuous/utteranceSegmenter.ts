/**
 * Streaming energy-VAD utterance segmenter for continuous (hands-free) dictation.
 * Pure (no DOM / Electron). Feed mono chunks of any length; completed utterances
 * come back from push()/flush().
 */
import { frameEnergiesDbfs, clampThresholdDbfs, DEFAULT_THRESHOLD_DBFS } from '../../renderer/audio/silenceGate'

export interface SegmenterOptions {
  sampleRate: number
  thresholdDbfs?: number
  silenceMs?: number
  minUtteranceMs?: number
  maxUtteranceMs?: number
  preRollMs?: number
  frameMs?: number
}

export interface Utterance {
  samples: Float32Array
  durationMs: number
  voicedMs: number
}

export const DEFAULT_SILENCE_MS = 1200
export const DEFAULT_MIN_UTTERANCE_MS = 500
const DEFAULT_MAX_UTTERANCE_MS = 60000
const DEFAULT_PREROLL_MS = 300
const DEFAULT_FRAME_MS = 25
const TRAILING_SILENCE_KEEP_MS = 200

export class UtteranceSegmenter {
  private readonly frameLen: number
  private readonly frameMs: number
  private readonly sampleRate: number
  private readonly threshold: number
  private readonly silenceFrames: number
  private readonly keepFrames: number
  private readonly maxFrames: number
  private readonly preRollFrames: number
  private readonly minUtteranceMs: number

  private carry: Float32Array = new Float32Array(0)
  private preRoll: Float32Array[] = []
  private frames: Float32Array[] = []
  private voicedFrames = 0
  private silentRun = 0
  private speaking = false

  constructor(opts: SegmenterOptions) {
    if (!(opts.sampleRate > 0)) throw new Error('sampleRate must be > 0')
    const frameMs = opts.frameMs && opts.frameMs > 0 ? opts.frameMs : DEFAULT_FRAME_MS
    this.sampleRate = opts.sampleRate
    this.frameMs = frameMs
    this.frameLen = Math.max(1, Math.round((opts.sampleRate * frameMs) / 1000))
    this.threshold = opts.thresholdDbfs === undefined ? DEFAULT_THRESHOLD_DBFS : clampThresholdDbfs(opts.thresholdDbfs)
    const silenceMs = opts.silenceMs ?? DEFAULT_SILENCE_MS
    this.silenceFrames = Math.max(1, Math.ceil(silenceMs / frameMs))
    this.keepFrames = Math.ceil(TRAILING_SILENCE_KEEP_MS / frameMs)
    this.maxFrames = Math.max(1, Math.ceil((opts.maxUtteranceMs ?? DEFAULT_MAX_UTTERANCE_MS) / frameMs))
    this.preRollFrames = Math.max(0, Math.ceil((opts.preRollMs ?? DEFAULT_PREROLL_MS) / frameMs))
    this.minUtteranceMs = opts.minUtteranceMs ?? DEFAULT_MIN_UTTERANCE_MS
  }

  get inSpeech(): boolean {
    return this.speaking
  }

  push(chunk: Float32Array): Utterance[] {
    const out: Utterance[] = []
    if (!chunk || chunk.length === 0) return out
    let data = chunk
    if (this.carry.length > 0) {
      data = new Float32Array(this.carry.length + chunk.length)
      data.set(this.carry, 0)
      data.set(chunk, this.carry.length)
    }
    const whole = Math.floor(data.length / this.frameLen)
    for (let f = 0; f < whole; f++) {
      const frame = data.slice(f * this.frameLen, (f + 1) * this.frameLen)
      const u = this.processFrame(frame)
      if (u) out.push(u)
    }
    this.carry = data.slice(whole * this.frameLen)
    return out
  }

  flush(): Utterance[] {
    const out: Utterance[] = []
    if (this.speaking) {
      const u = this.finish(true)
      if (u) out.push(u)
    }
    this.reset()
    return out
  }

  reset(): void {
    this.carry = new Float32Array(0)
    this.preRoll = []
    this.frames = []
    this.voicedFrames = 0
    this.silentRun = 0
    this.speaking = false
  }

  private processFrame(frame: Float32Array): Utterance | null {
    const voiced = frameEnergiesDbfs(frame, this.frameLen)[0] >= this.threshold
    if (!this.speaking) {
      if (!voiced) {
        this.preRoll.push(frame)
        if (this.preRoll.length > this.preRollFrames) this.preRoll.shift()
        return null
      }
      this.speaking = true
      this.frames = [...this.preRoll, frame]
      this.preRoll = []
      this.voicedFrames = 1
      this.silentRun = 0
    } else {
      this.frames.push(frame)
      if (voiced) {
        this.voicedFrames++
        this.silentRun = 0
      } else {
        this.silentRun++
      }
    }
    if (this.silentRun >= this.silenceFrames) return this.finish(true)
    if (this.frames.length >= this.maxFrames) return this.finish(false)
    return null
  }

  /** Close the current utterance; returns null when it had too little voiced time. */
  private finish(trim: boolean): Utterance | null {
    let frames = this.frames
    if (trim && this.silentRun > this.keepFrames) {
      frames = frames.slice(0, frames.length - (this.silentRun - this.keepFrames))
    }
    const voicedMs = this.voicedFrames * this.frameMs
    this.frames = []
    this.voicedFrames = 0
    this.silentRun = 0
    this.speaking = false
    if (voicedMs < this.minUtteranceMs) return null
    const samples = new Float32Array(frames.length * this.frameLen)
    frames.forEach((fr, i) => samples.set(fr, i * this.frameLen))
    return { samples, durationMs: (samples.length * 1000) / this.sampleRate, voicedMs }
  }
}
