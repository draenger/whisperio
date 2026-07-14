import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  // The default/soft-delete merge is unit-tested in settingsManager.test.ts.
  // Here we isolate the provider wire-format: the effective vocab is just the
  // custom terms the test supplies.
  getActiveVocabulary: (settings: { customVocabulary?: string }) =>
    settings.customVocabulary?.trim() || ''
}))

// Helper: create a mock net.request that resolves with given status + body
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

import { transcribeAudio, cleanupOnDemand } from '../src/main/transcribe'

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when API key is empty', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: '', transcriptionPrompt: '' })
    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'No OpenAI API key configured'
    )
  })

  it('builds correct multipart form data with file, model, and prompt', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: 'My prompt' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio-data'), 'recording.webm')

    const writtenBody = mockReq.write.mock.calls[0][0] as Buffer
    const bodyStr = writtenBody.toString()
    expect(bodyStr).toContain('name="file"')
    expect(bodyStr).toContain('filename="recording.webm"')
    expect(bodyStr).toContain('name="model"')
    expect(bodyStr).toContain('gpt-4o-transcribe')
    expect(bodyStr).toContain('name="prompt"')
    expect(bodyStr).toContain('My prompt')
  })

  it('sets Authorization header with Bearer token', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-mykey', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hi' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')
    expect(mockReq.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer sk-mykey')
  })

  it('throws on non-200 status code', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(401, '{"error":"unauthorized"}')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'OpenAI API error 401'
    )
  })

  it('throws on unparseable JSON response', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, 'not-json')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'Failed to parse transcription response'
    )
  })

  it('returns text from valid response', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'Hello world' }))
    mockNetRequest.mockReturnValue(mockReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'test.webm')
    expect(result).toBe('Hello world')
  })

  it('sends no prompt when transcriptionPrompt is empty', async () => {
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-test', transcriptionPrompt: '' })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).not.toContain('name="prompt"')
  })

  it('throws when ElevenLabs API key is empty', async () => {
    mockLoadSettings.mockReturnValue({ sttProvider: 'elevenlabs', elevenlabsApiKey: '' })
    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'No ElevenLabs API key configured'
    )
  })

  it('calls ElevenLabs API with correct URL, headers, and body when provider is elevenlabs', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'elevenlabs',
      elevenlabsApiKey: 'xi-test-key',
      customVocabulary: 'git, GitHub, Docker'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'transcribed text' }))
    mockNetRequest.mockReturnValue(mockReq)

    const result = await transcribeAudio(Buffer.from('audio-data'), 'recording.webm')

    expect(result).toBe('transcribed text')
    expect(mockNetRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://api.elevenlabs.io/v1/speech-to-text'
    })
    expect(mockReq.setHeader).toHaveBeenCalledWith('xi-api-key', 'xi-test-key')

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).toContain('name="file"')
    expect(bodyStr).toContain('filename="recording.webm"')
    expect(bodyStr).toContain('name="model_id"')
    expect(bodyStr).toContain('scribe_v2')
    expect(bodyStr.match(/name="keyterms"/g)?.length).toBe(3)
    expect(bodyStr).toContain('git')
    expect(bodyStr).toContain('GitHub')
    expect(bodyStr).toContain('Docker')
  })

  it('throws on non-200 ElevenLabs response', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'elevenlabs',
      elevenlabsApiKey: 'xi-test-key',
      customVocabulary: ''
    })
    const mockReq = createMockNetRequest(403, '{"error":"forbidden"}')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'ElevenLabs API error 403'
    )
  })

  it('throws on unparseable ElevenLabs JSON response', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'elevenlabs',
      elevenlabsApiKey: 'xi-test-key',
      customVocabulary: ''
    })
    const mockReq = createMockNetRequest(200, 'not-json-at-all')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'Failed to parse transcription response'
    )
  })

  it('adds language_code to ElevenLabs body when language is not auto', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'elevenlabs',
      elevenlabsApiKey: 'xi-test-key',
      customVocabulary: 'foo, bar',
      transcriptionLanguage: 'pl'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).toContain('name="language_code"')
    expect(bodyStr).toContain('pl')
    // multiple comma-separated keyterms splitting
    expect(bodyStr.match(/name="keyterms"/g)?.length).toBe(2)
    expect(bodyStr).toContain('foo')
    expect(bodyStr).toContain('bar')
  })
})

describe('selfhosted (directUrl) provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses /inference endpoint for non-v1 base url and sends response_format/temperature', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'http://localhost:8080',
      whisperModel: 'ggml-base',
      transcriptionPrompt: 'ctx'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'local text' }))
    mockNetRequest.mockReturnValue(mockReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('local text')
    expect(mockNetRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'http://localhost:8080/inference'
    })

    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).toContain('name="response_format"')
    expect(bodyStr).toContain('json')
    expect(bodyStr).toContain('name="temperature"')
    // directUrl path must NOT send model/prompt fields
    expect(bodyStr).not.toContain('name="model"')
    expect(bodyStr).not.toContain('name="prompt"')
    // no Authorization header since apiKey is ''
    expect(mockReq.setHeader).not.toHaveBeenCalledWith('Authorization', expect.anything())
  })

  it('uses /audio/transcriptions endpoint when base url contains /v1', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'http://localhost:1234/v1'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'v1 text' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(mockNetRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'http://localhost:1234/v1/audio/transcriptions'
    })
  })

  it('adds language field to whisper body when language is not auto', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'http://localhost:8080',
      transcriptionLanguage: 'en'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    const bodyStr = (mockReq.write.mock.calls[0][0] as Buffer).toString()
    expect(bodyStr).toContain('name="language"')
    expect(bodyStr).toContain('en')
  })

  it('reports selfhosted error on non-200 from self-hosted server', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'http://localhost:8080'
    })
    const mockReq = createMockNetRequest(500, 'boom')
    mockNetRequest.mockReturnValue(mockReq)

    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow(
      'OpenAI API error 500'
    )
  })

  it('throws when self-hosted base url is missing', async () => {
    mockLoadSettings.mockReturnValue({ sttProvider: 'selfhosted', openaiBaseUrl: '' })
    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow(
      'No self-hosted server URL configured'
    )
  })

  it('adds Authorization Bearer header when sttApiKey is set for a private self-hosted server', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'http://localhost:8080',
      sttApiKey: 'priv-secret-key'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(mockReq.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer priv-secret-key')
  })

  it('sends no Authorization header when sttApiKey is unset (unchanged default behavior)', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'http://localhost:8080',
      sttApiKey: ''
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(mockReq.setHeader).not.toHaveBeenCalledWith('Authorization', expect.anything())
  })

  it('rejects (and never calls net.request) a self-hosted URL that is http:// on a public host', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'http://example.com:8080',
      fallbackEnabled: false
    })

    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow(
      'must use https://'
    )
    expect(mockNetRequest).not.toHaveBeenCalled()
  })

  it('allows http:// self-hosted URLs on loopback/private hosts (127.x, 10.x, 192.168.x, .local)', async () => {
    for (const host of ['127.0.0.1:8080', '10.0.0.5:8080', '192.168.1.20:8080', 'mybox.local:8080']) {
      mockNetRequest.mockClear()
      mockLoadSettings.mockReturnValue({
        sttProvider: 'selfhosted',
        openaiBaseUrl: `http://${host}`
      })
      const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'ok' }))
      mockNetRequest.mockReturnValue(mockReq)

      const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
      expect(result).toBe('ok')
      expect(mockNetRequest).toHaveBeenCalledWith({ method: 'POST', url: `http://${host}/inference` })
    }
  })

  it('allows https:// self-hosted URLs on public hosts', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'selfhosted',
      openaiBaseUrl: 'https://my-private-whisper.example.com'
    })
    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'secure ok' }))
    mockNetRequest.mockReturnValue(mockReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('secure ok')
  })
})

// STT+ (v1.5): Replicate-hosted Whisper provider. Unlike the other STT
// providers in this file (which go through electron's `net.request`),
// replicateTranscribe uses global `fetch` — mirroring llm/provider.ts's
// fetch-based providers — so these tests stub `fetch` instead of net.request.
describe('replicate provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when the Replicate API key is empty', async () => {
    mockLoadSettings.mockReturnValue({ sttProvider: 'openai', providerChain: ['replicate'], replicateApiKey: '' })
    await expect(transcribeAudio(Buffer.from('audio'), 'test.webm')).rejects.toThrow(
      'No Replicate API key configured'
    )
  })

  it('posts to the model predictions URL with Prefer: wait, Bearer auth, and a base64 data URI', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate'],
      replicateApiKey: 'r8_test_key',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'succeeded', output: { transcription: 'hello from replicate' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio-bytes'), 'rec.webm')

    expect(result).toBe('hello from replicate')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.replicate.com/v1/models/openai/whisper/predictions')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer r8_test_key')
    expect(headers.Prefer).toBe('wait')
    const body = JSON.parse(init.body as string)
    const expectedDataUri = `data:audio/webm;base64,${Buffer.from('audio-bytes').toString('base64')}`
    expect(body.input.audio).toBe(expectedDataUri)
  })

  it('uses the user-configured sttReplicateModel instead of the default', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate'],
      replicateApiKey: 'r8_test_key',
      sttReplicateModel: 'vaibhavs10/incredibly-fast-whisper',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'succeeded', output: { text: 'fast whisper text' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    expect(result).toBe('fast whisper text')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://api.replicate.com/v1/models/vaibhavs10/incredibly-fast-whisper/predictions')
  })

  it('parses a plain-string output shape', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate'],
      replicateApiKey: 'r8_test_key',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'succeeded', output: 'bare string transcript' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('bare string transcript')
  })

  it('falls back to the next provider in the chain when Replicate errors', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate', 'openai'],
      replicateApiKey: 'r8_test_key',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error'
    })
    vi.stubGlobal('fetch', fetchMock)
    const netReq = createMockNetRequest(200, JSON.stringify({ text: 'fallback openai text' }))
    mockNetRequest.mockReturnValue(netReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    expect(result).toBe('fallback openai text')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
  })

  it('treats a non-succeeded status (e.g. still "processing") as a failure so the chain can fall back', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate', 'openai'],
      replicateApiKey: 'r8_test_key',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'processing', output: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    const netReq = createMockNetRequest(200, JSON.stringify({ text: 'fallback text' }))
    mockNetRequest.mockReturnValue(netReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('fallback text')
  })

  it('treats an unparseable response body as a failure', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate'],
      replicateApiKey: 'r8_test_key',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not-json'
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow(
      'Failed to parse Replicate response'
    )
  })

  it('fails soft (rejects) when the fetch call itself throws (e.g. network unreachable)', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate'],
      replicateApiKey: 'r8_test_key',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow('network down')
  })

  it('throws a descriptive error when the response has no recognizable transcription shape', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate'],
      replicateApiKey: 'r8_test_key',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'succeeded', output: { segments: [] } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow(
      'Replicate response did not contain a transcription'
    )
  })

  it('includes a language input field only when transcriptionLanguage is not auto', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['replicate'],
      replicateApiKey: 'r8_test_key',
      transcriptionLanguage: 'pl',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'succeeded', output: { transcription: 'ok' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.input.language).toBe('pl')
  })
})

describe('isProviderConfigured edges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats openai as configured via openaiBaseUrl even without api key, then fails at key check', async () => {
    // openai is "configured" by base url, so chain keeps it; but transcribeWithProvider
    // requires an apiKey for openai provider -> throws missing-key error.
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: '',
      openaiBaseUrl: 'http://localhost:9000',
      fallbackEnabled: false
    })
    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow(
      'No OpenAI API key configured'
    )
  })

  it('uses providerChain when set, filtering unconfigured providers', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['elevenlabs', 'openai'],
      elevenlabsApiKey: '',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: ''
    })
    const successReq = createMockNetRequest(200, JSON.stringify({ text: 'chain result' }))
    mockNetRequest.mockReturnValue(successReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    // elevenlabs filtered out (no key), openai used
    expect(result).toBe('chain result')
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
  })

  it('falls back to first provider in chain when none configured to surface descriptive error', async () => {
    mockLoadSettings.mockReturnValue({
      providerChain: ['elevenlabs'],
      elevenlabsApiKey: ''
    })
    await expect(transcribeAudio(Buffer.from('audio'), 'rec.webm')).rejects.toThrow(
      'No ElevenLabs API key configured'
    )
  })
})

// AI cleanup (v1.4 Work Item A) is now wired through the LLMProvider
// abstraction (llm/provider.ts, via global `fetch`) instead of an inline
// `net.request` call — see postprocess.test.ts for the cleanup logic itself
// (guard rails, prompt modes, abort handling). These tests cover only the
// wiring in transcribeAudio(): when cleanup runs at all, how the provider is
// selected from settings, and the dictation-cycle abort behavior.
describe('AI cleanup wiring (transcribeAudio)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cleans up the transcript through the configured LLM provider when cleanupAuto is on', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git, GitHub',
      cleanupAuto: true,
      cleanupMode: 'full',
      aiProvider: 'openai'
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'i use get hub' }))
    mockNetRequest.mockReturnValueOnce(transcribeReq)

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'I use GitHub' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    expect(result).toBe('I use GitHub')
    // The STT call still goes through net.request; cleanup goes through fetch
    // (LLMProvider) — never a second net.request call (invariant: zero inline
    // fetch to an LLM in feature code).
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
    const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
    expect(completionCall).toBeDefined()
    const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
    expect(JSON.stringify(body)).toContain('git, GitHub')
    expect(body.temperature).toBe(0.2)
  })

  it('does not run cleanup when cleanupAuto is unset (legacy aiPostProcessing alone no longer triggers it)', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git',
      aiPostProcessing: true // real loadSettings() would have migrated this; the mock here does not
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw text' }))
    mockNetRequest.mockReturnValueOnce(transcribeReq)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    expect(result).toBe('raw text')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not run cleanup when cleanupAuto is true but cleanupEnabled is false (on-demand-only gate has no bearing on auto)', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git, GitHub',
      cleanupEnabled: false,
      cleanupAuto: true,
      cleanupMode: 'full',
      aiProvider: 'openai'
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'i use get hub' }))
    mockNetRequest.mockReturnValueOnce(transcribeReq)

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'I use GitHub' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    // cleanupAuto alone drives the auto path — cleanupEnabled (on-demand
    // availability) has no bearing on it.
    expect(result).toBe('I use GitHub')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('skips cleanup when cleanupMode is "off" even though cleanupAuto is true', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git',
      cleanupAuto: true,
      cleanupMode: 'off',
      aiProvider: 'openai'
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw text' }))
    mockNetRequest.mockReturnValueOnce(transcribeReq)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    expect(result).toBe('raw text')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the raw transcript, without throwing, when no LLM provider is reachable (offline)', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git',
      cleanupAuto: true,
      cleanupMode: 'full',
      aiProvider: 'openai'
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw text' }))
    mockNetRequest.mockReturnValueOnce(transcribeReq)
    // Every reachability check (configured provider + local fallback) fails —
    // simulates being fully offline. selectProvider must resolve to null and
    // cleanupTranscription must fall back to raw rather than reject.
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    expect(result).toBe('raw text')
  })

  it('cleans up through the Replicate LLM provider when aiProvider is "replicate" (buildCleanupCandidates includes it, selectProvider picks it)', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      cleanupAuto: true,
      cleanupMode: 'full',
      aiProvider: 'replicate',
      replicateApiKey: 'r8_test_key'
    })
    // Kept close in length to the cleaned output below — cleanupTranscription's
    // hallucination guard (postprocess.ts) falls back to raw when the cleaned
    // text is much longer than the raw input.
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'i use get hub' }))
    mockNetRequest.mockReturnValueOnce(transcribeReq)

    // Same shape whether this is the availability GET (only `.ok` is read) or
    // the completion POST (only `.json()` is read) — see the equivalent
    // single-shared-mock pattern in the cleanupOnDemand tests below.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output: 'I use GitHub' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')

    expect(result).toBe('I use GitHub')
    // STT still goes through net.request; cleanup goes through fetch, and
    // specifically to Replicate's predictions endpoint (not OpenAI/Anthropic's),
    // confirming selectProvider() resolved the 'replicate' candidate that
    // buildCleanupCandidates() only adds when replicateApiKey is set.
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
    const predictionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/predictions'))
    expect(predictionCall).toBeDefined()
    const [url, init] = predictionCall as [string, RequestInit]
    expect(url).toBe('https://api.replicate.com/v1/models/meta/meta-llama-3-8b-instruct/predictions')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer r8_test_key')
  })

  it('aborts a still-pending cleanup call when a new dictation cycle starts', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git',
      cleanupAuto: true,
      cleanupMode: 'full',
      aiProvider: 'openai'
    })
    mockNetRequest
      .mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'first raw' })))
      .mockReturnValueOnce(createMockNetRequest(200, JSON.stringify({ text: 'second raw' })))

    let firstSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const isCompletion = init?.method === 'POST'
      if (isCompletion && !firstSignal) {
        // First dictation's cleanup call — hang until aborted by the second
        // dictation cycle starting, mirroring a slow/never-returning LLM call.
        firstSignal = init?.signal as AbortSignal
        return new Promise((_resolve, reject) => {
          firstSignal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      }
      if (isCompletion) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: 'second cleaned' } }] })
        })
      }
      // available() reachability check (GET)
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstPromise = transcribeAudio(Buffer.from('a1'), 'a1.webm')
    await vi.waitFor(() => {
      expect(firstSignal).toBeDefined()
    })

    const secondPromise = transcribeAudio(Buffer.from('a2'), 'a2.webm')
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise])

    expect(firstSignal?.aborted).toBe(true)
    // The aborted call falls back to its own raw transcript (fail-soft) —
    // the dictation session-id check (hotkeyManager.ts) is what actually
    // drops it from being pasted, not this promise rejecting.
    expect(firstResult).toBe('first raw')
    expect(secondResult).toBe('second cleaned')
  })

  // Context-aware tone (v1.5 Work Item B): transcribeAudio() never captures
  // context itself — it only resolves settings.contextAwareTone + whatever
  // DictationContext the CALLER (main/index.ts) hands it into the cleanup
  // prompt's tone slot. These tests exercise that resolution directly via the
  // 3rd argument, without needing to mock active-win/context.ts at all.
  describe('context-aware tone (applyCleanup wiring)', () => {
    it('resolves the matching tone profile from a passed-in context and injects it', async () => {
      mockLoadSettings.mockReturnValue({
        sttProvider: 'openai',
        openaiApiKey: 'sk-test',
        transcriptionPrompt: '',
        customVocabulary: '',
        cleanupAuto: true,
        cleanupMode: 'full',
        aiProvider: 'openai',
        contextAwareTone: true,
        toneMap: { slack: 'casual' }
      })
      const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw text' }))
      mockNetRequest.mockReturnValueOnce(transcribeReq)
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'yo, cleaned' } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await transcribeAudio(Buffer.from('audio'), 'rec.webm', { processName: 'Slack', windowTitle: '#general' })

      const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
      const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
      expect(JSON.stringify(body)).toContain('relaxed register')
    })

    it('never injects a tone when contextAwareTone is off, even with a matching context', async () => {
      mockLoadSettings.mockReturnValue({
        sttProvider: 'openai',
        openaiApiKey: 'sk-test',
        transcriptionPrompt: '',
        customVocabulary: '',
        cleanupAuto: true,
        cleanupMode: 'full',
        aiProvider: 'openai',
        contextAwareTone: false,
        toneMap: { slack: 'casual' }
      })
      const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw text' }))
      mockNetRequest.mockReturnValueOnce(transcribeReq)
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Cleaned.' } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await transcribeAudio(Buffer.from('audio'), 'rec.webm', { processName: 'Slack', windowTitle: '#general' })

      const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
      const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
      expect(JSON.stringify(body)).toContain('Tone profile: (none)')
    })

    it('defaults context to null (no tone) when the 3rd argument is omitted — existing callers keep working unchanged', async () => {
      mockLoadSettings.mockReturnValue({
        sttProvider: 'openai',
        openaiApiKey: 'sk-test',
        transcriptionPrompt: '',
        customVocabulary: '',
        cleanupAuto: true,
        cleanupMode: 'full',
        aiProvider: 'openai',
        contextAwareTone: true,
        toneMap: { slack: 'casual' }
      })
      const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw text' }))
      mockNetRequest.mockReturnValueOnce(transcribeReq)
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Cleaned.' } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await transcribeAudio(Buffer.from('audio'), 'rec.webm')

      const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
      const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
      // No context passed -> resolveToneProfile(null, ...) -> 'neutral', not "(none)".
      expect(JSON.stringify(body)).toContain('balanced, plain register')
    })
  })
})

// ROUGH-FIRST UX (v1.4 PR2): on-demand cleanup for an already-saved recording
// (RecordingsPanel's "Clean up" action), independent of the dictation-cycle
// abort wiring covered above.
describe('cleanupOnDemand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const templates = [
    { id: 'email', name: 'Email', prompt: 'Reformat as an email.' },
    { id: 'notes', name: 'Notes', prompt: 'Reformat as bullet notes.' }
  ]

  it('applies a template by id and reports cleanedWith as the template name', async () => {
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: true,
      openaiApiKey: 'sk-test',
      aiProvider: 'openai',
      cleanupTemplates: templates
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Dear team, ...' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', { templateId: 'email' })

    expect(result).toEqual({ text: 'Dear team, ...', ok: true, cleanedWith: 'Email' })
    const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
    const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
    expect(JSON.stringify(body)).toContain('Reformat as an email.')
  })

  it('a custom instruction takes priority over templateId/mode', async () => {
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: true,
      openaiApiKey: 'sk-test',
      aiProvider: 'openai',
      cleanupTemplates: templates
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Summarized text' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', {
      templateId: 'email',
      customInstruction: 'Summarize in one sentence'
    })

    expect(result).toEqual({ text: 'Summarized text', ok: true, cleanedWith: 'Custom instruction' })
    const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
    const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
    expect(JSON.stringify(body)).toContain('Summarize in one sentence')
  })

  it('falls back to raw with cleanedWith "unknown template" for a stale/unknown templateId', async () => {
    mockLoadSettings.mockReturnValue({ cleanupEnabled: true, openaiApiKey: 'sk-test', aiProvider: 'openai', cleanupTemplates: templates })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', { templateId: 'does-not-exist' })

    expect(result).toEqual({ text: 'raw transcript', ok: false, cleanedWith: 'unknown template' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaults to mode "full" when no mode/template/instruction is given', async () => {
    mockLoadSettings.mockReturnValue({ cleanupEnabled: true, openaiApiKey: 'sk-test', aiProvider: 'openai', cleanupTemplates: [] })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Cleaned.' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', {})

    expect(result).toEqual({ text: 'Cleaned.', ok: true, cleanedWith: 'full' })
  })

  it('treats mode "off" as "full" for an explicit on-demand request (never a no-op)', async () => {
    mockLoadSettings.mockReturnValue({ cleanupEnabled: true, openaiApiKey: 'sk-test', aiProvider: 'openai', cleanupTemplates: [] })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Cleaned.' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', { mode: 'off' })

    expect(result).toEqual({ text: 'Cleaned.', ok: true, cleanedWith: 'full' })
  })

  it('fails soft (ok: false, raw kept) when no provider is reachable', async () => {
    mockLoadSettings.mockReturnValue({ cleanupEnabled: true, openaiApiKey: 'sk-test', aiProvider: 'openai', cleanupTemplates: [] })
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', { mode: 'full' })

    expect(result).toEqual({ text: 'raw transcript', ok: false, cleanedWith: 'full' })
  })

  it('on-demand cleanup calls Replicate (not silently falling back to local) when aiProvider is "replicate"', async () => {
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: true,
      aiProvider: 'replicate',
      replicateApiKey: 'r8_test_key',
      cleanupTemplates: []
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output: 'Cleaned via Replicate.' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('this is the raw transcript text', { mode: 'full' })

    expect(result).toEqual({ text: 'Cleaned via Replicate.', ok: true, cleanedWith: 'full' })
    const predictionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/predictions'))
    expect(predictionCall).toBeDefined()
    expect((predictionCall as [string])[0]).toBe(
      'https://api.replicate.com/v1/models/meta/meta-llama-3-8b-instruct/predictions'
    )
  })

  // Desktop parity fix: "Enable AI cleanup" (settings.cleanupEnabled) must
  // actually gate the on-demand "Clean up" action end-to-end, not just the
  // renderer's button visibility — a defensive guard here means a stale
  // renderer, a future caller, or a race between toggling the setting off
  // and an in-flight IPC call can never still reach an LLM provider.
  it('returns the disabled-guard result (never touching a provider) when settings.cleanupEnabled is false', async () => {
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: false,
      openaiApiKey: 'sk-test',
      aiProvider: 'openai',
      cleanupTemplates: templates
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', { mode: 'full' })

    expect(result).toEqual({ text: 'raw transcript', ok: false, cleanedWith: 'cleanup disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the disabled guard takes priority over a template/custom instruction too — nothing bypasses it', async () => {
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: false,
      openaiApiKey: 'sk-test',
      aiProvider: 'openai',
      cleanupTemplates: templates
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupOnDemand('raw transcript', { templateId: 'email' })

    expect(result).toEqual({ text: 'raw transcript', ok: false, cleanedWith: 'cleanup disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
