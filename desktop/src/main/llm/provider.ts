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

export interface LLMRequest {
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
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
    return text
  }

  async available(): Promise<boolean> {
    return cachedAvailable(this.availability, this.clock, () =>
      checkReachable(`${this.baseUrl}/v1/models`, this.headers(), this.timeoutMs)
    )
  }
}

export interface LLMProviderConfig {
  /** Provider id to prefer — matched against `LLMProvider.id` in `candidates`. */
  aiProvider?: string
  aiBaseUrl?: string
  aiModel?: string
  openaiApiKey?: string
  anthropicApiKey?: string
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
