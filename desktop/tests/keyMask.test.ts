import { describe, it, expect } from 'vitest'
import { maskKey, buildKeyStatus, redactKeys, sanitizeRendererSave } from '../src/shared/keyMask'

const FIELDS = ['openaiApiKey', 'groqApiKey'] as const

describe('maskKey', () => {
  it('masks first 3 + last 4 for keys of >= 12 chars', () => {
    expect(maskKey('sk-abcdefgh1234')).toBe('sk-\u20261234')
    expect(maskKey('123456789012')).toBe('123\u20269012')
  })
  it('returns "" for short, empty or missing keys', () => {
    expect(maskKey('12345678901')).toBe('')
    expect(maskKey('')).toBe('')
    expect(maskKey(undefined)).toBe('')
    expect(maskKey(null)).toBe('')
  })
})

describe('buildKeyStatus / redactKeys', () => {
  it('reports set + hint per field and never leaks the raw value', () => {
    const settings = { openaiApiKey: 'sk-abcdefgh1234', groqApiKey: '', other: 'x' }
    const r = redactKeys(settings, FIELDS)
    expect(r.openaiApiKey).toBe('')
    expect(r.groqApiKey).toBe('')
    expect(r.other).toBe('x')
    expect(r.keyStatus).toEqual({
      openaiApiKey: { set: true, hint: 'sk-\u20261234' },
      groqApiKey: { set: false, hint: '' }
    })
    expect(JSON.stringify(r)).not.toContain('abcdefgh')
    expect(settings.openaiApiKey).toBe('sk-abcdefgh1234') // input not mutated
  })
  it('a short key is set with an empty hint', () => {
    expect(buildKeyStatus({ openaiApiKey: 'short' }, FIELDS).openaiApiKey).toEqual({ set: true, hint: '' })
  })
})

describe('sanitizeRendererSave', () => {
  it("drops empty key fields (unchanged), keeps non-empty (replace), keeps other fields", () => {
    const out = sanitizeRendererSave({ openaiApiKey: '', groqApiKey: 'gsk-new', foo: 1 }, FIELDS)
    expect(out).toEqual({ groqApiKey: 'gsk-new', foo: 1 })
  })
  it("clearKeys turns the named field into '' (explicit clear) and is stripped", () => {
    const out = sanitizeRendererSave({ openaiApiKey: '', clearKeys: ['openaiApiKey', 'groqApiKey', 'bogus'] }, FIELDS)
    expect(out).toEqual({ openaiApiKey: '', groqApiKey: '' })
  })
  it('clearKeys wins over a non-empty value; keyStatus is never persisted', () => {
    const out = sanitizeRendererSave({ openaiApiKey: 'x', clearKeys: ['openaiApiKey'], keyStatus: {} }, FIELDS)
    expect(out).toEqual({ openaiApiKey: '' })
  })
})
