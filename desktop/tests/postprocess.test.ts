import { vi, describe, it, expect } from 'vitest'
import { cleanupTranscription, cleanupTranscriptionDetailed, formatTranscription, rewriteSelection } from '../src/main/postprocess'
import type { LLMProvider, LLMRequest } from '../src/main/llm/provider'

function fakeProvider(complete: (req: LLMRequest) => Promise<string>): LLMProvider {
  return {
    id: 'fake',
    isLocal: false,
    complete,
    available: vi.fn().mockResolvedValue(true)
  }
}

describe('cleanupTranscription', () => {
  it('removes filler words (PL fixture) via the mocked provider', async () => {
    const raw = 'yyy więc, eee, idziemy jutro do kina'
    const cleaned = 'Idziemy jutro do kina.'
    const complete = vi.fn().mockResolvedValue(cleaned)

    const result = await cleanupTranscription(raw, {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })

    expect(result).toBe(cleaned)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('removes filler words (EN fixture) via the mocked provider', async () => {
    const raw = 'um so like I went to the, the store yesterday'
    const cleaned = 'I went to the store yesterday.'
    const complete = vi.fn().mockResolvedValue(cleaned)

    const result = await cleanupTranscription(raw, {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })

    expect(result).toBe(cleaned)
  })

  it('resolves a PL self-correction to the final intended version', async () => {
    const raw = 'yyy zróbmy to we wtorek, nie, w piątek'
    const cleaned = 'Zróbmy to w piątek.'
    const complete = vi.fn().mockResolvedValue(cleaned)

    const result = await cleanupTranscription(raw, {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })

    expect(result).toBe(cleaned)
  })

  it('guards against hallucination: output > 1.6x input length falls back to raw', async () => {
    const raw = 'short input'
    // Roughly 3x the input length — well past the 1.6x hallucination guard.
    const hallucinated = 'this is a way way way way way way way way way too long fabricated continuation'
    const complete = vi.fn().mockResolvedValue(hallucinated)

    const result = await cleanupTranscription(raw, {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })

    expect(result).toBe(raw)
  })

  it('falls back to raw when the provider is null', async () => {
    const raw = 'some raw transcript'

    const result = await cleanupTranscription(raw, {
      cleanupMode: 'full',
      vocab: '',
      provider: null
    })

    expect(result).toBe(raw)
  })

  it('mode "off" returns raw without calling the provider', async () => {
    const raw = 'some raw transcript'
    const complete = vi.fn().mockResolvedValue('should not be used')

    const result = await cleanupTranscription(raw, {
      cleanupMode: 'off',
      vocab: '',
      provider: fakeProvider(complete)
    })

    expect(result).toBe(raw)
    expect(complete).not.toHaveBeenCalled()
  })

  it('mode "light" builds messages without rules 4 (self-correction) and 7 (tone)', async () => {
    let captured: LLMRequest | undefined
    const complete = vi.fn().mockImplementation(async (req: LLMRequest) => {
      captured = req
      return 'cleaned'
    })

    await cleanupTranscription('raw text', {
      cleanupMode: 'light',
      vocab: '',
      provider: fakeProvider(complete)
    })

    const system = captured?.messages.find((m) => m.role === 'system')
    expect(system?.content).not.toContain('Resolve self-corrections')
    expect(system?.content).not.toContain('If a tone profile is provided')
  })

  it('mode "full" builds messages including rules 4 and 7', async () => {
    let captured: LLMRequest | undefined
    const complete = vi.fn().mockImplementation(async (req: LLMRequest) => {
      captured = req
      return 'cleaned'
    })

    await cleanupTranscription('raw text', {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })

    const system = captured?.messages.find((m) => m.role === 'system')
    expect(system?.content).toContain('Resolve self-corrections')
    expect(system?.content).toContain('If a tone profile is provided')
  })

  it('injects the vocabulary into the built messages', async () => {
    let captured: LLMRequest | undefined
    const complete = vi.fn().mockImplementation(async (req: LLMRequest) => {
      captured = req
      return 'cleaned'
    })

    await cleanupTranscription('raw text', {
      cleanupMode: 'full',
      vocab: 'Kubernetes, PostgreSQL',
      provider: fakeProvider(complete)
    })

    const system = captured?.messages.find((m) => m.role === 'system')
    expect(system?.content).toContain('Preferred spellings: Kubernetes, PostgreSQL')
  })

  it('sends temperature 0.2 and forwards the abort signal to the provider', async () => {
    let captured: LLMRequest | undefined
    const complete = vi.fn().mockImplementation(async (req: LLMRequest) => {
      captured = req
      return 'cleaned'
    })
    const controller = new AbortController()

    await cleanupTranscription('raw text', {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete),
      signal: controller.signal
    })

    expect(captured?.temperature).toBe(0.2)
    expect(captured?.signal).toBe(controller.signal)
  })

  it('falls back to raw when the provider call is aborted (new dictation started)', async () => {
    const controller = new AbortController()
    const complete = vi.fn().mockImplementation(async () => {
      controller.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })

    const result = await cleanupTranscription('raw transcript', {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete),
      signal: controller.signal
    })

    expect(result).toBe('raw transcript')
  })

  it('falls back to raw when the provider call rejects for any other reason', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('HTTP 500'))

    const result = await cleanupTranscription('raw transcript', {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })

    expect(result).toBe('raw transcript')
  })

  it('falls back to raw when the raw transcript is empty or whitespace-only', async () => {
    const complete = vi.fn().mockResolvedValue('should not be called')

    expect(await cleanupTranscription('', { cleanupMode: 'full', vocab: '', provider: fakeProvider(complete) })).toBe(
      ''
    )
    expect(
      await cleanupTranscription('   ', { cleanupMode: 'full', vocab: '', provider: fakeProvider(complete) })
    ).toBe('   ')
    expect(complete).not.toHaveBeenCalled()
  })

  it('falls back to raw when the provider returns an empty/whitespace-only completion', async () => {
    const complete = vi.fn().mockResolvedValue('   ')

    const result = await cleanupTranscription('raw transcript', {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })

    expect(result).toBe('raw transcript')
  })

  it('strips wrapping quotes and backticks from the completion', async () => {
    const cases: [string, string][] = [
      ['"Cleaned text."', 'Cleaned text.'],
      ["'Cleaned text.'", 'Cleaned text.'],
      ['`Cleaned text.`', 'Cleaned text.'],
      ['“Cleaned text.”', 'Cleaned text.'],
      ['```\nCleaned text.\n```', 'Cleaned text.']
    ]

    for (const [wrapped, expected] of cases) {
      const complete = vi.fn().mockResolvedValue(wrapped)
      const result = await cleanupTranscription('raw transcript text here', {
        cleanupMode: 'full',
        vocab: '',
        provider: fakeProvider(complete)
      })
      expect(result).toBe(expected)
    }
  })
})

describe('cleanupTranscriptionDetailed', () => {
  it('reports ok: true and the cleaned text on a successful completion', async () => {
    const complete = vi.fn().mockResolvedValue('Cleaned text.')
    const result = await cleanupTranscriptionDetailed('raw text here', {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: 'Cleaned text.', ok: true })
  })

  it('reports ok: false (raw kept) when there is no provider', async () => {
    const result = await cleanupTranscriptionDetailed('raw text here', {
      cleanupMode: 'full',
      vocab: '',
      provider: null
    })
    expect(result).toEqual({ text: 'raw text here', ok: false })
  })

  it('reports ok: false (raw kept) when mode is "off", without calling the provider', async () => {
    const complete = vi.fn().mockResolvedValue('should not be used')
    const result = await cleanupTranscriptionDetailed('raw text here', {
      cleanupMode: 'off',
      vocab: '',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: 'raw text here', ok: false })
    expect(complete).not.toHaveBeenCalled()
  })

  it('reports ok: false (raw kept) when the provider call rejects', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    const result = await cleanupTranscriptionDetailed('raw text here', {
      cleanupMode: 'full',
      vocab: '',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: 'raw text here', ok: false })
  })
})

describe('formatTranscription', () => {
  it('applies the instruction and returns ok: true with the formatted text', async () => {
    let captured: LLMRequest | undefined
    const complete = vi.fn().mockImplementation(async (req: LLMRequest) => {
      captured = req
      return 'Dear team,\n\nPlease see the notes below.\n\nBest,'
    })

    const result = await formatTranscription('we need to finish the report by friday', {
      instruction: 'Reformat this text into a polite email.',
      provider: fakeProvider(complete)
    })

    expect(result).toEqual({ text: 'Dear team,\n\nPlease see the notes below.\n\nBest,', ok: true })
    const system = captured?.messages.find((m) => m.role === 'system')
    expect(system?.content).toContain('Reformat this text into a polite email.')
    expect(system?.content).toContain('Return ONLY the resulting text')
    const user = captured?.messages.find((m) => m.role === 'user')
    expect(user).toEqual({ role: 'user', content: 'we need to finish the report by friday' })
  })

  it('falls back to raw (ok: false) when there is no provider', async () => {
    const result = await formatTranscription('raw text', {
      instruction: 'Reformat as bullet notes.',
      provider: null
    })
    expect(result).toEqual({ text: 'raw text', ok: false })
  })

  it('falls back to raw (ok: false) when the instruction is empty, without calling the provider', async () => {
    const complete = vi.fn().mockResolvedValue('should not be used')
    const result = await formatTranscription('raw text', {
      instruction: '   ',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: 'raw text', ok: false })
    expect(complete).not.toHaveBeenCalled()
  })

  it('falls back to raw (ok: false) when the provider call rejects', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await formatTranscription('raw text', {
      instruction: 'Reformat as a task list.',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: 'raw text', ok: false })
  })

  it('guards against hallucination the same way cleanupTranscription does', async () => {
    const raw = 'short input'
    const hallucinated = 'this is a way way way way way way way way way too long fabricated continuation'
    const complete = vi.fn().mockResolvedValue(hallucinated)
    const result = await formatTranscription(raw, {
      instruction: 'Reformat as a message.',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: raw, ok: false })
  })
})

// COMMAND mode (v1.7 — dictation/hotkeyManager.ts's 'command' DictationState):
// rewriteSelection() rewrites an arbitrary piece of text (the desktop's
// clipboard contents) per a spoken instruction, instead of formatting a
// transcript per a fixed template. Same fail-soft contract as
// formatTranscription — mirrors that describe block's cases.
describe('rewriteSelection', () => {
  it('applies the spoken command and returns ok: true with the rewritten text', async () => {
    let captured: LLMRequest | undefined
    const complete = vi.fn().mockImplementation(async (req: LLMRequest) => {
      captured = req
      return 'Dear team, we will ship tomorrow.'
    })

    const result = await rewriteSelection('Dear team, we ship tomorrow.', {
      command: 'make this more formal',
      provider: fakeProvider(complete)
    })

    expect(result).toEqual({ text: 'Dear team, we will ship tomorrow.', ok: true })
    // buildCommandMessages (llm/prompts.ts) puts BOTH the instruction and the
    // selection into the user message; system carries the fixed
    // "apply the instruction, change nothing else" discipline.
    const user = captured?.messages.find((m) => m.role === 'user')
    expect(user?.content).toContain('make this more formal')
    expect(user?.content).toContain('Dear team, we ship tomorrow.')
    const system = captured?.messages.find((m) => m.role === 'system')
    expect(system?.content).toContain("Apply the user's instruction")
  })

  it('falls back to the untouched selection (ok: false) when there is no provider', async () => {
    const result = await rewriteSelection('some clipboard text', {
      command: 'make this shorter',
      provider: null
    })
    expect(result).toEqual({ text: 'some clipboard text', ok: false })
  })

  it('falls back to the untouched selection (ok: false) when the command is empty, without calling the provider', async () => {
    const complete = vi.fn().mockResolvedValue('should not be used')
    const result = await rewriteSelection('some clipboard text', {
      command: '   ',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: 'some clipboard text', ok: false })
    expect(complete).not.toHaveBeenCalled()
  })

  it('falls back to the untouched selection (ok: false) when the provider call rejects', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await rewriteSelection('some clipboard text', {
      command: 'make this shorter',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: 'some clipboard text', ok: false })
  })

  it('guards against hallucination the same way formatTranscription does', async () => {
    const selection = 'short input'
    const hallucinated = 'this is a way way way way way way way way way too long fabricated continuation'
    const complete = vi.fn().mockResolvedValue(hallucinated)
    const result = await rewriteSelection(selection, {
      command: 'rewrite this',
      provider: fakeProvider(complete)
    })
    expect(result).toEqual({ text: selection, ok: false })
  })
})
