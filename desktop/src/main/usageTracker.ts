// Usage/cost metering (v1.6 PACZKA METERING).
//
// Tracks how much each AI backend has been used — LLM completions (transcript
// cleanup, via postprocess.ts) and STT (speech-to-text, via transcribe.ts) —
// per calendar month, persisted to a JSON file in userData (same atomic-write
// pattern as settingsManager.saveSettings: temp file + rename).
//
// FAIL-SOFT INVARIANT: metering must never break a real operation. Every
// exported function here swallows its own errors (a full disk, a corrupt
// usage.json, `app.getPath` unavailable outside a real Electron process,
// etc.) and logs instead of throwing — callers (postprocess.ts, transcribe.ts)
// call these fire-and-forget, with no try/catch of their own required.
//
// HARD COST RULES:
//  - A local/self-hosted backend (LLMProvider.isLocal, or the well-known
//    'local'/'selfhosted' provider ids) is ALWAYS free — estimatedCostUsd is
//    forced to 0 regardless of what token/audio numbers come in.
//  - A free/unrecognized model or provider is also 0 — cost is NEVER guessed
//    for something we don't have a verified (or at least documented-estimate)
//    price for.
//  - ElevenLabs bills in credits, not USD — its estimatedCostUsd is always 0;
//    usage is tracked in the separate `credits` field instead.
//  - Every other cost figure here is an ESTIMATE for a usage dashboard, not
//    billing reconciliation. Sources/dates are noted next to each constant —
//    re-verify against the vendor's own pricing page before relying on them.

import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'
import {
  findCatalogModel,
  getDefaultModel,
  estimateCostUsd,
  type LLMCatalogProviderId
} from './llm/models'

export interface ProviderMonthlyUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  estimatedCostUsd: number
  /** Non-USD credit units (currently only ElevenLabs reports here). Always 0 for every other provider. */
  credits: number
}

/** providerId -> "YYYY-MM" -> that provider's usage for that month. */
export type UsageStore = Record<string, Record<string, ProviderMonthlyUsage>>

function emptyMonth(): ProviderMonthlyUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, audioSeconds: 0, estimatedCostUsd: 0, credits: 0 }
}

function getUsagePath(): string {
  return join(app.getPath('userData'), 'usage.json')
}

/** "YYYY-MM" (local time) for `date`, e.g. '2026-07'. Exported so tests can pin a month. */
export function monthKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Read the persisted usage store. Fail-soft: a missing file is simply "no
 * usage yet" ({}), and a corrupt/unreadable file (truncated by a crash, hand
 * edited, etc.) is treated the same way rather than throwing — losing usage
 * *statistics* is never worth risking a crash in a metering path.
 */
function loadStore(): UsageStore {
  const filePath = getUsagePath()
  if (!existsSync(filePath)) return {}
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as UsageStore
  } catch (err) {
    console.error(
      '[Whisperio] usage.json was unreadable, treating usage as empty:',
      err instanceof Error ? err.message : String(err)
    )
    return {}
  }
}

/**
 * Atomic write, mirroring settingsManager.saveSettings: serialize to a temp
 * file then rename over the target (atomic on the same volume) so a crash
 * mid-write leaves the previous, valid usage.json intact instead of a
 * truncated one.
 */
function saveStore(store: UsageStore): void {
  const filePath = getUsagePath()
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
}

function ensureBucket(store: UsageStore, provider: string, month: string): ProviderMonthlyUsage {
  if (!store[provider]) store[provider] = {}
  if (!store[provider][month]) store[provider][month] = emptyMonth()
  return store[provider][month]
}

// Provider ids that are unconditionally free, independent of any per-model
// pricing lookup — matches the settingsManager/llm-provider notion of "local":
// the app's own bundled local model server (id 'local', see transcribe.ts's
// buildCleanupCandidates) and the self-hosted STT server (ProviderId
// 'selfhosted', see settingsManager.ts).
const LOCAL_PROVIDER_IDS = new Set(['local', 'selfhosted'])

function isFreeProvider(providerId: string, isLocal: boolean | undefined): boolean {
  return isLocal === true || LOCAL_PROVIDER_IDS.has(providerId.trim().toLowerCase())
}

// Replicate meters by hardware-seconds, not tokens. The models this app talks
// to on Replicate (meta/meta-llama-3-* for LLM cleanup, openai/whisper for
// STT — see llm/models.ts and transcribe.ts's DEFAULT_REPLICATE_MODEL) run on
// a T4 GPU at $0.000225/sec (replicate.com/pricing + replicate.com/openai/
// whisper, verified 2026-07-13). Used as a rough per-second rate whenever a
// Replicate call reports `predictTimeSeconds` but has no verified per-token
// price to fall back on.
const REPLICATE_COMPUTE_SEC_PRICE_USD = 0.000225

// ---------------------------------------------------------------------------
// LLM usage (transcript cleanup — postprocess.ts)
// ---------------------------------------------------------------------------

export interface RecordLLMOptions {
  /** Matches LLMProvider.id — e.g. 'openai', 'anthropic', 'replicate', 'local'. */
  provider: string
  /**
   * Exact model id the call used (see llm/models.ts LLM_MODEL_CATALOG), when
   * known. The LLMProvider.complete() usage callback (llm/provider.ts) does
   * not currently carry the model id back out — see the fallback note on
   * `estimateLLMCostUsd` below for what happens when this is omitted.
   */
  model?: string
  inputTokens?: number
  outputTokens?: number
  /** Replicate-style compute-time billing signal (LLMUsage.predictTimeSeconds). */
  predictTimeSeconds?: number
  /** Pass the resolved LLMProvider's `.isLocal` — forces cost to 0 regardless of model/tokens. */
  isLocal?: boolean
}

/**
 * Estimated USD cost for one LLM call. Never guesses beyond what's in the
 * catalog: an unlisted/custom model resolves to $0, same as a free one.
 *
 * MODEL FALLBACK: when `opts.model` isn't supplied, this falls back to the
 * provider's *default* catalog model's pricing (`getDefaultModel`) as an
 * APPROXIMATION — good enough for a usage dashboard, but if the user actually
 * configured a pricier non-default model the real cost is higher than this
 * estimate. Threading the exact model id through the whole call chain
 * (settings -> provider construction -> usage callback) would touch
 * llm/provider.ts's public `LLMUsage` shape and its existing tests; this
 * fallback avoids that while still producing a directionally-correct number.
 */
function estimateLLMCostUsd(opts: RecordLLMOptions): number {
  if (isFreeProvider(opts.provider, opts.isLocal)) return 0

  const catalogProviderId = opts.provider as LLMCatalogProviderId
  const catalogModel = opts.model
    ? findCatalogModel(catalogProviderId, opts.model)
    : getDefaultModel(catalogProviderId)

  if (catalogModel) {
    const cost = estimateCostUsd(catalogModel, opts.inputTokens ?? 0, opts.outputTokens ?? 0)
    if (cost !== undefined) return cost
  }

  if (opts.provider.trim().toLowerCase() === 'replicate' && opts.predictTimeSeconds !== undefined) {
    return opts.predictTimeSeconds * REPLICATE_COMPUTE_SEC_PRICE_USD
  }

  // Custom/unlisted/free model with no compute-time signal either — never
  // fabricate a number.
  return 0
}

/**
 * Record one successful LLM completion. Called from postprocess.ts's
 * runCleanupCore after `provider.complete()` resolves, via the request's
 * `onUsage` callback. Never throws.
 */
export function recordLLM(opts: RecordLLMOptions): void {
  try {
    const store = loadStore()
    const bucket = ensureBucket(store, opts.provider, monthKey())
    bucket.requests += 1
    bucket.inputTokens += opts.inputTokens ?? 0
    bucket.outputTokens += opts.outputTokens ?? 0
    bucket.estimatedCostUsd += estimateLLMCostUsd(opts)
    saveStore(store)
  } catch (err) {
    console.error(
      '[Whisperio] usageTracker.recordLLM failed (non-fatal, usage not recorded):',
      err instanceof Error ? err.message : String(err)
    )
  }
}

// ---------------------------------------------------------------------------
// STT usage (transcribe.ts)
// ---------------------------------------------------------------------------

export interface RecordSTTOptions {
  /** ProviderId from settingsManager.ts — 'openai' | 'elevenlabs' | 'selfhosted' | 'replicate'. */
  provider: string
  model?: string
  /** Seconds of audio transcribed — exact if known, otherwise a best-effort estimate (see estimateAudioSeconds). */
  audioSeconds: number
  /**
   * Output transcript length, for providers that might bill/estimate by
   * characters rather than audio duration. Not used by any cost formula
   * below yet (every current STT provider here bills by time or a flat
   * credit rate) — accepted for forward-compatibility with the recordSTT
   * call-site contract.
   */
  characters?: number
  /** Replicate compute-time billing signal, when available. */
  predictTimeSeconds?: number
  /** ElevenLabs credits actually consumed, if the API reported it (header/body) — preferred over the length-based estimate below. */
  creditsUsed?: number
  isLocal?: boolean
}

// OpenAI STT pricing (openai.com/api/pricing, verified 2026-07-13): whisper-1
// and gpt-4o-transcribe are both $0.006/min; gpt-4o-mini-transcribe is
// $0.003/min. This app's transcribe.ts DEFAULT_MODEL is gpt-4o-transcribe (so
// the default rate below is what's actually used today) — the mini rate is
// kept in case a future model picker exposes it.
const OPENAI_STT_PRICE_PER_MIN: Record<string, number> = {
  'gpt-4o-mini-transcribe': 0.003
}
const OPENAI_STT_DEFAULT_PRICE_PER_MIN = 0.006

// ElevenLabs Scribe STT: 330 credits/minute (elevenlabs.io/pricing, verified
// 2026-07-13). ElevenLabs bills in credits, NOT USD — estimatedCostUsd stays
// 0 for this provider always; credits are tracked in their own field.
const ELEVENLABS_CREDITS_PER_MIN = 330

function estimateSTTCost(opts: RecordSTTOptions): { costUsd: number; credits: number } {
  if (isFreeProvider(opts.provider, opts.isLocal)) return { costUsd: 0, credits: 0 }

  const provider = opts.provider.trim().toLowerCase()
  const minutes = Math.max(0, opts.audioSeconds || 0) / 60

  if (provider === 'openai') {
    const configuredPrice = opts.model ? OPENAI_STT_PRICE_PER_MIN[opts.model] : undefined
    const perMinute = configuredPrice ?? OPENAI_STT_DEFAULT_PRICE_PER_MIN
    return { costUsd: minutes * perMinute, credits: 0 }
  }

  if (provider === 'elevenlabs') {
    const credits = opts.creditsUsed ?? Math.ceil(minutes * ELEVENLABS_CREDITS_PER_MIN)
    return { costUsd: 0, credits }
  }

  if (provider === 'replicate' && opts.predictTimeSeconds !== undefined) {
    return { costUsd: opts.predictTimeSeconds * REPLICATE_COMPUTE_SEC_PRICE_USD, credits: 0 }
  }

  // Unknown/unlisted provider, or a known one with no billing signal
  // available yet (e.g. Replicate without predict_time) — never guess.
  return { costUsd: 0, credits: 0 }
}

/**
 * Record one successful STT (speech-to-text) call — including local/
 * self-hosted ones, so request counts and audio-seconds totals stay complete
 * even though their cost is always 0. Called from transcribe.ts after each
 * successful `transcribeWithProvider()`. Never throws.
 */
export function recordSTT(opts: RecordSTTOptions): void {
  try {
    const store = loadStore()
    const bucket = ensureBucket(store, opts.provider, monthKey())
    bucket.requests += 1
    bucket.audioSeconds += Math.max(0, opts.audioSeconds || 0)
    const { costUsd, credits } = estimateSTTCost(opts)
    bucket.estimatedCostUsd += costUsd
    bucket.credits += credits
    saveStore(store)
  } catch (err) {
    console.error(
      '[Whisperio] usageTracker.recordSTT failed (non-fatal, usage not recorded):',
      err instanceof Error ? err.message : String(err)
    )
  }
}

// ---------------------------------------------------------------------------
// Audio-duration estimation (shared helper for transcribe.ts's call sites)
// ---------------------------------------------------------------------------

// The renderer (useDictation.ts) DOES track the real wall-clock recording
// duration, but only passes it to recordings:save, not to dictation:transcribe
// / transcribeAudio — threading it through touches the renderer and preload
// transcribe() signature, which is out of scope for this metering pass.
// Until then, estimate from the buffer itself:
//  - '.wav' (produced by useDictation's webmToWav conversion, used for the
//    selfhosted chain) is a fixed 16kHz mono 16-bit PCM format with a 44-byte
//    header, so byte size gives an EXACT duration.
//  - anything else (the default '.webm', Opus-encoded via MediaRecorder) has
//    no fixed bitrate; this assumes a typical ~24kbps mono voice encode. Good
//    enough for a usage dashboard, NOT for billing reconciliation.
const WAV_HEADER_BYTES = 44
const WAV_BYTES_PER_SECOND = 32_000 // 16000 Hz * 1 channel * 2 bytes/sample
const WEBM_OPUS_ASSUMED_BYTES_PER_SECOND = 3_000 // ~24 kbps mono voice, rough estimate

/**
 * Best-effort duration (in seconds) of a recorded dictation buffer, for usage
 * metering only. Never throws; an empty/missing buffer is 0 seconds.
 */
export function estimateAudioSeconds(audioBuffer: Buffer, filename: string): number {
  if (!audioBuffer || audioBuffer.length === 0) return 0
  if (filename.toLowerCase().endsWith('.wav')) {
    return Math.max(0, (audioBuffer.length - WAV_HEADER_BYTES) / WAV_BYTES_PER_SECOND)
  }
  return audioBuffer.length / WEBM_OPUS_ASSUMED_BYTES_PER_SECOND
}

// ---------------------------------------------------------------------------
// Read / reset (IPC surface — see index.ts's usage:get / usage:reset handlers)
// ---------------------------------------------------------------------------

/**
 * The full persisted usage store (every provider, every month recorded so
 * far). Never throws — a corrupt/unreadable usage.json resolves to `{}`.
 */
export function getUsage(): UsageStore {
  try {
    return loadStore()
  } catch (err) {
    console.error(
      '[Whisperio] usageTracker.getUsage failed (non-fatal):',
      err instanceof Error ? err.message : String(err)
    )
    return {}
  }
}

/**
 * Wipe all recorded usage and return the (empty) result. Never throws — on
 * failure the on-disk file is left as-is.
 */
export function resetUsage(): UsageStore {
  try {
    saveStore({})
  } catch (err) {
    console.error(
      '[Whisperio] usageTracker.resetUsage failed (non-fatal, usage not reset):',
      err instanceof Error ? err.message : String(err)
    )
  }
  return {}
}
