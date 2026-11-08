import { describe, it, expect } from 'vitest'
import { UtteranceSegmenter } from '../src/shared/continuous/utteranceSegmenter'

const SR = 16000

function sine(ms: number, dbfs = -20): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const amp = Math.sqrt(2) * Math.pow(10, dbfs / 20)
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 440 * i) / SR)
  return a
}
const silence = (ms: number) => new Float32Array(Math.round((SR * ms) / 1000))
function cat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
function run(seg: UtteranceSegmenter, sig: Float32Array, chunk = sig.length) {
  const out = []
  for (let i = 0; i < sig.length; i += chunk) out.push(...seg.push(sig.subarray(i, i + chunk)))
  return out
}

describe('UtteranceSegmenter', () => {
  it('splits two utterances separated by 1.5 s silence', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    const u = run(seg, cat(sine(1000), silence(1500), sine(1000), silence(1500)))
    expect(u).toHaveLength(2)
    expect(u[0].voicedMs).toBe(1000)
  })

  it('merges utterances separated by only 0.6 s', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    const u = run(seg, cat(sine(1000), silence(600), sine(1000), silence(1500)))
    expect(u).toHaveLength(1)
    expect(u[0].voicedMs).toBe(2000)
    // contains the inner gap
    expect(u[0].durationMs).toBeGreaterThan(2600)
  })

  it('drops a 300 ms burst', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    expect(run(seg, cat(sine(300), silence(2000)))).toHaveLength(0)
    expect(seg.inSpeech).toBe(false)
  })

  it('keeps a burst when minUtteranceMs is lowered', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR, minUtteranceMs: 100 })
    expect(run(seg, cat(sine(300), silence(2000)))).toHaveLength(1)
  })

  it('includes pre-roll before speech and trims trailing silence to ~200 ms', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    const u = run(seg, cat(silence(2000), sine(1000), silence(2000)))
    expect(u).toHaveLength(1)
    // 300 pre-roll + 1000 speech + 200 trailing
    expect(u[0].durationMs).toBeCloseTo(1500, -1)
    // first 300 ms are the silent pre-roll, speech follows
    const pre = Math.round(SR * 0.3)
    expect(Math.max(...u[0].samples.subarray(0, pre - 10).map(Math.abs))).toBe(0)
    expect(Math.max(...u[0].samples.subarray(pre + 100, pre + 500).map(Math.abs))).toBeGreaterThan(0.1)
  })

  it('has no pre-roll when preRollMs is 0', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR, preRollMs: 0 })
    const u = run(seg, cat(silence(1000), sine(1000), silence(1500)))
    expect(u[0].durationMs).toBeCloseTo(1200, -1)
  })

  it('gives identical output for odd chunk sizes and one big chunk', () => {
    const sig = cat(silence(500), sine(900), silence(1500), sine(700), silence(1500))
    const a = run(new UtteranceSegmenter({ sampleRate: SR }), sig)
    for (const size of [137, 1, 401, 4999]) {
      const b = run(new UtteranceSegmenter({ sampleRate: SR }), sig, size)
      expect(b).toHaveLength(a.length)
      b.forEach((u, i) => {
        expect(u.samples.length).toBe(a[i].samples.length)
        expect(Array.from(u.samples)).toEqual(Array.from(a[i].samples))
        expect(u.voicedMs).toBe(a[i].voicedMs)
      })
    }
  })

  it('force-cuts at maxUtteranceMs and continues with the remainder', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR, maxUtteranceMs: 2000 })
    const u = run(seg, sine(5000))
    expect(u.length).toBe(2)
    expect(u[0].durationMs).toBeCloseTo(2000, -1)
    const rest = seg.flush()
    expect(rest).toHaveLength(1)
    expect(u.length + rest.length).toBe(3)
  })

  it('honors a custom silenceMs', () => {
    const sig = cat(sine(1000), silence(600), sine(1000), silence(300))
    const short = run(new UtteranceSegmenter({ sampleRate: SR, silenceMs: 400 }), sig)
    expect(short).toHaveLength(1) // first closed by 600ms gap; second still open
    expect(short[0].voicedMs).toBe(1000)
    const long = run(new UtteranceSegmenter({ sampleRate: SR, silenceMs: 2000 }), sig)
    expect(long).toHaveLength(0)
  })

  it('flush emits trailing speech and drops too-short speech', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    expect(run(seg, sine(1000))).toHaveLength(0)
    expect(seg.inSpeech).toBe(true)
    const f = seg.flush()
    expect(f).toHaveLength(1)
    expect(f[0].voicedMs).toBe(1000)
    expect(seg.inSpeech).toBe(false)
    expect(seg.flush()).toHaveLength(0)

    run(seg, sine(200))
    expect(seg.flush()).toHaveLength(0)
  })

  it('flush trims trailing silence that has not reached silenceMs', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR, preRollMs: 0 })
    run(seg, cat(sine(1000), silence(800)))
    const f = seg.flush()
    expect(f[0].durationMs).toBeCloseTo(1200, -1)
  })

  it('reset drops buffered speech and carry', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    run(seg, sine(1000))
    seg.reset()
    expect(seg.inSpeech).toBe(false)
    expect(seg.flush()).toHaveLength(0)
  })

  it('keeps memory bounded while silent (only pre-roll retained)', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    run(seg, silence(10000), 1600)
    const u = run(seg, cat(sine(1000), silence(1500)))
    expect(u).toHaveLength(1)
    expect(u[0].durationMs).toBeCloseTo(1500, -1) // 300 pre + 1000 + 200, not 10 s
  })

  it('treats sub-threshold noise as silence and respects thresholdDbfs', () => {
    const noise = sine(1000, -60)
    expect(run(new UtteranceSegmenter({ sampleRate: SR }), cat(noise, silence(1500)))).toHaveLength(0)
    const sens = new UtteranceSegmenter({ sampleRate: SR, thresholdDbfs: -65 })
    expect(run(sens, cat(noise, silence(1500)))).toHaveLength(1)
  })

  it('ignores empty chunks and rejects an invalid sample rate', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR })
    expect(seg.push(new Float32Array(0))).toEqual([])
    expect(() => new UtteranceSegmenter({ sampleRate: 0 })).toThrow()
  })

  it('supports a custom frameMs', () => {
    const seg = new UtteranceSegmenter({ sampleRate: SR, frameMs: 10 })
    const u = run(seg, cat(sine(1000), silence(1500)))
    expect(u).toHaveLength(1)
    expect(u[0].voicedMs).toBe(1000)
  })
})
