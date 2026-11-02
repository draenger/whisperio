import { describe, it, expect } from 'vitest'
import { findSpeechBounds, encodeWavMono16, trimToWav } from '../src/renderer/audio/silenceTrim'

const SR = 16000
const sil = (sec: number): Float32Array => new Float32Array(Math.round(sec * SR))
const tone = (sec: number): Float32Array => {
  const a = new Float32Array(Math.round(sec * SR))
  for (let i = 0; i < a.length; i++) a[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR)
  return a
}
const cat = (...p: Float32Array[]): Float32Array => {
  const out = new Float32Array(p.reduce((n, x) => n + x.length, 0))
  let o = 0
  for (const x of p) { out.set(x, o); o += x.length }
  return out
}

describe('findSpeechBounds', () => {
  it('trims 2 s lead/trail silence keeping 300 ms pads', () => {
    const b = findSpeechBounds(cat(sil(2), tone(1), sil(2)), SR)!
    expect(b.startSample).toBe(Math.round(1.7 * SR))
    expect(b.endSample).toBe(Math.round(3.3 * SR))
  })
  it('does not trim short silences (< 500 ms removable)', () => {
    const x = cat(sil(0.7), tone(1), sil(0.7))
    expect(findSpeechBounds(x, SR)).toEqual({ startSample: 0, endSample: x.length })
  })
  it('trims one side only when the other is short', () => {
    const x = cat(sil(2), tone(1), sil(0.5))
    const b = findSpeechBounds(x, SR)!
    expect(b.startSample).toBe(Math.round(1.7 * SR))
    expect(b.endSample).toBe(x.length)
  })
  it('returns null for all silence, empty, or too-short blips', () => {
    expect(findSpeechBounds(sil(3), SR)).toBeNull()
    expect(findSpeechBounds(new Float32Array(0), SR)).toBeNull()
    expect(findSpeechBounds(cat(sil(2), tone(0.05), sil(2)), SR)).toBeNull()
  })
  it('speech at very start/end clamps to the buffer', () => {
    const x = cat(tone(0.5), sil(3), tone(0.5))
    expect(findSpeechBounds(x, SR)).toEqual({ startSample: 0, endSample: x.length })
    const y = cat(tone(1), sil(2))
    const b = findSpeechBounds(y, SR)!
    expect(b.startSample).toBe(0)
    expect(b.endSample).toBe(Math.round(1.3 * SR))
  })
  it('never trims the middle', () => {
    const x = cat(sil(2), tone(0.5), sil(3), tone(0.5), sil(2))
    const b = findSpeechBounds(x, SR)!
    expect(b.endSample - b.startSample).toBe(Math.round((0.3 + 0.5 + 3 + 0.5 + 0.3) * SR))
  })
})

describe('encodeWavMono16', () => {
  it('writes a valid 16 kHz mono header and length', () => {
    const pcm = tone(0.1)
    const buf = encodeWavMono16(pcm, SR)
    const v = new DataView(buf)
    const str = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    expect(buf.byteLength).toBe(44 + pcm.length * 2)
    expect(str(0)).toBe('RIFF')
    expect(str(8)).toBe('WAVE')
    expect(str(36)).toBe('data')
    expect(v.getUint32(4, true)).toBe(36 + pcm.length * 2)
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(SR)
    expect(v.getUint32(28, true)).toBe(SR * 2)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(pcm.length * 2)
  })
  it('clamps and zeroes non-finite samples', () => {
    const v = new DataView(encodeWavMono16(Float32Array.from([2, -2, NaN]), SR))
    expect(v.getInt16(44, true)).toBe(0x7fff)
    expect(v.getInt16(46, true)).toBe(-0x8000)
    expect(v.getInt16(48, true)).toBe(0)
  })
})

describe('trimToWav', () => {
  it('returns WAV of the kept range when >= 1 s removed', () => {
    const w = trimToWav(cat(sil(2), tone(1), sil(2)), SR)!
    expect(w.byteLength).toBe(44 + Math.round(1.6 * SR) * 2)
  })
  it('returns null when less than 1 s removed or no speech', () => {
    expect(trimToWav(cat(sil(1), tone(1), sil(0.2)), SR)).toBeNull() // removes 0.7 s
    expect(trimToWav(sil(3), SR)).toBeNull()
  })
})

describe('silenceTrim gap coverage', () => {
  it('findSpeechBounds rejects null samples and non-positive / NaN sample rates', () => {
    expect(findSpeechBounds(null as unknown as Float32Array, SR)).toBeNull()
    expect(findSpeechBounds(tone(1), 0)).toBeNull()
    expect(findSpeechBounds(tone(1), NaN)).toBeNull()
  })

  it('padMs option controls the kept margin', () => {
    const b = findSpeechBounds(cat(sil(2), tone(1), sil(2)), SR, { padMs: 100 })!
    expect(b.startSample).toBe(Math.round(1.9 * SR))
    expect(b.endSample).toBe(Math.round(3.1 * SR))
  })

  it('minTrimMs option: a 0.7 s lead is trimmed when minTrimMs is lowered', () => {
    const x = cat(sil(0.7), tone(1), sil(0.7))
    const b = findSpeechBounds(x, SR, { minTrimMs: 100 })!
    expect(b.startSample).toBe(Math.round(0.4 * SR))
    expect(b.endSample).toBe(Math.round(2.0 * SR))
  })

  it('thresholdDbfs option: quiet speech is found only with a lower threshold', () => {
    const quiet = new Float32Array(SR)
    for (let i = 0; i < quiet.length; i++) quiet[i] = 0.002 * Math.sin((2 * Math.PI * 440 * i) / SR) // about -57 dBFS
    const x = cat(sil(2), quiet, sil(2))
    expect(findSpeechBounds(x, SR)).toBeNull()
    expect(findSpeechBounds(x, SR, { thresholdDbfs: -65 })).not.toBeNull()
  })

  it('minVoicedMs option: a 100 ms burst counts as speech when allowed', () => {
    const x = cat(sil(2), tone(0.1), sil(2))
    expect(findSpeechBounds(x, SR)).toBeNull()
    const b = findSpeechBounds(x, SR, { minVoicedMs: 50 })!
    expect(b.startSample).toBeLessThan(Math.round(2 * SR))
    expect(b.endSample).toBeGreaterThan(Math.round(2.1 * SR))
  })

  it('bounds always cover all voiced samples (invariant over several layouts)', () => {
    for (const [lead, speech, trail] of [[1, 0.3, 1], [3, 2, 0.1], [0.6, 0.25, 4]]) {
      const x = cat(sil(lead), tone(speech), sil(trail))
      const b = findSpeechBounds(x, SR)!
      expect(b.startSample).toBeLessThanOrEqual(Math.round(lead * SR))
      expect(b.endSample).toBeGreaterThanOrEqual(Math.round((lead + speech) * SR))
      expect(b.startSample).toBeGreaterThanOrEqual(0)
      expect(b.endSample).toBeLessThanOrEqual(x.length)
    }
  })

  it('encodeWavMono16 maps full-scale and mid values to exact int16 and handles empty input', () => {
    const v = new DataView(encodeWavMono16(Float32Array.from([1, -1, 0.5, -0.5, 0]), SR))
    expect(v.getInt16(44, true)).toBe(0x7fff)
    expect(v.getInt16(46, true)).toBe(-0x8000)
    expect(v.getInt16(48, true)).toBe(Math.trunc(0.5 * 0x7fff))
    expect(v.getInt16(50, true)).toBe(-0x4000)
    expect(v.getInt16(52, true)).toBe(0)
    const empty = encodeWavMono16(new Float32Array(0), SR)
    expect(empty.byteLength).toBe(44)
    expect(new DataView(empty).getUint32(40, true)).toBe(0)
  })

  it('encodeWavMono16 writes the sample rate it is given (e.g. 48 kHz)', () => {
    const v = new DataView(encodeWavMono16(new Float32Array(4), 48000))
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint32(28, true)).toBe(96000)
  })

  it('trimToWav minTotalRemovedMs option: lower threshold allows small trims, higher blocks big ones', () => {
    const small = cat(sil(1), tone(1), sil(0.2)) // removes ~0.7 s
    expect(trimToWav(small, SR)).toBeNull()
    expect(trimToWav(small, SR, { minTotalRemovedMs: 500 })).not.toBeNull()
    const big = cat(sil(2), tone(1), sil(2)) // removes 3.4 s
    expect(trimToWav(big, SR, { minTotalRemovedMs: 4000 })).toBeNull()
  })

  it('trimToWav output carries exactly the kept PCM (first kept sample is the pad silence, speech follows)', () => {
    const x = cat(sil(2), tone(1), sil(2))
    const v = new DataView(trimToWav(x, SR)!)
    expect(v.getInt16(44, true)).toBe(0) // 300 ms pad is silence
    // speech starts after the 0.3 s pad: some sample past it is non-zero
    let nonZero = 0
    for (let i = Math.round(0.3 * SR); i < Math.round(0.3 * SR) + 200; i++) if (v.getInt16(44 + i * 2, true) !== 0) nonZero++
    expect(nonZero).toBeGreaterThan(100)
  })
})
