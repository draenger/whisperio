import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * Provider-selection / provider-failure integrity for transcribe.ts.
 *
 * Two classes of defect are pinned here:
 *
 *  1. A provider treated as USABLE without the credentials its own branch
 *     actually requires (isProviderConfigured vs transcribeWithProvider).
 *  2. A provider FAILURE swallowed and reported as an empty transcript — a
 *     200 response whose JSON carries no `text` used to resolve `undefined`,
 *     which counts as success: STT usage gets recorded, the rest of the
 *     provider chain is skipped, and `undefined` is handed back as the
 *     transcript to paste.
 *
 * Harness mirrors tests/fallback.test.ts.
 */

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  getActiveVocabulary: (settings: { customVocabulary?: string }) =>
    settings.customVocabulary?.trim() || ''
}))

const mockNotifyInfo = vi.fn()
vi.mock('../src/main/errorHandler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/errorHandler')>()
  return {
    ...actual,
    notifyInfo: (...args: unknown[]) => mockNotifyInfo(...args),
    notifyError: vi.fn()
  }
})

// Usage metering is a side effect of a SUCCESSFUL STT call — asserted below to
// prove a no-text response is not being counted as a successful transcription.
const mockRecordSTT = vi.fn()
vi.mock('../src/main/usageTracker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/usageTracker')>()
  return {
    ...actual,
    recordSTT: (...args: unknown[]) => mockRecordSTT(...args)
  }
})

function createMockNetRequest(statusCode: number, body: string) {
  const requestListeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  const responseListeners: Record<string, ((...args: unknown[]) => void)[]> = {}

  const mockResponse = {
    statusCode,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!responseListeners[event]) responseListeners[event] = []
      responseListeners[event].push(handler)
    }
  }

  const mockRequest = {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        for (const h of requestListeners['response'] || []) h(mockResponse)
        queueMicrotask(() => {
          for (const h of responseListeners['data'] || []) h(Buffer.from(body))
          for (const h of responseListeners['end'] || []) h()
        })
      })
    }),
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!requestListeners[event]) requestListeners[event] = []
      requestListeners[event].push(handler)
      return mockRequest
    }
  }

  return mockRequest
}

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  net: {
    request: (...args: unknown[]) => mockNetRequest(...args)
  },
  Notification: class MockNotification {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

import { transcribeAudio } from '../src/main/transcribe'

describe('transcribe — provider chain integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('a 200 response carrying no transcript is a failure, not an empty transcript', () => {
    it('rejects instead of resolving undefined when OpenAI returns 200 with no text field', async () => {
      mockLoadSettings.mockReturnValue({
        providerChain: ['openai'],
        openaiApiKey: 'sk-test',
        transcriptionPrompt: '',
        customVocabulary: ''
      })

      // A well-formed JSON body that simply has no `text` — e.g. a provider
      // returning `{"usage":{...}}` after an internal hiccup.
      mockNetRequest.mockReturnValue(createMockNetRequest(200, JSON.stringify({ usage: { seconds: 3 } })))

      await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
        /contained no text/i
      )
    })

    it('does not record STT usage for a no-text response', async () => {
      mockLoadSettings.mockReturnValue({
        providerChain: ['openai'],
        openaiApiKey: 'sk-test',
        transcriptionPrompt: '',
        customVocabulary: ''
      })

      mockNetRequest.mockReturnValue(createMockNetRequest(200, '{}'))

      await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow()
      expect(mockRecordSTT).not.toHaveBeenCalled()
    })

    it('falls through to the next provider when the first returns 200 with no text', async () => {
      mockLoadSettings.mockReturnValue({
        providerChain: ['openai', 'elevenlabs'],
        openaiApiKey: 'sk-test',
        elevenlabsApiKey: 'xi-test',
        transcriptionPrompt: '',
        customVocabulary: ''
      })

      const noTextReq = createMockNetRequest(200, '{}')
      const goodReq = createMockNetRequest(200, JSON.stringify({ text: 'real transcript' }))
      mockNetRequest.mockReturnValueOnce(noTextReq).mockReturnValueOnce(goodReq)

      const result = await transcribeAudio(Buffer.from('audio'), 'test.webm')

      // Before the fix this resolved `undefined` from the FIRST provider and
      // ElevenLabs was never given a turn.
      expect(result).toBe('real transcript')
      expect(mockNetRequest).toHaveBeenCalledTimes(2)
    })

    it('rejects when ElevenLabs returns 200 with no text field', async () => {
      mockLoadSettings.mockReturnValue({
        providerChain: ['elevenlabs'],
        elevenlabsApiKey: 'xi-test',
        transcriptionPrompt: '',
        customVocabulary: ''
      })

      mockNetRequest.mockReturnValue(createMockNetRequest(200, JSON.stringify({ language_code: 'en' })))

      await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
        /contained no text/i
      )
    })

    it('still accepts a legitimately empty transcript (silent audio)', async () => {
      mockLoadSettings.mockReturnValue({
        providerChain: ['openai'],
        openaiApiKey: 'sk-test',
        transcriptionPrompt: '',
        customVocabulary: ''
      })

      mockNetRequest.mockReturnValue(createMockNetRequest(200, JSON.stringify({ text: '' })))

      // An empty STRING is a valid result (the user said nothing) — only a
      // MISSING field is a provider failure.
      await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).resolves.toBe('')
    })
  })

  describe('a provider is only "configured" if its own branch can actually use it', () => {
    it('does not attempt OpenAI when only openaiBaseUrl is set (that setting belongs to selfhosted)', async () => {
      mockLoadSettings.mockReturnValue({
        providerChain: ['openai', 'elevenlabs'],
        // No openaiApiKey. `openaiBaseUrl` is the SELF-HOSTED server URL; the
        // 'openai' branch never reads it and always requires an API key.
        openaiBaseUrl: 'http://127.0.0.1:8178/v1',
        elevenlabsApiKey: 'xi-test',
        transcriptionPrompt: '',
        customVocabulary: ''
      })

      mockNetRequest.mockReturnValue(
        createMockNetRequest(200, JSON.stringify({ text: 'from elevenlabs' }))
      )

      const result = await transcribeAudio(Buffer.from('audio'), 'test.webm')

      expect(result).toBe('from elevenlabs')
      // Before the fix OpenAI passed the "configured" filter on the base URL
      // alone, was attempted, threw "No OpenAI API key configured", and fired a
      // user-facing "OpenAI failed. Trying ElevenLabs..." notification — for a
      // dictation that in fact succeeded.
      expect(mockNotifyInfo).not.toHaveBeenCalled()
    })

    it('still surfaces a descriptive error when OpenAI is the only provider and has no key', async () => {
      mockLoadSettings.mockReturnValue({
        providerChain: ['openai'],
        openaiBaseUrl: 'http://127.0.0.1:8178/v1',
        transcriptionPrompt: '',
        customVocabulary: ''
      })

      // Nothing is configured, so transcribeAudio falls back to attempting the
      // first entry anyway purely to produce a useful message.
      await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
        /No OpenAI API key configured/
      )
    })
  })
})
