// LLM provider abstraction (v1.4 STEP1).
//
// Every AI text-completion call in the app (transcript cleanup, future
// context-menu commands) MUST go through an `LLMProvider` obtained from
// `selectProvider`. Nothing outside this file talks to an LLM HTTP endpoint
// directly — that keeps the "no inline fetch to OpenAI in feature code"
// invariant enforceable by grep and keeps every caller's fail-soft-to-raw
// behavior identical regardless of which backend is configured.
//
// This module is pure DI: it never imports settingsManager. The caller
// (wiring layer) reads settings, builds the candidate provider list, and
// calls `selectProvider(cfg, candidates)`. That keeps this file trivially
// unit-testable without mocking Electron or the settings store.

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Usage/cost metadata a provider *may* be able to report after `complete()`
 * resolves. Shape is intentionally loose — different backends expose
 * different signals (token counts vs. wall-clock compute time), and callers
 * (a future usageTracker) are expected to handle whichever fields are
 * present for the provider they got.
 */
export interface LLMUsage {
  /** Matches `LLMProvider.id` of whichever provider produced this usage. */
  provider: string
  promptTokens?: number
  completionTokens?: number
  /** Replicate-style compute-time billing: seconds of model execution. */
  predictTimeSeconds?: number
}

export interface LLMRequest {
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /**
   * Optional callback invoked once, after a successful `complete()`, with
   * whatever usage metadata the backend returned. Additive by design — it
   * does NOT change `complete()`'s return type (still `Promise<string>`),
   * so every existing caller keeps working unmodified. A future
   * usageTracker can pass this in to meter cost without every call site
   * needing to change.
   */
  onUsage?: (usage: LLMUsage) => void
}

export interface LLMProvider {
  readonly id: string
  readonly isLocal: boolean
  complete(req: LLMRequest): Promise<string>
  available(): Promise<boolean>
}

// Injectable clock so `available()`'s cache can be tested without real
// timers (repo convention — see other *Manager tests: fake clocks, no
// `setTimeout` in specs).
export interface Clock {
  now(): number
}

const systemClock: Clock = { now: () => Date.now() }

const AVAILABILITY_CACHE_MS = 30_000
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 1500

/**
 * True when `hostname` is loopback or on a private (RFC1918 / link-local
 * mDNS) network — i.e. reachable without leaving the machine/LAN. Used to
 * decide whether a provider counts as "local" (no network dependency, safe
 * fallback when the user's configured provider is unreachable — e.g. Wi-Fi
 * off) versus a hosted API that requires real internet.
 */
export function isLocalHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }

  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true
  if (host.endsWith('.local')) return true

  const ipv4Parts = host.split('.')
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = ipv4Parts.map(Number)
    if (octets.some((o) => o > 255)) return false
    const [a, b] = octets
    if (a === 127) return true
    if (a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    return false
  }

  return false
}

function computeIsLocal(baseUrl: string): boolean {
  try {
    return isLocalHost(new URL(baseUrl).hostname)
  } catch {
    // Unparseable baseUrl — treat as remote so we never mis-classify a
    // hosted API as a safe offline fallback.
    return false
  }
}

/**
 * Connection-security invariant: every provider/base URL MUST be https,
 * unless the host is loopback or private (see `isLocalHost`) — in which
 * case plain http is fine (LAN/offline servers like Ollama never leave the
 * machine/network). Called from every provider constructor so an insecure
 * public-host URL fails fast, with a readable reason, instead of silently
 * sending credentials over cleartext. The wiring layer (candidate-building
 * code) is expected to try/catch this and simply omit the provider from
 * its candidate list — `selectProvider` never sees it.
 */
function assertSecureBaseUrl(baseUrl: string, providerId: string): void {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`${providerId}: invalid base URL '${baseUrl}'`)
  }

  if (parsed.protocol === 'https:') return
  if (parsed.protocol === 'http:' && isLocalHost(parsed.hostname)) return

  throw new Error(
    `${providerId}: refusing insecure http:// base URL '${baseUrl}' for non-local host ` +
      `'${parsed.hostname}'. Use https://, or point at a loopback/private host ` +
      `(127.*, localhost, ::1, 10.*, 192.168.*, 172.16-31.*, *.local) if this is a local server.`
  )
}

async function checkReachable(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

interface AvailabilityCache {
  value: boolean | null
  checkedAt: number
}

function cachedAvailable(
  cache: AvailabilityCache,
  clock: Clock,
  check: () => Promise<boolean>
): Promise<boolean> {
  const now = clock.now()
  if (cache.value !== null && now - cache.checkedAt < AVAILABILITY_CACHE_MS) {
    return Promise.resolve(cache.value)
  }
  return check().then((ok) => {
    cache.value = ok
    cache.checkedAt = clock.now()
    return ok
  })
}

export interface OpenAICompatibleOptions {
  /** Provider id used for settings matching (e.g. 'openai', 'ollama'). Defaults to 'openai-compatible'. */
  id?: string
  /** Host root, WITHOUT `/v1` — e.g. 'https://api.openai.com' or 'http://127.0.0.1:11434'. */
  baseUrl: string
  /** Bearer token. Omit for local servers that don't require auth. */
  apiKey?: string
  model: string
  /** Reachability check timeout in ms. Defaults to 1500. */
  timeoutMs?: number
  clock?: Clock
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * OpenAI Chat Completions-shaped provider. Works against the real OpenAI API
 * as well as any OpenAI-compatible local server (Ollama, LocalAI, LM Studio,
 * ...) by pointing `baseUrl` at it — that's the whole point of the
 * abstraction: one code path, swappable backend.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string
  readonly isLocal: boolean

  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly clock: Clock
  private readonly availability: AvailabilityCache = { value: null, checkedAt: 0 }

  constructor(opts: OpenAICompatibleOptions) {
    this.id = opts.id ?? 'openai-compatible'
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS
    this.clock = opts.clock ?? systemClock
    assertSecureBaseUrl(this.baseUrl, this.id)
    this.isLocal = computeIsLocal(this.baseUrl)
  }

  async complete(req: LLMRequest): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages
    }
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal
    })

    if (!response.ok) {
      throw new Error(`${this.id} chat completion failed: HTTP ${response.status}`)
    }

    const data = (await response.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error(`${this.id} chat completion returned no content`)
    }

    if (req.onUsage && data.usage) {
      req.onUsage({
        provider: this.id,
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens
      })
    }

    return content
  }

  async available(): Promise<boolean> {
    return cachedAvailable(this.availability, this.clock, () => {
      const headers: Record<string, string> = {}
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
      return checkReachable(`${this.baseUrl}/v1/models`, headers, this.timeoutMs)
    })
  }
}

export interface AnthropicOptions {
  id?: string
  apiKey: string
  model: string
  /** Defaults to https://api.anthropic.com — override only for testing. */
  baseUrl?: string
  timeoutMs?: number
  clock?: Clock
}

const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_DEFAULT_MAX_TOKENS = 1024

interface AnthropicMessagesResponse {
  content?: { type: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Anthropic Messages API provider. Only ever instantiated by the wiring
 * layer when the user has supplied an Anthropic API key — this class itself
 * has no opinion on that, it just requires `apiKey` in its options.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id: string
  readonly isLocal = false

  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly clock: Clock
  private readonly availability: AvailabilityCache = { value: null, checkedAt: 0 }

  constructor(opts: AnthropicOptions) {
    this.id = opts.id ?? 'anthropic'
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.baseUrl = (opts.baseUrl ?? ANTHROPIC_DEFAULT_BASE).replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS
    this.clock = opts.clock ?? systemClock
    assertSecureBaseUrl(this.baseUrl, this.id)
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    }
  }

  async complete(req: LLMRequest): Promise<string> {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
      messages
    }
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (system) body.system = system

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal
    })

    if (!response.ok) {
      throw new Error(`${this.id} message request failed: HTTP ${response.status}`)
    }

    const data = (await response.json()) as AnthropicMessagesResponse
    const text = (data.content ?? []).map((block) => block.text ?? '').join('')
    if (!text) {
      throw new Error(`${this.id} message request returned no content`)
    }

    if (req.onUsage && data.usage) {
      req.onUsage({
        provider: this.id,
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens
      })
    }

    return text
  }

  async available(): Promise<boolean> {
    return cachedAvailable(this.availability, this.clock, () =>
      checkReachable(`${this.baseUrl}/v1/models`, this.headers(), this.timeoutMs)
    )
  }
}

export interface ReplicateOptions {
  id?: string
  apiKey: string
  /** `owner/name` pair, e.g. 'meta/meta-llama-3-8b-instruct' — see models.ts for the curated catalog. */
  model: string
  /** Defaults to https://api.replicate.com — override only for testing. */
  baseUrl?: string
  /** `Prefer: wait=<seconds>` sync hold time (1-60). Defaults to 60 — the API's own max. */
  waitSeconds?: number
  timeoutMs?: number
  clock?: Clock
}

const REPLICATE_DEFAULT_BASE = 'https://api.replicate.com'
const REPLICATE_DEFAULT_WAIT_SECONDS = 60

interface ReplicatePredictionResponse {
  output?: string[] | string | null
  status?: string
  error?: string | null
  metrics?: { predict_time?: number }
}

/**
 * Replicate HTTP API provider — plain `fetch`, zero SDK (PolyForm NC: no
 * heavy deps). Creates a prediction directly against a model's own endpoint
 * (`POST /v1/models/{owner}/{name}/predictions`) with `Prefer: wait=<n>` so
 * the request blocks server-side for up to `n` seconds and (usually)
 * returns the finished result inline — no separate poll loop for the
 * common case. See https://replicate.com/docs/reference/http.
 *
 * Language models on Replicate take a flat `{ prompt, system_prompt? }`
 * input rather than a `messages` array, so `complete()` folds
 * `LLMRequest.messages` down to those two fields: all `system` messages
 * joined into `system_prompt`, everything else joined into `prompt`.
 */
export class ReplicateProvider implements LLMProvider {
  readonly id: string
  readonly isLocal = false

  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly waitSeconds: number
  private readonly timeoutMs: number
  private readonly clock: Clock
  private readonly availability: AvailabilityCache = { value: null, checkedAt: 0 }

  constructor(opts: ReplicateOptions) {
    this.id = opts.id ?? 'replicate'
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.baseUrl = (opts.baseUrl ?? REPLICATE_DEFAULT_BASE).replace(/\/+$/, '')
    this.waitSeconds = opts.waitSeconds ?? REPLICATE_DEFAULT_WAIT_SECONDS
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS
    this.clock = opts.clock ?? systemClock
    assertSecureBaseUrl(this.baseUrl, this.id)
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` }
  }

  private predictionHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.authHeaders(),
      Prefer: `wait=${this.waitSeconds}`
    }
  }

  async complete(req: LLMRequest): Promise<string> {
    const systemPrompt = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const prompt = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n\n')

    const input: Record<string, unknown> = { prompt }
    if (systemPrompt) input.system_prompt = systemPrompt
    // Server ignores fields a given model's schema doesn't declare, so it's
    // safe to always pass these through when the caller supplied them.
    if (req.temperature !== undefined) input.temperature = req.temperature
    if (req.maxTokens !== undefined) input.max_tokens = req.maxTokens

    const response = await fetch(`${this.baseUrl}/v1/models/${this.model}/predictions`, {
      method: 'POST',
      headers: this.predictionHeaders(),
      body: JSON.stringify({ input }),
      signal: req.signal
    })

    if (!response.ok) {
      throw new Error(`${this.id} prediction failed: HTTP ${response.status}`)
    }

    const data = (await response.json()) as ReplicatePredictionResponse
    if (data.error) {
      throw new Error(`${this.id} prediction failed: ${data.error}`)
    }

    const text = Array.isArray(data.output) ? data.output.join('') : data.output ?? ''
    if (!text) {
      throw new Error(`${this.id} prediction returned no output`)
    }

    if (req.onUsage && data.metrics?.predict_time !== undefined) {
      req.onUsage({ provider: this.id, predictTimeSeconds: data.metrics.predict_time })
    }

    return text
  }

  async available(): Promise<boolean> {
    return cachedAvailable(this.availability, this.clock, () =>
      checkReachable(`${this.baseUrl}/v1/account`, this.authHeaders(), this.timeoutMs)
    )
  }
}

export interface LLMProviderConfig {
  /**
   * Provider id to prefer — matched against `LLMProvider.id` in
   * `candidates`. Built-in provider ids are `'openai'`, `'anthropic'`,
   * `'replicate'`, plus whatever id an OpenAI-compatible local server was
   * constructed with (e.g. `'ollama'`). `selectProvider` itself is
   * provider-agnostic — it just string-matches this against whichever
   * candidates the wiring layer built — so no per-id branching is needed
   * here for `'replicate'` to work; the wiring layer just needs to include
   * a `ReplicateProvider` (id `'replicate'`) in `candidates` when
   * `replicateApiKey` is set.
   */
  aiProvider?: string
  aiBaseUrl?: string
  aiModel?: string
  openaiApiKey?: string
  anthropicApiKey?: string
  replicateApiKey?: string
}

/**
 * Pick the provider to use for this call, given the user's settings and the
 * already-constructed candidate providers (built by the wiring layer from
 * those same settings). Never throws — worst case returns `null` and the
 * caller falls back to the raw (un-cleaned-up) text, per the offline
 * invariant.
 *
 * Selection order:
 * 1. The candidate whose `id` matches `cfg.aiProvider` (or the first
 *    candidate if `aiProvider` is unset).
 * 2. If that provider reports unavailable (or no candidate matched the
 *    configured id), fall back to any local candidate.
 * 3. Otherwise `null`.
 */
export async function selectProvider(
  cfg: LLMProviderConfig,
  candidates: LLMProvider[]
): Promise<LLMProvider | null> {
  if (candidates.length === 0) return null

  const selected = cfg.aiProvider
    ? candidates.find((c) => c.id === cfg.aiProvider) ?? null
    : candidates[0]

  if (selected && (await selected.available())) {
    return selected
  }

  const fallback = candidates.find((c) => c.isLocal && c !== selected)
  return fallback ?? null
}
