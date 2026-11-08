// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getHid, reportBytes, usageForReport, type HidDeviceLike } from '../src/renderer/audio/webHid'
import { cueTones, playCueSound } from '../src/renderer/audio/cues'

const g = globalThis as any

describe('webHid helpers', () => {
  afterEach(() => { delete g.navigator })

  it('getHid returns navigator.hid or null', () => {
    Object.defineProperty(g, 'navigator', { value: {}, configurable: true })
    expect(getHid()).toBeNull()
    const hid = { getDevices: vi.fn() }
    Object.defineProperty(g, 'navigator', { value: { hid }, configurable: true })
    expect(getHid()).toBe(hid)
  })

  it('reportBytes honours DataView byteOffset/length (not the whole buffer)', () => {
    const buf = new Uint8Array([9, 9, 1, 2, 3, 9]).buffer
    expect(reportBytes({ reportId: 1, data: new DataView(buf, 2, 3) })).toEqual([1, 2, 3])
  })

  it('usageForReport finds the collection declaring the report id, treating missing id as 0', () => {
    const d = {
      collections: [
        { usagePage: 1, usage: 2, inputReports: [{ reportId: 5 }] },
        { usagePage: 12, usage: 1, inputReports: [{}] }
      ]
    } as unknown as HidDeviceLike
    expect(usageForReport(d, 5)).toEqual({ usagePage: 1, usage: 2 })
    expect(usageForReport(d, 0)).toEqual({ usagePage: 12, usage: 1 })
  })

  it('usageForReport falls back to the first collection, or empty when none', () => {
    const d = { collections: [{ usagePage: 7, usage: 8 }] } as unknown as HidDeviceLike
    expect(usageForReport(d, 99)).toEqual({ usagePage: 7, usage: 8 })
    expect(usageForReport({} as HidDeviceLike, 1)).toEqual({ usagePage: undefined, usage: undefined })
  })
})

describe('cues', () => {
  afterEach(() => { delete g.window })

  it('each cue kind has its own tones and sequential tones never overlap', () => {
    expect(cueTones('start').map((t) => t.freq)).toEqual([660, 988])
    expect(cueTones('sent')).toHaveLength(2)
    expect(cueTones('error')[0].type).toBe('sawtooth')
    expect(cueTones('held')).toHaveLength(1)
    for (const k of ['start', 'sent'] as const) {
      const [a, b] = cueTones(k)
      expect(b.at).toBeGreaterThanOrEqual(a.at + a.dur)
    }
  })

  it('playCueSound schedules one oscillator per tone, resumes a suspended context, reuses it', () => {
    const oscs: any[] = []
    const resume = vi.fn()
    let created = 0
    class Ctx {
      state = 'suspended'; currentTime = 1; destination = {}
      resume = resume
      constructor() { created++ }
      createOscillator() {
        const o: any = { frequency: { value: 0 }, connect: (x: unknown) => x, start: vi.fn(), stop: vi.fn() }
        oscs.push(o); return o
      }
      createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: (x: unknown) => x } }
    }
    g.window = { AudioContext: Ctx }
    playCueSound('start')
    expect(oscs.map((o) => o.frequency.value)).toEqual([660, 988])
    expect(oscs[0].start).toHaveBeenCalledWith(1.02)
    expect(resume).toHaveBeenCalledTimes(1)
    playCueSound('held')
    expect(oscs).toHaveLength(3)
    expect(created).toBe(1)
  })

  it('playCueSound is a no-op without AudioContext and never throws when audio fails', () => {
    g.window = {}
    expect(() => playCueSound('sent')).not.toThrow()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    g.window = { AudioContext: class { createOscillator() { throw new Error('no audio') } state = 'running'; currentTime = 0 } }
    expect(() => playCueSound('error')).not.toThrow()
    warn.mockRestore()
  })
})
