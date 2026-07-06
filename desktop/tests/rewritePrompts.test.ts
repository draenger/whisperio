import { describe, it, expect } from 'vitest'
import {
  REWRITE_SEEDS,
  TECHNICAL_TERMS_PRESET_ID,
  buildRewriteMessages,
  resolveRewriteSystemPrompt
} from '../src/main/rewritePrompts'

describe('rewrite seeds', () => {
  it('has stable, unique ids and non-empty prompts/names', () => {
    const ids = REWRITE_SEEDS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of REWRITE_SEEDS) {
      expect(preset.name.trim().length).toBeGreaterThan(0)
      expect(preset.prompt.trim().length).toBeGreaterThan(0)
      expect(preset.isSeed).toBe(true)
    }
  })

  it('includes the technical-terms default preset', () => {
    expect(REWRITE_SEEDS.some((p) => p.id === TECHNICAL_TERMS_PRESET_ID)).toBe(true)
  })
})

describe('buildRewriteMessages', () => {
  it('trims the transcript into the user message', () => {
    const { user } = buildRewriteMessages({ customPrompt: 'do it' }, '  hello world  ')
    expect(user).toBe('hello world')
  })

  it('yields an empty user message for a whitespace-only transcript (guardable)', () => {
    expect(buildRewriteMessages({ customPrompt: 'x' }, '   ').user).toBe('')
    expect(buildRewriteMessages({ customPrompt: 'x' }, '').user).toBe('')
  })

  it('substitutes the {{vocabulary}} placeholder in the technical-terms prompt', () => {
    const preset = REWRITE_SEEDS.find((p) => p.id === TECHNICAL_TERMS_PRESET_ID)!
    const { system } = buildRewriteMessages({ preset }, 'text', 'git, GitHub')
    expect(system).toContain('git, GitHub')
    expect(system).not.toContain('{{vocabulary}}')
  })

  it('prefers a custom prompt over a preset', () => {
    const preset = REWRITE_SEEDS[0]
    const { system } = buildRewriteMessages({ preset, customPrompt: 'CUSTOM' }, 't')
    expect(system).toBe('CUSTOM')
  })
})

describe('resolveRewriteSystemPrompt', () => {
  it('resolves the chosen preset by id', () => {
    const system = resolveRewriteSystemPrompt(REWRITE_SEEDS, 'email', '')
    expect(system).toContain('email')
  })

  it('falls back to the technical-terms prompt when the id is unknown or undefined', () => {
    const viaUndefined = resolveRewriteSystemPrompt(REWRITE_SEEDS, undefined, 'foo, bar')
    const viaUnknown = resolveRewriteSystemPrompt(REWRITE_SEEDS, 'does-not-exist', 'foo, bar')
    expect(viaUndefined).toContain('foo, bar')
    expect(viaUndefined).toContain('exact spellings')
    expect(viaUnknown).toBe(viaUndefined)
  })
})
