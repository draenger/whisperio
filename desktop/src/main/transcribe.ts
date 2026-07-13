import { net, app } from 'electron'
import { loadSettings, AppSettings, getActiveVocabulary, type ProviderId } from './settingsManager'
import { handleTranscriptionError, notifyInfo } from './errorHandler'
import { OpenAICompatibleProvider, AnthropicProvider, selectProvider, type LLMProvider } from './llm/provider'
import { cleanupTranscription } from './postprocess'
import { getServerStatus } from './localServer'

// True only in unpackaged (development) builds. Used to gate logging of
// privacy-sensitive transcript content so it never reaches production stdout.
// Guarded so it degrades to `false` (no logging) if `app` is unavailable.
function isDev(): boolean {
  try {
    return !app.isPackaged
  } catch {
    return false
  }
}

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
const DEFAULT_PROMPT = ''
const DEFAULT_MODEL = 'gpt-4o-transcribe'
const SELFHOSTED_MODEL = 'whisper-1'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  selfhosted: 'Local Model'
}

interface TranscribeResult {
  text: string
}

// Default models used when the user leaves `aiModel` blank — one sensible
// choice per provider flavor rather than a single global default, since
// OpenAI/Anthropic/local-server model namespaces don't overlap.
const DEFAULT_CLEANUP_MODEL = 'gpt-4o-mini'
const DEFAULT_ANTHROPIC_CLEANUP_MODEL = 'claude-3-5-haiku-20241022'
const DEFAULT_LOCAL_CLEANUP_MODEL = 'local-model'

/**
 * Build the LLM candidates for transcript cleanup from settings, per the
 * DI contract in llm/provider.ts — this is the ONLY place transcribe.ts
 * decides which backends exist; `selectProvider` (STEP1) then picks one and
 * `cleanupTranscription` (this module's postprocess.ts sibling) does the
 * actual call. No inline fetch here or anywhere downstream.
 */
function buildCleanupCandidates(settings: AppSettings): LLMProvider[] {
  const candidates: LLMProvider[] = []
  const baseUrl = settings.aiBaseUrl?.trim() || ''
  const model = settings.aiModel?.trim() || ''

  if (settings.openaiApiKey || settings.aiProvider === 'openai') {
    candidates.push(
      new OpenAICompatibleProvider({
        id: 'openai',
        baseUrl: baseUrl || 'https://api.openai.com',
        apiKey: settings.openaiApiKey || undefined,
        model: model || DEFAULT_CLEANUP_MODEL
      })
    )
  }

  if (settings.anthropicApiKey) {
    candidates.push(
      new AnthropicProvider({
        id: 'anthropic',
        apiKey: settings.anthropicApiKey,
        model: model || DEFAULT_ANTHROPIC_CLEANUP_MODEL
      })
    )
  }

  // Local candidate: an offline-safe fallback (STEP1 selectProvider falls back
  // to it when the configured remote provider is unreachable), and the
  // primary candidate when aiProvider === 'local'. Default to the app's own
  // local model server's port (see localServer.ts) when the user hasn't set
  // an explicit aiBaseUrl for it.
  const localBaseUrl =
    settings.aiProvider === 'local' && baseUrl ? baseUrl : `http://127.0.0.1:${getServerStatus().port}`
  candidates.push(
    new OpenAICompatibleProvider({
      id: 'local',
      baseUrl: localBaseUrl,
      model: model || DEFAULT_LOCAL_CLEANUP_MODEL
    })
  )

  return candidates
}

// Tied to the dictation cycle, NOT to any single transcribeAudio() call: a
// new dictation starting while a previous one's cleanup call is still in
// flight aborts that older call. cleanupTranscription() (postprocess.ts)
// treats an aborted call as fail-soft and returns its own raw transcript, so
// the older transcribeAudio() promise still resolves normally — the
// dictation session-id check in dictation/hotkeyManager.ts is what actually
// drops the stale result from being pasted.
let activeCleanupAbort: AbortController | null = null

async function applyCleanup(settings: AppSettings, raw: string): Promise<string> {
  if (!settings.cleanupEnabled || settings.cleanupMode === 'off') {
    return raw
  }

  activeCleanupAbort?.abort()
  const controller = new AbortController()
  activeCleanupAbort = controller

  try {
    const vocab = getActiveVocabulary(settings)
    const provider = await selectProvider(settings, buildCleanupCandidates(settings))
    return await cleanupTranscription(raw, {
      cleanupMode: settings.cleanupMode,
      vocab,
      // Tone profile isn't wired to settings yet (Work Item B).
      tone: undefined,
      provider,
      signal: controller.signal
    })
  } finally {
    if (activeCleanupAbort === controller) {
      activeCleanupAbort = null
    }
  }
}

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<string> {
  const settings = loadSettings()

  // Build effective chain: use providerChain if set, otherwise legacy sttProvider + fallback
  let chain: ProviderId[]
  if (settings.providerChain && settings.providerChain.length > 0) {
    chain = settings.providerChain
  } else {
    chain = [settings.sttProvider || 'openai']
    if (settings.fallbackEnabled) {
      const fallback: ProviderId = settings.sttProvider === 'openai' ? 'elevenlabs' : 'openai'
      chain.push(fallback)
    }
  }

  // Filter to only configured providers, but keep at least the first one to get a proper error
  const configuredChain = chain.filter((p) => isProviderConfigured(settings, p))
  if (configuredChain.length === 0) {
    // Try the first provider anyway — it will throw a descriptive error
    configuredChain.push(chain[0])
  }

  let firstError: Error | null = null

  for (let i = 0; i < configuredChain.length; i++) {
    const provider = configuredChain[i]
    try {
      const text = await transcribeWithProvider(settings, provider, audioBuffer, filename)
      return await applyCleanup(settings, text)
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err : new Error(String(err))
      if (i < configuredChain.length - 1) {
        const next = configuredChain[i + 1]
        notifyInfo('Whisperio', `${PROVIDER_LABELS[provider]} failed. Trying ${PROVIDER_LABELS[next]}...`)
      }
    }
  }

  throw firstError || new Error('No providers configured. Open Settings to set up a provider.')
}

function isProviderConfigured(settings: AppSettings, provider: ProviderId): boolean {
  if (provider === 'openai') return !!(settings.openaiApiKey || settings.openaiBaseUrl?.trim())
  if (provider === 'elevenlabs') return !!settings.elevenlabsApiKey
  if (provider === 'selfhosted') return !!settings.openaiBaseUrl?.trim()
  return false
}

async function transcribeWithProvider(
  settings: AppSettings,
  provider: ProviderId,
  audioBuffer: Buffer,
  filename: string
): Promise<string> {
  if (provider === 'elevenlabs') {
    const apiKey = settings.elevenlabsApiKey
    if (!apiKey) {
      const err = new Error('No ElevenLabs API key configured. Open Settings to set it.')
      handleTranscriptionError(err, 'elevenlabs')
      throw err
    }
    const vocab = getActiveVocabulary(settings)
    const lang = settings.transcriptionLanguage?.trim() || 'auto'
    return elevenLabsTranscribe(apiKey, audioBuffer, filename, vocab, lang)
  }

  if (provider === 'selfhosted') {
    const baseUrl = settings.openaiBaseUrl?.trim()
    if (!baseUrl) {
      const err = new Error('No self-hosted server URL configured. Open Settings to set it.')
      handleTranscriptionError(err, 'selfhosted')
      throw err
    }
    const model = settings.whisperModel?.trim() || SELFHOSTED_MODEL
    const basePrompt = settings.transcriptionPrompt || DEFAULT_PROMPT
    const vocab = getActiveVocabulary(settings)
    const prompt = vocab
      ? `${basePrompt}\n\nTechnical terms that may appear (use these exact spellings): ${vocab}`
      : basePrompt
    const lang = settings.transcriptionLanguage?.trim() || 'auto'
    // whisper.cpp uses /inference, OpenAI-compatible servers use /v1/audio/transcriptions
    const endpoint = baseUrl.includes('/v1') ? `${baseUrl}/audio/transcriptions` : `${baseUrl}/inference`
    return whisperTranscribe('', audioBuffer, filename, prompt, endpoint, model, true, lang)
  }

  // openai
  const apiKey = settings.openaiApiKey
  if (!apiKey) {
    const err = new Error('No OpenAI API key configured. Open Settings to set it.')
    handleTranscriptionError(err, 'openai')
    throw err
  }

  const baseUrl = DEFAULT_OPENAI_BASE
  const model = DEFAULT_MODEL

  const basePrompt = settings.transcriptionPrompt || DEFAULT_PROMPT
  const vocab = getActiveVocabulary(settings)
  const prompt = vocab
    ? `${basePrompt}\n\nTechnical terms that may appear (use these exact spellings): ${vocab}`
    : basePrompt

  const lang = settings.transcriptionLanguage?.trim() || 'auto'
  // AI cleanup (settings.cleanupEnabled/cleanupMode) is applied uniformly to
  // whichever STT provider produced the transcript — see applyCleanup() in
  // transcribeAudio(), not per-provider here.
  return whisperTranscribe(apiKey, audioBuffer, filename, prompt, baseUrl, model, false, lang)
}

function whisperTranscribe(apiKey: string, audioBuffer: Buffer, filename: string, prompt: string, baseUrl: string, model: string, directUrl = false, language = 'auto'): Promise<string> {
  const boundary = `----Whisperio${Date.now()}`

  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/webm\r\n\r\n`
  ))
  parts.push(audioBuffer)
  parts.push(Buffer.from('\r\n'))

  if (!directUrl) {
    // OpenAI format — send model and prompt
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
    ))
    if (prompt) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`
      ))
    }
  }

  // response_format for whisper.cpp
  if (directUrl) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`
    ))
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n`
    ))
  }

  if (language && language !== 'auto') {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`
    ))
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(parts)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        request.abort()
        const err = new Error('OpenAI transcription request timed out after 45s')
        handleTranscriptionError(err, 'openai')
        reject(err)
      }
    }, 45_000)

    const settle = <T>(fn: (val: T) => void) => (val: T) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        fn(val)
      }
    }

    const request = net.request({
      method: 'POST',
      url: directUrl ? baseUrl : `${baseUrl}/audio/transcriptions`
    })

    if (apiKey) {
      request.setHeader('Authorization', `Bearer ${apiKey}`)
    }
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)

    const chunks: Buffer[] = []

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        // Don't log transcript/response bodies in production — this is a privacy
        // app and main-process stdout is commonly captured by run/crash tooling.
        if (isDev()) {
          console.log(`[Whisperio] Transcription response (${response.statusCode}): ${responseBody.substring(0, 200)}`)
        }
        if (response.statusCode !== 200) {
          // Keep the raw provider body out of the user-facing Error message.
          if (isDev()) console.error(`[Whisperio] OpenAI API error body: ${responseBody}`)
          const err = new Error(`OpenAI API error ${response.statusCode}`)
          handleTranscriptionError(err, directUrl ? 'selfhosted' : 'openai')
          settle(reject)(err)
          return
        }
        try {
          const data = JSON.parse(responseBody) as TranscribeResult
          if (isDev()) console.log(`[Whisperio] Transcribed text: "${data.text?.substring(0, 100)}"`)
          settle(resolve)(data.text)
        } catch {
          const err = new Error(`Failed to parse transcription response (HTTP ${response.statusCode})`)
          handleTranscriptionError(err, 'openai')
          settle(reject)(err)
        }
      })
      response.on('error', (err: Error) => {
        handleTranscriptionError(err, 'openai')
        settle(reject)(err)
      })
    })

    request.on('error', (err: Error) => {
      handleTranscriptionError(err, 'openai')
      settle(reject)(err)
    })
    request.write(body)
    request.end()
  })
}

function elevenLabsTranscribe(apiKey: string, audioBuffer: Buffer, filename: string, vocabulary: string, language: string): Promise<string> {
  const boundary = `----Whisperio${Date.now()}`
  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/webm\r\n\r\n`
  ))
  parts.push(audioBuffer)
  parts.push(Buffer.from('\r\n'))

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v2\r\n`
  ))

  if (language && language !== 'auto') {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language_code"\r\n\r\n${language}\r\n`
    ))
  }

  if (vocabulary) {
    const keyterms = vocabulary.split(',').map((t) => t.trim()).filter(Boolean)
    for (const term of keyterms) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="keyterms"\r\n\r\n${term}\r\n`
      ))
    }
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(parts)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        request.abort()
        const err = new Error('ElevenLabs transcription request timed out after 45s')
        handleTranscriptionError(err, 'elevenlabs')
        reject(err)
      }
    }, 45_000)

    const settle = <T>(fn: (val: T) => void) => (val: T) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        fn(val)
      }
    }

    const request = net.request({
      method: 'POST',
      url: ELEVENLABS_STT_URL
    })

    request.setHeader('xi-api-key', apiKey)
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)

    const chunks: Buffer[] = []

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        if (response.statusCode !== 200) {
          if (isDev()) console.error(`[Whisperio] ElevenLabs API error body: ${responseBody}`)
          const err = new Error(`ElevenLabs API error ${response.statusCode}`)
          handleTranscriptionError(err, 'elevenlabs')
          settle(reject)(err)
          return
        }
        try {
          const data = JSON.parse(responseBody) as TranscribeResult
          settle(resolve)(data.text)
        } catch {
          const err = new Error(`Failed to parse transcription response (HTTP ${response.statusCode})`)
          handleTranscriptionError(err, 'elevenlabs')
          settle(reject)(err)
        }
      })
      response.on('error', (err: Error) => {
        handleTranscriptionError(err, 'elevenlabs')
        settle(reject)(err)
      })
    })

    request.on('error', (err: Error) => {
      handleTranscriptionError(err, 'elevenlabs')
      settle(reject)(err)
    })
    request.write(body)
    request.end()
  })
}

