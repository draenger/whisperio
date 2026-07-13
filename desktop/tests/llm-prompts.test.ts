import { describe, it, expect } from 'vitest'
import { buildCleanupMessages, buildCommandMessages } from '../src/main/llm/prompts'

describe('buildCleanupMessages', () => {
  it('mode "full" includes all 7 numbered rules in order', () => {
    const [system] = buildCleanupMessages({ raw: 'hi', vocab: '', tone: '', mode: 'full' })
    expect(system.role).toBe('system')

    for (let n = 1; n <= 7; n++) {
      expect(system.content).toContain(`\n${n}. `)
    }
    // no 8th rule
    expect(system.content).not.toContain('\n8. ')

    // Rule 4 (self-correction) and rule 7 (tone) are present in full mode.
    expect(system.content).toContain('4. Resolve self-corrections')
    expect(system.content).toContain('7. If a tone profile is provided')
  })

  it('mode "light" drops rules 4 and 7 and renumbers the remaining 5 consecutively', () => {
    const [system] = buildCleanupMessages({ raw: 'hi', vocab: '', tone: '', mode: 'light' })

    expect(system.content).not.toContain('Resolve self-corrections')
    expect(system.content).not.toContain('If a tone profile is provided')

    for (let n = 1; n <= 5; n++) {
      expect(system.content).toContain(`\n${n}. `)
    }
    expect(system.content).not.toContain('\n6. ')

    // Content that survives light mode keeps its relative order, renumbered.
    expect(system.content).toContain('1. Detect the input language')
    expect(system.content).toContain('2. Remove filler words')
    expect(system.content).toContain('3. Add correct punctuation')
    expect(system.content).toContain('4. Never add, invent, summarize')
    expect(system.content).toContain('5. Preserve proper nouns')
  })

  it('injects vocab and tone into the system prompt when provided', () => {
    const [system] = buildCleanupMessages({
      raw: 'hi',
      vocab: 'Kubernetes, PostgreSQL',
      tone: 'casual, friendly',
      mode: 'full'
    })

    expect(system.content).toContain('Preferred spellings: Kubernetes, PostgreSQL')
    expect(system.content).toContain('Tone profile: casual, friendly')
  })

  it('renders "(none)" for empty or whitespace-only vocab/tone', () => {
    const [system] = buildCleanupMessages({ raw: 'hi', vocab: '   ', tone: '', mode: 'full' })

    expect(system.content).toContain('Preferred spellings: (none)')
    expect(system.content).toContain('Tone profile: (none)')
  })

  it('passes raw through verbatim as the user message', () => {
    const raw = 'um so like I went to the, the store yesterday'
    const [, user] = buildCleanupMessages({ raw, vocab: '', tone: '', mode: 'full' })

    expect(user).toEqual({ role: 'user', content: raw })
  })

  it('returns exactly one system message followed by one user message', () => {
    const messages = buildCleanupMessages({ raw: 'hi', vocab: '', tone: '', mode: 'full' })
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
  })

  it('opens with the "return only the cleaned text" instruction in both modes', () => {
    for (const mode of ['full', 'light'] as const) {
      const [system] = buildCleanupMessages({ raw: 'hi', vocab: '', tone: '', mode })
      expect(system.content.startsWith('You are a speech-to-text cleanup engine.')).toBe(true)
      expect(system.content).toContain('Return ONLY the cleaned text')
    }
  })
})

describe('buildCommandMessages', () => {
  it('returns a system message plus a user message embedding the instruction and selection', () => {
    const messages = buildCommandMessages({ command: 'Make this more formal', selection: 'hey whats up' })

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'Instruction: Make this more formal\n\nText:\nhey whats up'
    })
  })

  it('system prompt asks for output-only text with no commentary', () => {
    const [system] = buildCommandMessages({ command: 'fix grammar', selection: 'text' })
    expect(system.content).toContain('return ONLY the')
    expect(system.content).toContain('no commentary')
  })
})
