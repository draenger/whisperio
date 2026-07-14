import { net, app } from 'electron'
import { AppSettings, getActiveVocabulary, type ProviderId, type CleanupMode } from './settingsManager'
// Provider API keys are read through this accessor rather than
// settingsManager.loadSettings() directly — it composes settings.json with
// the encrypted key store (secure/keyStore.ts), key store taking precedence
// when OS secure storage is available. See secure/keyAccessor.ts.
import { getEffectiveSettings } from './secure/keyAccessor'
import { handleTranscriptionError, notifyInfo } from './errorHandler'
import { OpenAICompatibleProvider, AnthropicProvider, ReplicateProvider, selectProvider, isLocalHost, type LLMProvider } from './llm/provider'
import { cleanupTranscription, cleanupTranscriptionDetailed, formatTranscription, type CleanupResult } from './postprocess'
import { getServerStatus } from './localServer'
import { recordSTT, estimateAudioSeconds } from './usageTracker'
import { getRecording, updateRecording } from './recordingStore'

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

// STT+ (v1.5): Replicate-hosted STT. `openai/whisper` is Replicate's official
// model (see https://replicate.com/openai/whisper) — verified stable input
// (`audio`, `transcription: "plain text"`) and output (`transcription: string`)
// shape via its docs. Used only when the user hasn't set `sttReplicateModel`.
const DEFAULT_REPLICATE_MODEL = 'openai/whisper'
const REPLICATE_API_BASE = 'https://api.replicate.com/v1'
// Prefer: wait caps at 60s server-side (Replicate HTTP API docs); a dictation
// clip is short, so this is generous headroom for the client-side abort.
const REPLICATE_TIMEOUT_MS = 55_000

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  selfhosted: 'Local Model',
  replicate: 'Replicate'
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
// LLM cleanup candidate on Replicate — distinct from DEFAULT_REPLICATE_MODEL
// above (STT-specific, `openai/whisper`). This is llm/models.ts's `default:
// true` entry in REPLICATE_MODELS (fast, cost-effective instruct model).
const DEFAULT_REPLICATE_CLEANUP_MODEL = 'meta/meta-llama-3-8b-instruct'

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

  // Replicate candidate: `replicateApiKey` is shared with the STT side (see
  // settingsManager.ts's doc comment on that key) — one key unlocks both a
  // Replicate STT provider and this Replicate LLM cleanup candidate.
  if (settings.replicateApiKey) {
    candidates.push(
      new ReplicateProvider({
        id: 'replicate',
        apiKey: settings.replicateApiKey,
        model: model || DEFAULT_REPLICATE_CLEANUP_MODEL
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

// ROUGH-FIRST UX (v1.4 PR2): auto-cleanup-after-STT is now gated on
// `cleanupAuto` alone (default OFF — see settingsManager.ts), NOT on
// `cleanupEnabled`. cleanupEnabled now only gates whether the on-demand
// "Clean up" action (RecordingsPanel, see cleanupOnDemand() below) is
// available at all; it has no bearing on whether cleanup runs automatically.
// The cleanupMode === 'off' check is kept as a belt-and-braces guard (a user
// could in principle have cleanupAuto on with mode 'off', though the
// settings UI doesn't offer that combination) so a stray 'off' mode can never
// reach the provider.
async function applyCleanup(settings: AppSettings, raw: string): Promise<string> {
  if (!settings.cleanupAuto || settings.cleanupMode === 'off') {
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

// ROUGH-FIRST UX (v1.4 PR2): on-demand "Clean up" action for an already-saved
// recording (RecordingsPanel), as opposed to applyCleanup() above (which only
// runs automatically, right after STT, when cleanupAuto is on). Not tied to
// the dictation-cycle abort controller above — on-demand calls are
// independent per-recording actions, not superseded by a new dictation.
export interface OnDemandCleanupRequest {
  /** Rule-based mode for the plain "Clean up (full/light)" menu item. Ignored
   * when `templateId` or `customInstruction` is set. Defaults to 'full' if
   * omitted or 'off' (an on-demand action is explicit; it should never be a
   * no-op just because the user's default auto-cleanup mode is 'off'). */
  mode?: CleanupMode
  /** Id into settings.cleanupTemplates. Takes priority over `mode`. */
  templateId?: string
  /** Free-text instruction from RecordingsPanel's "Custom instruction..."
   * field. Takes priority over both `mode` and `templateId`. */
  customInstruction?: string
}

export interface OnDemandCleanupResult extends CleanupResult {
  /** What was actually applied — 'full'/'light', a template's name, or
   * 'Custom instruction' — for display next to the result. */
  cleanedWith: string
}

export async function cleanupOnDemand(raw: string, req: OnDemandCleanupRequest): Promise<OnDemandCleanupResult> {
  const settings = getEffectiveSettings()

  // Defensive guard: cleanupEnabled gates whether the on-demand "Clean up"
  // action exists at all (see CleanupPanel.tsx's "Enable AI cleanup" toggle
  // and RecordingsPanel.tsx, which hides the trigger button when this is
  // off). The renderer should never get here with the toggle off, but a
  // stale renderer or a future caller bypassing that UI check must not be
  // able to reach selectProvider()/an LLM call — belt-and-braces, same
  // fail-soft shape as the "unknown template" branch below.
  if (!settings.cleanupEnabled) {
    return { text: raw, ok: false, cleanedWith: 'cleanup disabled' }
  }

  // Resolve WHAT to do (and validate it) before touching selectProvider —
  // selectProvider's availability checks hit the network, so a stale/unknown
  // templateId should fail soft immediately rather than paying for a
  // reachability check it doesn't need.
  let instruction: string | null = null
  let mode: CleanupMode | null = null
  let cleanedWith: string

  if (req.customInstruction && req.customInstruction.trim()) {
    instruction = req.customInstruction
    cleanedWith = 'Custom instruction'
  } else if (req.templateId) {
    const template = settings.cleanupTemplates.find((t) => t.id === req.templateId)
    if (!template) {
      // Stale UI state (template removed since the menu was rendered) —
      // fail-soft to raw rather than throwing.
      return { text: raw, ok: false, cleanedWith: 'unknown template' }
    }
    instruction = template.prompt
    cleanedWith = template.name
  } else {
    mode = req.mode && req.mode !== 'off' ? req.mode : 'full'
    cleanedWith = mode
  }

  const provider = await selectProvider(settings, buildCleanupCandidates(settings))

  if (instruction !== null) {
    const result = await formatTranscription(raw, { instruction, provider })
    return { ...result, cleanedWith }
  }

  const vocab = getActiveVocabulary(settings)
  const result = await cleanupTranscriptionDetailed(raw, { cleanupMode: mode as CleanupMode, vocab, provider })
  return { ...result, cleanedWith }
}

/**
 * Body of the `recordings:cleanup` IPC handler, extracted out of index.ts so
 * it can be exercised directly by a test (no Electron import here — this
 * module is otherwise plain enough for `net`/`app`-free unit testing, matching
 * the rest of transcribe.ts's exports). index.ts's ipcMain.handle just calls
 * this and returns its result.
 */
export async function handleRecordingsCleanup(
  id: string,
  options: OnDemandCleanupRequest
): Promise<OnDemandCleanupResult> {
  const rec = getRecording(id)
  if (!rec?.transcription) return { text: '', ok: false, cleanedWith: 'no transcript' }
  const result = await cleanupOnDemand(rec.transcription, options)
  await updateRecording(id, {
    cleanedText: result.ok ? result.text : undefined,
    cleanedWith: result.cleanedWith
  })
  return result
}

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<string> {
  const settings = getEffectiveSettings()

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
      // PACZKA METERING (v1.6): report usage after every successful STT call,
      // including local/self-hosted (isLocal forces cost to 0 there, but the
      // request/audio-seconds counters still stay complete). recordSTT()
      // never throws, so this can't turn a metering hiccup into a broken
      // transcription.
      recordSTT({
        provider,
        audioSeconds: estimateAudioSeconds(audioBuffer, filename),
        isLocal: provider === 'selfhosted'
      })
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
  if (provider === 'replicate') return !!settings.replicateApiKey
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
    // CONNECTION SECURITY: only allow http:// for loopback/private hosts (the
    // isLocalHost helper shared with llm/provider.ts) — a public host must use
    // https://, or the request is rejected before it ever leaves the machine.
    let parsedUrl: URL
    try {
      parsedUrl = new URL(baseUrl)
    } catch {
      const err = new Error(`Self-hosted server URL is invalid: "${baseUrl}". Open Settings to fix it.`)
      handleTranscriptionError(err, 'selfhosted')
      throw err
    }
    if (parsedUrl.protocol !== 'https:' && !isLocalHost(parsedUrl.hostname)) {
      const err = new Error(
        `Self-hosted server URL must use https:// for a public host (got ${parsedUrl.protocol}//${parsedUrl.hostname}). ` +
          'http:// is only allowed for loopback/private addresses. Open Settings to fix it.'
      )
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
    // Bearer token for a private/self-hosted server that requires auth — empty
    // (the default) preserves today's no-Authorization-header behavior.
    const sttApiKey = settings.sttApiKey?.trim() || ''
    return whisperTranscribe(sttApiKey, audioBuffer, filename, prompt, endpoint, model, true, lang)
  }

  if (provider === 'replicate') {
    const apiKey = settings.replicateApiKey
    if (!apiKey) {
      const err = new Error('No Replicate API key configured. Open Settings to set it.')
      handleTranscriptionError(err, 'replicate')
      throw err
    }
    const model = settings.sttReplicateModel?.trim() || DEFAULT_REPLICATE_MODEL
    const basePrompt = settings.transcriptionPrompt || DEFAULT_PROMPT
    const vocab = getActiveVocabulary(settings)
    const prompt = vocab
      ? `${basePrompt}\n\nTechnical terms that may appear (use these exact spellings): ${vocab}`
      : basePrompt
    const lang = settings.transcriptionLanguage?.trim() || 'auto'
    return replicateTranscribe(apiKey, model, audioBuffer, prompt, lang)
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

interface ReplicatePredictionResponse {
  status?: string
  output?: unknown
  error?: string | null
}

// Different Replicate STT models shape their output differently: the official
// `openai/whisper` model returns a plain string under `output.transcription`
// (when the `transcription` input is "plain text"); several community models
// (e.g. incredibly-fast-whisper) return the raw HF pipeline dict directly as
// `output`, i.e. `{ text: "..." }`. Handle both shapes plus the (unlikely but
// cheap-to-support) case where `output` is already a bare string.
function extractReplicateTranscription(output: unknown): string | null {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>
    if (typeof obj.transcription === 'string') return obj.transcription
    if (typeof obj.text === 'string') return obj.text
  }
  return null
}

/**
 * STT+ (v1.5): Replicate-hosted Whisper. Uses `fetch` (not electron's `net`,
 * unlike the other STT providers in this file) — Replicate's API is plain
 * JSON, not multipart, so there's no benefit to net.request's streaming body
 * builder, and this keeps the call shape consistent with llm/provider.ts's
 * fetch-based providers for the same reasons (testability, AbortSignal).
 *
 * Audio is sent as a base64 data URI in `input.audio` (dictations are short,
 * comfortably under Replicate's data-URI size guidance) to
 * `POST /v1/models/{model}/predictions` with `Prefer: wait` so the response
 * comes back synchronously when the model finishes in time.
 */
async function replicateTranscribe(
  apiKey: string,
  model: string,
  audioBuffer: Buffer,
  prompt: string,
  language: string
): Promise<string> {
  const dataUri = `data:audio/webm;base64,${audioBuffer.toString('base64')}`
  const input: Record<string, unknown> = {
    audio: dataUri,
    // Forces the official openai/whisper model's output.transcription to be a
    // plain string rather than srt/vtt; harmless extra input on models that
    // don't recognize the field.
    transcription: 'plain text'
  }
  if (language && language !== 'auto') input.language = language
  if (prompt) input.initial_prompt = prompt

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REPLICATE_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${REPLICATE_API_BASE}/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Prefer: 'wait'
      },
      body: JSON.stringify({ input }),
      signal: controller.signal
    })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    handleTranscriptionError(error, 'replicate')
    throw error
  } finally {
    clearTimeout(timeout)
  }

  const rawText = await response.text()

  if (!response.ok) {
    if (isDev()) console.error(`[Whisperio] Replicate API error body: ${rawText}`)
    const err = new Error(`Replicate API error ${response.status}`)
    handleTranscriptionError(err, 'replicate')
    throw err
  }

  let body: ReplicatePredictionResponse
  try {
    body = JSON.parse(rawText) as ReplicatePredictionResponse
  } catch {
    const err = new Error(`Failed to parse Replicate response (HTTP ${response.status})`)
    handleTranscriptionError(err, 'replicate')
    throw err
  }

  // Prefer: wait returns a non-terminal status ("starting"/"processing") if
  // the model didn't finish within the wait window, or "failed"/"canceled" on
  // a model-side error — either way there's no usable output yet.
  if (body.status && body.status !== 'succeeded') {
    const err = new Error(`Replicate prediction did not complete in time (status: ${body.status})`)
    handleTranscriptionError(err, 'replicate')
    throw err
  }

  const text = extractReplicateTranscription(body.output)
  if (text === null) {
    const err = new Error('Replicate response did not contain a transcription')
    handleTranscriptionError(err, 'replicate')
    throw err
  }
  return text
}

