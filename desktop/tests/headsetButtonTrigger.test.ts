import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))
const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  openSync: vi.fn(() => 1),
  fsyncSync: vi.fn(),
  closeSync: vi.fn(),
  unlinkSync: vi.fn()
}))

import {
  matchesHidReport,
  sanitizeButtonTrigger,
  triggerFromLearnEvent,
  keyToAccelerator,
  appCommandFromLParam,
  type ButtonTrigger
} from '../src/main/buttonTrigger'
import { loadSettings } from '../src/main/settingsManager'
import { cueTones } from '../src/renderer/audio/cues'

const hidTrigger: ButtonTrigger = {
  kind: 'hid',
  vendorId: 0x0b0e,
  productId: 0x24ac,
  reportId: 2,
  pattern: [0x01, 0x00],
  mask: [0x01, 0x00]
}

describe('matchesHidReport', () => {
  const rep = (over: Partial<{ vendorId: number; productId: number; reportId: number; data: number[] }> = {}) => ({
    vendorId: 0x0b0e,
    productId: 0x24ac,
    reportId: 2,
    data: [0x01, 0x00],
    ...over
  })
  it('matches the pressed report, including extra non-masked bits', () => {
    expect(matchesHidReport(hidTrigger, rep())).toBe(true)
    expect(matchesHidReport(hidTrigger, rep({ data: [0x03, 0x55] }))).toBe(true)
  })
  it('does not match the release (all-zero) report', () => {
    expect(matchesHidReport(hidTrigger, rep({ data: [0x00, 0x00] }))).toBe(false)
  })
  it('does not match another device, report id, or a too-short report', () => {
    expect(matchesHidReport(hidTrigger, rep({ vendorId: 0x1234 }))).toBe(false)
    expect(matchesHidReport(hidTrigger, rep({ productId: 1 }))).toBe(false)
    expect(matchesHidReport(hidTrigger, rep({ reportId: 3 }))).toBe(false)
    expect(matchesHidReport(hidTrigger, rep({ data: [0x01] }))).toBe(false)
  })
  it('never matches non-hid triggers or null', () => {
    expect(matchesHidReport(null, rep())).toBe(false)
    expect(matchesHidReport({ kind: 'appcommand', id: 46 }, rep())).toBe(false)
  })
})

describe('sanitizeButtonTrigger', () => {
  it('accepts valid triggers of each kind', () => {
    expect(sanitizeButtonTrigger({ kind: 'accelerator', accelerator: ' MediaPlayPause ' })).toEqual({ kind: 'accelerator', accelerator: 'MediaPlayPause' })
    expect(sanitizeButtonTrigger({ kind: 'appcommand', id: 46 })).toEqual({ kind: 'appcommand', id: 46 })
    expect(sanitizeButtonTrigger(hidTrigger)).toEqual(hidTrigger)
  })
  it('rejects malformed input', () => {
    for (const bad of [
      null, 'x', 5, [], {}, { kind: 'nope' },
      { kind: 'accelerator', accelerator: '' },
      { kind: 'accelerator', accelerator: 'x'.repeat(65) },
      { kind: 'accelerator', accelerator: 3 },
      { kind: 'appcommand', id: 0 },
      { kind: 'appcommand', id: 1.5 },
      { kind: 'appcommand', id: 999 },
      { ...hidTrigger, vendorId: 0x10000 },
      { ...hidTrigger, reportId: -1 },
      { ...hidTrigger, pattern: [] },
      { ...hidTrigger, mask: [1] }, // length mismatch
      { ...hidTrigger, pattern: [256, 0] },
      { ...hidTrigger, mask: [0, 0] }, // would match every report
      { ...hidTrigger, pattern: [0x00, 0x00], mask: [0xff, 0xff] } // matches only the idle report
    ]) {
      expect(sanitizeButtonTrigger(bad)).toBeNull()
    }
  })
  it('copies arrays (no aliasing of untrusted input)', () => {
    const input = { ...hidTrigger, pattern: [1, 0], mask: [1, 0] }
    const out = sanitizeButtonTrigger(input) as Extract<ButtonTrigger, { kind: 'hid' }>
    input.pattern[0] = 9
    expect(out.pattern[0]).toBe(1)
  })
})

describe('learn event -> trigger', () => {
  it('learns an accelerator from media keys and F13-F24', () => {
    expect(triggerFromLearnEvent({ source: 'globalShortcut', accelerator: 'MediaPlayPause' })).toEqual({ kind: 'accelerator', accelerator: 'MediaPlayPause' })
    expect(triggerFromLearnEvent({ source: 'keyboard', code: 'F24' })).toEqual({ kind: 'accelerator', accelerator: 'F24' })
    expect(triggerFromLearnEvent({ source: 'keyboard', code: 'MediaTrackNext' })).toEqual({ kind: 'accelerator', accelerator: 'MediaNextTrack' })
  })
  it('ignores ordinary typing keys', () => {
    expect(triggerFromLearnEvent({ source: 'keyboard', code: 'KeyA', key: 'a' })).toBeNull()
    expect(keyToAccelerator('F25')).toBeNull()
    expect(keyToAccelerator('F0')).toBeNull()
  })
  it('learns a HID press with a mask on set bytes, and the learned trigger matches its own report but not the release', () => {
    const t = triggerFromLearnEvent({ source: 'hid', vendorId: 1, productId: 2, reportId: 4, data: [0x20, 0x00, 0x01] })!
    expect(t).toMatchObject({ kind: 'hid', mask: [0xff, 0x00, 0xff] })
    expect(matchesHidReport(t, { vendorId: 1, productId: 2, reportId: 4, data: [0x20, 0x7f, 0x01] })).toBe(true)
    expect(matchesHidReport(t, { vendorId: 1, productId: 2, reportId: 4, data: [0, 0, 0] })).toBe(false)
  })
  it('refuses to learn an idle HID report', () => {
    expect(triggerFromLearnEvent({ source: 'hid', vendorId: 1, productId: 2, reportId: 0, data: [0, 0] })).toBeNull()
  })
  it('extracts the APPCOMMAND id from WM_APPCOMMAND lParam (HIWORD & ~0xF000)', () => {
    const b = Buffer.alloc(8)
    // device = FAPPCOMMAND_KEY (0x0000), cmd 46 (MEDIA_PLAY_PAUSE) -> hi word 0x002E
    b.writeUInt32LE((0x002e << 16) >>> 0, 0)
    expect(appCommandFromLParam(b)).toBe(46)
    // FAPPCOMMAND_OEM (0x8000) flag must be stripped
    b.writeUInt32LE(((0x8000 | 43) << 16) >>> 0, 0)
    expect(appCommandFromLParam(b)).toBe(43)
    expect(appCommandFromLParam(Buffer.alloc(2))).toBeNull()
  })
})

describe('settings normalisation', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true)
  })
  const load = (obj: unknown) => {
    mockReadFileSync.mockReturnValue(JSON.stringify(obj))
    return loadSettings()
  }
  it('defaults: feature off, no swallow, dictate-and-send, cues on', () => {
    const s = load({})
    expect(s).toMatchObject({
      buttonTrigger: null,
      buttonTriggerSwallow: false,
      buttonAction: 'dictate-and-send',
      buttonAutoPin: true,
      soundCues: true
    })
    mockExistsSync.mockReturnValue(false)
    expect(loadSettings()).toMatchObject({ buttonTrigger: null, soundCues: true })
  })
  it('drops a corrupt trigger and coerces junk values instead of crashing', () => {
    const s = load({ buttonTrigger: { kind: 'hid', vendorId: 'x' }, buttonAction: 'rm -rf', buttonTriggerSwallow: 'yes', soundCues: 0, buttonAutoPin: null })
    expect(s.buttonTrigger).toBeNull()
    expect(s.buttonAction).toBe('dictate-and-send')
    expect(s.buttonTriggerSwallow).toBe(false)
    expect(s.soundCues).toBe(true) // only an explicit false disables
    expect(s.buttonAutoPin).toBe(true)
  })
  it('keeps a valid trigger and explicit false cues', () => {
    const s = load({ buttonTrigger: hidTrigger, buttonAction: 'continuous-toggle', buttonTriggerSwallow: true, soundCues: false })
    expect(s.buttonTrigger).toEqual(hidTrigger)
    expect(s.buttonAction).toBe('continuous-toggle')
    expect(s.buttonTriggerSwallow).toBe(true)
    expect(s.soundCues).toBe(false)
  })
})

describe('cue tones', () => {
  it('start rises, sent is a high double beep, error is a low buzz, held is a single mid beep', () => {
    const start = cueTones('start')
    expect(start).toHaveLength(2)
    expect(start[1].freq).toBeGreaterThan(start[0].freq)
    const sent = cueTones('sent')
    expect(sent).toHaveLength(2)
    expect(sent[0].freq).toBeGreaterThan(1000)
    const err = cueTones('error')
    expect(err).toHaveLength(1)
    expect(err[0].freq).toBeLessThan(200)
    expect(cueTones('held')).toHaveLength(1)
  })
})
