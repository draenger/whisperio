// Short WebAudio confirmation tones for the headset-button flow (no asset files).
export type CueKind = 'start' | 'sent' | 'error' | 'held'

export interface Tone {
  freq: number
  /** seconds from cue start */
  at: number
  dur: number
  type: OscillatorType
  gain: number
}

export function cueTones(kind: CueKind): Tone[] {
  switch (kind) {
    case 'start': // rising two-tone
      return [
        { freq: 660, at: 0, dur: 0.09, type: 'sine', gain: 0.25 },
        { freq: 988, at: 0.11, dur: 0.12, type: 'sine', gain: 0.25 }
      ]
    case 'sent': // short double beep, high
      return [
        { freq: 1568, at: 0, dur: 0.06, type: 'sine', gain: 0.22 },
        { freq: 1568, at: 0.1, dur: 0.06, type: 'sine', gain: 0.22 }
      ]
    case 'error': // low buzz
      return [{ freq: 130, at: 0, dur: 0.4, type: 'sawtooth', gain: 0.22 }]
    case 'held': // single mid beep
      return [{ freq: 784, at: 0, dur: 0.1, type: 'sine', gain: 0.22 }]
  }
}

let ctx: AudioContext | null = null

export function playCueSound(kind: CueKind): void {
  try {
    const Ctor = window.AudioContext
    if (!Ctor) return
    ctx = ctx ?? new Ctor()
    const c = ctx
    if (c.state === 'suspended') void c.resume()
    const t0 = c.currentTime + 0.02
    for (const tone of cueTones(kind)) {
      const osc = c.createOscillator()
      const g = c.createGain()
      osc.type = tone.type
      osc.frequency.value = tone.freq
      const start = t0 + tone.at
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(tone.gain, start + 0.01)
      g.gain.setValueAtTime(tone.gain, start + tone.dur - 0.02)
      g.gain.linearRampToValueAtTime(0, start + tone.dur)
      osc.connect(g).connect(c.destination)
      osc.start(start)
      osc.stop(start + tone.dur + 0.02)
    }
  } catch (err) {
    console.warn('[Whisperio] cue playback failed:', err)
  }
}
