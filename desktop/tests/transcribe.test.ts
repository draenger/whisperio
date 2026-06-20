import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args)
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

import { transcribeAudio } from '../src/main/transcribe'

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
      'Failed to parse response'
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
      'Failed to parse response'
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

describe('postProcessWithLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('post-processes transcript when aiPostProcessing enabled and vocab present', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git, GitHub',
      aiPostProcessing: true
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'i use get hub' }))
    const postReq = createMockNetRequest(
      200,
      JSON.stringify({ choices: [{ message: { content: 'I use GitHub' } }] })
    )
    mockNetRequest.mockReturnValueOnce(transcribeReq).mockReturnValueOnce(postReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('I use GitHub')
    expect(mockNetRequest).toHaveBeenCalledTimes(2)
    expect(mockNetRequest).toHaveBeenLastCalledWith({
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions'
    })
    const postBody = (postReq.write.mock.calls[0][0] as Buffer).toString()
    expect(postBody).toContain('gpt-4o-mini')
    expect(postBody).toContain('git, GitHub')
  })

  it('falls back to raw transcript when post-processing fails', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git',
      aiPostProcessing: true
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw text' }))
    const postReq = createMockNetRequest(500, '{"error":"chat down"}')
    mockNetRequest.mockReturnValueOnce(transcribeReq).mockReturnValueOnce(postReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('raw text')
  })

  it('falls back to raw transcript when post-process response is unparseable', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git',
      aiPostProcessing: true
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'raw fallback' }))
    const postReq = createMockNetRequest(200, 'not-json')
    mockNetRequest.mockReturnValueOnce(transcribeReq).mockReturnValueOnce(postReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('raw fallback')
  })

  it('returns raw text when post-process content is empty', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: 'git',
      aiPostProcessing: true
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'original' }))
    const postReq = createMockNetRequest(
      200,
      JSON.stringify({ choices: [{ message: { content: '   ' } }] })
    )
    mockNetRequest.mockReturnValueOnce(transcribeReq).mockReturnValueOnce(postReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('original')
  })

  it('skips post-processing when no vocabulary is set', async () => {
    mockLoadSettings.mockReturnValue({
      sttProvider: 'openai',
      openaiApiKey: 'sk-test',
      transcriptionPrompt: '',
      customVocabulary: '',
      aiPostProcessing: true
    })
    const transcribeReq = createMockNetRequest(200, JSON.stringify({ text: 'no post-process' }))
    mockNetRequest.mockReturnValue(transcribeReq)

    const result = await transcribeAudio(Buffer.from('audio'), 'rec.webm')
    expect(result).toBe('no post-process')
    expect(mockNetRequest).toHaveBeenCalledTimes(1)
  })
})
