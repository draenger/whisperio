import { vi, describe, it, expect } from 'vitest'
import { cleanupTranscription } from '../src/main/postprocess'
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
