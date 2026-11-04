import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { scriptedNetRequest } from './helpers/scriptedNetRequest'

// Error-path / fail-soft coverage for src/main/transcribe.ts that the
// happy-path-oriented transcribe.test.ts / transcribeConversation.test.ts
// can't reach with their always-200 net mock:
//   - the 45s timeout, request/response 'error' events and blocked redirects
//     of the OpenAI, ElevenLabs and both diarized (conversation) clients
//   - missing-key errors for groq/deepgram/assemblyai/mistral and their
//     "configured" checks in the provider chain
//   - fallback-chain bookkeeping (first error kept, non-Error rejections)
//   - selfhosted: a failed on-demand local-server start must not block
//   - Replicate: transport rejections, dev-only body logging, prompt field
//   - transcribeConversation: settings read failing before the call

let settings: Record<string, unknown> = {}
const mockGetEffectiveSettings = vi.fn(() => settings)
vi.mock('../src/main/secure/keyAccessor', () => ({
  getEffectiveSettings: () => mockGetEffectiveSettings()
}))

vi.mock('../src/main/settingsManager', () => ({
  getActiveVocabulary: (s: { customVocabulary?: string }) => s.customVocabulary?.trim() || ''
}))

const mockRecordError = vi.fn()
const mockNotifyFailure = vi.fn()
vi.mock('../src/main/errorHandler', () => ({
  recordTranscriptionError: (...a: unknown[]) => mockRecordError(...a),
  describeTranscriptionError: (e: Error, provider: string) => ({ provider, message: e.message }),
  notifyTranscriptionFailure: (...a: unknown[]) => mockNotifyFailure(...a)
}))

const mockEnsureServer = vi.fn()
vi.mock('../src/main/localServer', () => ({
  getServerStatus: () => ({ port: 8178 }),
  ensureManagedServerForUrl: (...a: unknown[]) => mockEnsureServer(...a)
}))

const mockRecordSTT = vi.fn()
vi.mock('../src/main/usageTracker', () => ({
  recordSTT: (...a: unknown[]) => mockRecordSTT(...a),
  estimateAudioSeconds: () => 1
}))

vi.mock('../src/main/recordingStore', () => ({
  getRecording: vi.fn(),
  updateRecording: vi.fn()
}))

// The fetch/net-based sub-clients have their own test files; here we only
// care how transcribe.ts wires them in (arguments, defaults, rejections).
const mockGroq = vi.fn()
const mockMistral = vi.fn()
const mockDeepgram = vi.fn()
const mockDeepgramDiarized = vi.fn()
const mockAssembly = vi.fn()
const mockAssemblyDiarized = vi.fn()
vi.mock('../src/main/llm/groq', () => ({ groqTranscribe: (...a: unknown[]) => mockGroq(...a) }))
vi.mock('../src/main/llm/mistral', () => ({ mistralTranscribe: (...a: unknown[]) => mockMistral(...a) }))
vi.mock('../src/main/llm/deepgram', () => ({
  deepgramTranscribe: (...a: unknown[]) => mockDeepgram(...a),
  deepgramTranscribeDiarized: (...a: unknown[]) => mockDeepgramDiarized(...a)
}))
vi.mock('../src/main/llm/assembly', () => ({
  assemblyAITranscribe: (...a: unknown[]) => mockAssembly(...a),
  assemblyAITranscribeDiarized: (...a: unknown[]) => mockAssemblyDiarized(...a)
}))

const mockNetRequest = vi.fn()
const appState = { packaged: false }
vi.mock('electron', () => ({
  net: { request: (...a: unknown[]) => mockNetRequest(...a) },
  app: {
    get isPackaged() {
      return appState.packaged
    }
  },
  Notification: class {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  transcribeAudio,
  transcribeConversation,
  buildCleanupCandidates,
  __resetCleanupCandidatesCacheForTests
} from '../src/main/transcribe'

const WAV_BUF = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')])
const AUDIO = Buffer.from('webm-audio')

beforeEach(() => {
  vi.clearAllMocks()
  __resetCleanupCandidatesCacheForTests()
  appState.packaged = false
  settings = {}
  mockGetEffectiveSettings.mockImplementation(() => settings)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Net-based clients: timeout / error / redirect / settle-once
// ---------------------------------------------------------------------------

interface NetClientCase {
  name: string
  provider: string
  label: string
  setup: () => void
  run: () => Promise<unknown>
}

const NET_CLIENTS: NetClientCase[] = [
  {
    name: 'OpenAI STT (whisperTranscribe)',
    provider: 'openai',
    label: 'OpenAI',
    setup: () => (settings = { providerChain: ['openai'], openaiApiKey: 'sk' }),
    run: () => transcribeAudio(AUDIO, 'a.webm')
  },
  {
    name: 'ElevenLabs STT',
    provider: 'elevenlabs',
    label: 'ElevenLabs',
    setup: () => (settings = { providerChain: ['elevenlabs'], elevenlabsApiKey: 'el' }),
    run: () => transcribeAudio(AUDIO, 'a.webm')
  },
  {
    name: 'ElevenLabs diarized (conversation)',
    provider: 'elevenlabs',
    label: 'ElevenLabs',
    setup: () => (settings = { elevenlabsApiKey: 'el' }),
    run: () => transcribeConversation(AUDIO, 'a.webm')
  },
  {
    name: 'OpenAI diarized (conversation)',
    provider: 'openai',
    label: 'OpenAI',
    setup: () => (settings = { openaiApiKey: 'sk' }),
    run: () => transcribeConversation(AUDIO, 'a.webm')
  }
]

describe.each(NET_CLIENTS)('$name fail-soft paths', ({ provider, label, setup, run }) => {
  beforeEach(setup)

  it('times out after 45s, aborts the request and records the error', async () => {
    vi.useFakeTimers()
    const req = scriptedNetRequest()
    mockNetRequest.mockReturnValue(req)

    const p = run()
    const assertion = expect(p).rejects.toThrow(`${label} transcription request timed out after 45s`)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
    expect(req.abort).toHaveBeenCalledTimes(1)
    expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), provider)
    expect(mockNotifyFailure).toHaveBeenCalledTimes(1)
  })

  it('rejects with the network error on a request-level error (offline)', async () => {
    const netErr = new Error('net::ERR_INTERNET_DISCONNECTED')
    mockNetRequest.mockReturnValue(scriptedNetRequest((c) => c.emitRequest('error', netErr)))

    await expect(run()).rejects.toBe(netErr)
    expect(mockRecordError).toHaveBeenCalledWith(netErr, provider)
  })

  it('rejects with the stream error on a response-level error', async () => {
    const streamErr = new Error('ECONNRESET')
    mockNetRequest.mockReturnValue(scriptedNetRequest((c) => c.response(200).emit('error', streamErr)))

    await expect(run()).rejects.toBe(streamErr)
    expect(mockRecordError).toHaveBeenCalledWith(streamErr, provider)
  })

  it('refuses a cross-host redirect (would leak key + audio) and aborts', async () => {
    const req = scriptedNetRequest((c) => c.emitRequest('redirect', 302, 'POST', 'https://attacker.example/x'))
    mockNetRequest.mockReturnValue(req)

    await expect(run()).rejects.toThrow(/Blocked redirect/)
    expect(req.abort).toHaveBeenCalled()
    expect(req.followRedirect).not.toHaveBeenCalled()
  })

  it('refuses an https -> http downgrade redirect', async () => {
    const req = scriptedNetRequest((c) => c.emitRequest('redirect', 301, 'POST', 'http://api.example.com/x'))
    mockNetRequest.mockReturnValue(req)
    await expect(run()).rejects.toThrow(/Blocked redirect/)
  })

  it('keeps the first outcome when a late error follows an HTTP error', async () => {
    mockNetRequest.mockReturnValue(
      scriptedNetRequest((c) => {
        c.respond(503, 'unavailable')
        c.emitRequest('error', new Error('late'))
      })
    )
    await expect(run()).rejects.toThrow(`${label} API error 503`)
  })

  it('rejects a 200 whose body is not JSON', async () => {
    mockNetRequest.mockReturnValue(scriptedNetRequest((c) => c.respond(200, '<html>oops</html>')))
    await expect(run()).rejects.toThrow('Failed to parse transcription response (HTTP 200)')
  })

  it('does not log the error body in packaged builds', async () => {
    appState.packaged = true
    mockNetRequest.mockReturnValue(scriptedNetRequest((c) => c.respond(401, 'secret-body')))
    await expect(run()).rejects.toThrow(`${label} API error 401`)
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('diarized response shape fallbacks', () => {
  it('ElevenLabs: defaults a missing word type to "word" and builds segments', async () => {
    settings = { elevenlabsApiKey: 'el' }
    mockNetRequest.mockReturnValue(
      scriptedNetRequest((c) =>
        c.respond(
          200,
          JSON.stringify({ text: 'ignored', words: [{ text: 'Hello', start: 0, end: 1, speaker_id: 'speaker_0' }] })
        )
      )
    )
    const r = await transcribeConversation(AUDIO, 'a.webm')
    expect(r.segments.length).toBe(1)
    expect(r.text).toContain('Hello')
  })

  it('ElevenLabs: falls back to data.text when no words are returned', async () => {
    settings = { elevenlabsApiKey: 'el' }
    mockNetRequest.mockReturnValue(scriptedNetRequest((c) => c.respond(200, JSON.stringify({ text: 'flat text' }))))
    await expect(transcribeConversation(AUDIO, 'a.webm')).resolves.toEqual({ segments: [], text: 'flat text' })
  })

  it('ElevenLabs: resolves empty text when neither words nor text are present', async () => {
    settings = { elevenlabsApiKey: 'el' }
    mockNetRequest.mockReturnValue(scriptedNetRequest((c) => c.respond(200, '{}')))
    await expect(transcribeConversation(AUDIO, 'a.webm')).resolves.toEqual({ segments: [], text: '' })
  })

  it('OpenAI: falls back to data.text / empty string without segments', async () => {
    settings = { openaiApiKey: 'sk' }
    mockNetRequest.mockReturnValueOnce(scriptedNetRequest((c) => c.respond(200, JSON.stringify({ text: 'flat' }))))
    await expect(transcribeConversation(AUDIO, 'a.webm')).resolves.toEqual({ segments: [], text: 'flat' })

    mockNetRequest.mockReturnValueOnce(scriptedNetRequest((c) => c.respond(200, '{}')))
    await expect(transcribeConversation(AUDIO, 'a.webm')).resolves.toEqual({ segments: [], text: '' })
  })

  it('sends language_code / language only when not auto', async () => {
    settings = { elevenlabsApiKey: 'el', transcriptionLanguage: 'pl', customVocabulary: 'Kubernetes, , Vitest' }
    const req = scriptedNetRequest((c) => c.respond(200, '{}'))
    mockNetRequest.mockReturnValue(req)
    await transcribeConversation(AUDIO, 'a.webm')
    const body = (req.write.mock.calls[0][0] as Buffer).toString()
    expect(body).toContain('name="language_code"')
    expect(body.match(/name="keyterms"/g)?.length).toBe(2)

    settings = { openaiApiKey: 'sk', transcriptionLanguage: 'de' }
    const req2 = scriptedNetRequest((c) => c.respond(200, '{}'))
    mockNetRequest.mockReturnValue(req2)
    await transcribeConversation(AUDIO, 'a.webm')
    expect((req2.write.mock.calls[0][0] as Buffer).toString()).toContain('name="language"')
  })
})

describe('transcribeConversation wiring', () => {
  it('still transcribes and labels the toast "unknown" if the first settings read throws', async () => {
    mockGetEffectiveSettings
      .mockImplementationOnce(() => {
        throw new Error('keystore locked')
      })
      .mockImplementation(() => ({}))
    await expect(transcribeConversation(AUDIO, 'a.webm')).rejects.toThrow(/Add an ElevenLabs/)
    expect(mockNotifyFailure).toHaveBeenCalledWith([expect.objectContaining({ provider: 'unknown' })])
  })

  it('wraps a non-Error rejection for the failure toast and rethrows it unchanged', async () => {
    settings = { deepgramApiKey: 'dg' }
    mockDeepgramDiarized.mockRejectedValue('plain string failure')
    await expect(transcribeConversation(AUDIO, 'a.webm')).rejects.toBe('plain string failure')
    expect(mockNotifyFailure).toHaveBeenCalledWith([
      { provider: 'deepgram', message: 'plain string failure' }
    ])
  })

  it('passes default model/lang to Deepgram and AssemblyAI diarized clients', async () => {
    settings = { deepgramApiKey: 'dg', sttDeepgramModel: '  ' }
    mockDeepgramDiarized.mockResolvedValue({ segments: [], text: 'd' })
    await transcribeConversation(AUDIO, 'a.webm')
    expect(mockDeepgramDiarized).toHaveBeenCalledWith('dg', AUDIO, '', 'auto')

    settings = { assemblyaiApiKey: 'aa', sttAssemblyaiModel: 'best', transcriptionLanguage: 'fr' }
    mockAssemblyDiarized.mockResolvedValue({ segments: [], text: 'a' })
    await transcribeConversation(AUDIO, 'a.webm')
    expect(mockAssemblyDiarized).toHaveBeenCalledWith('aa', AUDIO, 'best', 'fr')
  })
})

// ---------------------------------------------------------------------------
// Provider chain: missing keys, configured checks, fallback bookkeeping
// ---------------------------------------------------------------------------

describe('transcribeAudio missing-key errors (descriptive first-hop error)', () => {
  it.each([
    ['groq', 'No Groq API key configured'],
    ['deepgram', 'No Deepgram API key configured'],
    ['assemblyai', 'No AssemblyAI API key configured'],
    ['mistral', 'No Mistral API key configured'],
    ['elevenlabs', 'No ElevenLabs API key configured'],
    ['replicate', 'No Replicate API key configured'],
    ['selfhosted', 'No self-hosted server URL configured']
  ])('%s without credentials throws "%s" and records it', async (provider, message) => {
    settings = { providerChain: [provider] }
    // selfhosted needs WAV to even be attempted
    await expect(transcribeAudio(WAV_BUF, 'a.wav')).rejects.toThrow(message)
    expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), provider)
    expect(mockNotifyFailure).toHaveBeenCalledTimes(1)
  })
})

describe('transcribeAudio provider wiring', () => {
  it('groq: passes trimmed model, vocab prompt and language', async () => {
    settings = {
      providerChain: ['groq'],
      groqApiKey: 'gsk',
      sttGroqModel: ' whisper-large-v3 ',
      transcriptionPrompt: 'P',
      customVocabulary: 'Vitest',
      transcriptionLanguage: 'en'
    }
    mockGroq.mockResolvedValue('groq text')
    await expect(transcribeAudio(AUDIO, 'a.webm')).resolves.toBe('groq text')
    const [key, , fname, prompt, model, lang] = mockGroq.mock.calls[0]
    expect([key, fname, model, lang]).toEqual(['gsk', 'a.webm', 'whisper-large-v3', 'en'])
    expect(prompt).toContain('Vitest')
    expect(mockRecordSTT).toHaveBeenCalledWith(expect.objectContaining({ provider: 'groq', isLocal: false }))
  })

  it('mistral / deepgram / assemblyai: default empty model and auto language', async () => {
    settings = { providerChain: ['mistral'], mistralApiKey: 'mk' }
    mockMistral.mockResolvedValue('m')
    await expect(transcribeAudio(AUDIO, 'a.webm')).resolves.toBe('m')
    expect(mockMistral).toHaveBeenCalledWith('mk', AUDIO, 'a.webm', '', '', 'auto')

    settings = { providerChain: ['deepgram'], deepgramApiKey: 'dg' }
    mockDeepgram.mockResolvedValue('d')
    await expect(transcribeAudio(AUDIO, 'a.webm')).resolves.toBe('d')
    expect(mockDeepgram).toHaveBeenCalledWith('dg', AUDIO, '', 'auto')

    settings = { providerChain: ['assemblyai'], assemblyaiApiKey: 'aa', sttAssemblyaiModel: 'nano' }
    mockAssembly.mockResolvedValue('a')
    await expect(transcribeAudio(AUDIO, 'a.webm')).resolves.toBe('a')
    expect(mockAssembly).toHaveBeenCalledWith('aa', AUDIO, 'nano', 'auto', undefined)
  })

  it('skips unconfigured providers and goes straight to the configured one', async () => {
    settings = { providerChain: ['groq', 'deepgram', 'assemblyai', 'mistral'], mistralApiKey: 'mk' }
    mockMistral.mockResolvedValue('only mistral')
    await expect(transcribeAudio(AUDIO, 'a.webm')).resolves.toBe('only mistral')
    expect(mockGroq).not.toHaveBeenCalled()
    expect(mockDeepgram).not.toHaveBeenCalled()
    expect(mockAssembly).not.toHaveBeenCalled()
  })

  it('falls through on failure and warns that the primary failed', async () => {
    settings = { providerChain: ['groq', 'deepgram'], groqApiKey: 'g', deepgramApiKey: 'd' }
    mockGroq.mockRejectedValue(new Error('Groq API error 500'))
    mockDeepgram.mockResolvedValue('from deepgram')
    await expect(transcribeAudio(AUDIO, 'a.webm')).resolves.toBe('from deepgram')
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/failed \(Groq API error 500\).*succeeded/))
    expect(mockNotifyFailure).not.toHaveBeenCalled()
  })

  it('wraps non-Error rejections and rethrows the FIRST error when the whole chain fails', async () => {
    settings = { providerChain: ['groq', 'mistral'], groqApiKey: 'g', mistralApiKey: 'm' }
    mockGroq.mockRejectedValue('groq exploded')
    mockMistral.mockRejectedValue(new Error('mistral down'))
    await expect(transcribeAudio(AUDIO, 'a.webm')).rejects.toThrow('groq exploded')
    expect(mockNotifyFailure).toHaveBeenCalledWith([
      { provider: 'groq', message: 'groq exploded' },
      { provider: 'mistral', message: 'mistral down' }
    ])
  })

  it('selfhosted: a failing on-demand local-server start does not block the request', async () => {
    settings = { providerChain: ['selfhosted'], openaiBaseUrl: 'http://127.0.0.1:8178' }
    mockEnsureServer.mockRejectedValue(new Error('binary missing'))
    const req = scriptedNetRequest((c) => c.respond(200, JSON.stringify({ text: 'local ok' })))
    mockNetRequest.mockReturnValue(req)

    await expect(transcribeAudio(AUDIO, 'a.webm', null, { buffer: WAV_BUF, filename: 'a.wav' })).resolves.toBe(
      'local ok'
    )
    expect(mockNetRequest).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:8178/inference' }))
    expect(console.warn).toHaveBeenCalledWith('[Whisperio] Could not ensure local whisper server:', expect.any(Error))
    expect(mockRecordSTT).toHaveBeenCalledWith(expect.objectContaining({ isLocal: true }))
  })

  it('selfhosted: no warning in packaged builds when the server start fails', async () => {
    appState.packaged = true
    settings = { providerChain: ['selfhosted'], openaiBaseUrl: 'http://127.0.0.1:8178', sttApiKey: ' tok ' }
    mockEnsureServer.mockRejectedValue(new Error('binary missing'))
    const req = scriptedNetRequest((c) => c.respond(200, JSON.stringify({ text: 'x' })))
    mockNetRequest.mockReturnValue(req)
    await transcribeAudio(WAV_BUF, 'a.wav')
    expect(console.warn).not.toHaveBeenCalled()
    expect(req.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer tok')
  })
})

// ---------------------------------------------------------------------------
// Replicate (fetch-based)
// ---------------------------------------------------------------------------

describe('replicate STT fail-soft paths', () => {
  beforeEach(() => {
    settings = { providerChain: ['replicate'], replicateApiKey: 'r8', transcriptionPrompt: 'Names: Ada' }
  })

  it('sends initial_prompt when a prompt is configured', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'succeeded', output: 'hi' }), { status: 200 }))
    await expect(transcribeAudio(AUDIO, 'a.webm')).resolves.toBe('hi')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.input.initial_prompt).toBe('Names: Ada')
  })

  it('wraps a non-Error fetch rejection and records it', async () => {
    mockFetch.mockRejectedValue('socket hang up')
    await expect(transcribeAudio(AUDIO, 'a.webm')).rejects.toThrow('socket hang up')
    expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), 'replicate')
  })

  it('logs the error body only in dev builds', async () => {
    mockFetch.mockResolvedValue(new Response('dev-body', { status: 500 }))
    await expect(transcribeAudio(AUDIO, 'a.webm')).rejects.toThrow('Replicate API error 500')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('dev-body'))

    vi.mocked(console.error).mockClear()
    appState.packaged = true
    mockFetch.mockResolvedValue(new Response('prod-body', { status: 500 }))
    await expect(transcribeAudio(AUDIO, 'a.webm')).rejects.toThrow('Replicate API error 500')
    expect(console.error).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// buildCleanupCandidates branch edges
// ---------------------------------------------------------------------------

describe('buildCleanupCandidates edges', () => {
  it('uses an explicit local aiBaseUrl when aiProvider is local', () => {
    const c = buildCleanupCandidates({ aiProvider: 'local', aiBaseUrl: 'http://127.0.0.1:9999' } as never)
    expect(c.map((p) => p.id)).toEqual(['local'])
  })

  it('adds an openai candidate for aiProvider=openai even without a key', () => {
    const c = buildCleanupCandidates({ aiProvider: 'openai' } as never)
    expect(c.map((p) => p.id)).toEqual(['openai', 'local'])
  })

  it('skips (fail-soft) a candidate whose base URL is insecure instead of throwing', () => {
    const c = buildCleanupCandidates({
      openaiApiKey: 'sk',
      aiBaseUrl: 'http://public.example.com'
    } as never)
    expect(c.map((p) => p.id)).not.toContain('openai')
    expect(console.warn).toHaveBeenCalledWith('[Whisperio] Skipping LLM cleanup provider:', expect.any(String))
  })
})
