import { describe, it, expect } from 'vitest'
import { analyzeSpeech, mixToMono } from '../src/renderer/audio/silenceGate'

const SR = 16000
const amp = (dbfs: number): number => Math.pow(10, dbfs / 20)

function tone(ms: number, dbfs: number, freq = 440): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const out = new Float32Array(n)
  // sine RMS = A/sqrt2, so scale A to land on the requested RMS dBFS
  const a = amp(dbfs) * Math.SQRT2
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * freq * i) / SR)
  return out
}

function noise(ms: number, dbfs: number): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const out = new Float32Array(n)
  let seed = 12345
  const a = amp(dbfs) * Math.sqrt(3) // uniform [-a,a] has RMS a/sqrt3
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    out[i] = a * ((seed / 0xffffffff) * 2 - 1)
  }
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

describe('analyzeSpeech', () => {
  it('rejects pure digital silence', () => {
    const r = analyzeSpeech(new Float32Array(SR * 2), SR)
    expect(r.hasSpeech).toBe(false)
    expect(r.voicedMs).toBe(0)
    expect(r.peakDbfs).toBe(-Infinity)
  })

  it('rejects low-level white noise', () => {
    const r = analyzeSpeech(noise(2000, -60), SR)
    expect(r.hasSpeech).toBe(false)
    expect(r.peakDbfs).toBeLessThan(-55)
  })

  it('accepts a 300 ms tone burst at -20 dBFS', () => {
    const r = analyzeSpeech(concat(new Float32Array(SR), tone(300, -20), new Float32Array(SR)), SR)
    expect(r.hasSpeech).toBe(true)
    expect(r.voicedMs).toBeGreaterThanOrEqual(200)
    expect(r.peakDbfs).toBeGreaterThan(-22)
    expect(r.peakDbfs).toBeLessThan(-18)
  })

  it('rejects a short click below minVoicedMs', () => {
    const r = analyzeSpeech(concat(new Float32Array(SR), tone(50, -10), new Float32Array(SR)), SR)
    expect(r.hasSpeech).toBe(false)
    expect(r.voicedMs).toBeGreaterThan(0)
  })

  it('finds speech above a noisy floor', () => {
    const r = analyzeSpeech(concat(noise(1000, -40), tone(400, -25), noise(1000, -40)), SR)
    expect(r.hasSpeech).toBe(true)
  })

  it('finds speech over a constant -35 dBFS noise floor', () => {
    const bg = noise(2000, -35)
    const speech = tone(500, -20)
    for (let i = 0; i < speech.length; i++) bg[8000 + i] += speech[i]
    expect(analyzeSpeech(bg, SR).hasSpeech).toBe(true)
  })

  it('accepts a clip that is 100% speech with no leading/trailing silence', () => {
    const r = analyzeSpeech(tone(1000, -20), SR)
    expect(r.hasSpeech).toBe(true)
    expect(r.voicedMs).toBeGreaterThanOrEqual(950)
  })

  it('handles empty, too-short and invalid input', () => {
    expect(analyzeSpeech(new Float32Array(0), SR).hasSpeech).toBe(false)
    expect(analyzeSpeech(new Float32Array(10), SR).hasSpeech).toBe(false)
    expect(analyzeSpeech(tone(500, -20), 0).hasSpeech).toBe(false)
  })

  it('treats NaN samples as silence without throwing', () => {
    const r = analyzeSpeech(new Float32Array(SR).fill(NaN), SR)
    expect(r.hasSpeech).toBe(false)
    expect(Number.isNaN(r.peakDbfs)).toBe(false)
  })

  it('honours custom options', () => {
    const buf = concat(new Float32Array(SR), tone(100, -20), new Float32Array(SR))
    expect(analyzeSpeech(buf, SR).hasSpeech).toBe(false)
    expect(analyzeSpeech(buf, SR, { minVoicedMs: 50 }).hasSpeech).toBe(true)
  })
})

describe('mixToMono', () => {
  it('averages channels', () => {
    const m = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])])
    expect(Array.from(m)).toEqual([0.5, 0.5])
    expect(mixToMono([]).length).toBe(0)
  })
})
