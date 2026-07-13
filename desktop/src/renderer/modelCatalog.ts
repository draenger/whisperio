// Curated LLM model catalog — renderer copy (v1.5 PACZKA UI).
//
// Mirror of LLM_MODEL_CATALOG in src/main/llm/models.ts. electron-vite builds
// the renderer and main processes as separate bundles, so the renderer can't
// import from src/main directly — same constraint documented in
// CleanupPanel.tsx for isOnDeviceBaseUrl, and the same convention already
// used in this repo for DEFAULT_VOCABULARY_TERMS (duplicated between
// settingsManager.ts and SettingsForm.tsx). Keep this file's data in sync
// with src/main/llm/models.ts by hand — a future build step could generate
// one from the other, but a plain duplicate is the rough-first move.
//
// Pure data + lookup helpers — no I/O — so the settings UI's model picker
// can render a curated dropdown without any main-process dependency.
//
// Pricing snapshot: 2026-07-13. These are ESTIMATES for display only (never
// used to gate/block a request) — re-verify against the vendors' own pricing
// pages before trusting them for real billing:
//   - OpenAI:     https://openai.com/api/pricing
//   - Anthropic:  https://docs.anthropic.com/en/docs/about-claude/pricing
//   - Replicate:  https://replicate.com/pricing (+ each model's own page)
// A custom/private aiBaseUrl (self-hosted or otherwise not in this catalog)
// has no entry here — the UI falls back to a free-text field and cost is
// reported as unknown/0, never guessed.

export type LLMCatalogProviderId = 'openai' | 'anthropic' | 'replicate'

export interface LLMCatalogModel {
  provider: LLMCatalogProviderId
  /** Exact string to send as the API `model` field (or Replicate `owner/name`). */
  id: string
  /** Human-readable label for the UI picker. */
  label: string
  /** USD per million INPUT tokens. Omitted when pricing isn't token-based or isn't verified. */
  pricePerMTokIn?: number
  /** USD per million OUTPUT tokens. Omitted when pricing isn't token-based or isn't verified. */
  pricePerMTokOut?: number
  /** True for the one model per provider pre-selected in the UI. */
  default?: boolean
}

const OPENAI_MODELS: LLMCatalogModel[] = [
  {
    provider: 'openai',
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini (fast, cost-effective)',
    pricePerMTokIn: 0.15,
    pricePerMTokOut: 0.6,
    default: true
  },
  {
    provider: 'openai',
    id: 'gpt-4o',
    label: 'GPT-4o',
    pricePerMTokIn: 2.5,
    pricePerMTokOut: 10
  },
  {
    provider: 'openai',
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    pricePerMTokIn: 2,
    pricePerMTokOut: 8
  }
]

const ANTHROPIC_MODELS: LLMCatalogModel[] = [
  {
    provider: 'anthropic',
    // Dateless alias — Anthropic resolves it to the pinned snapshot
    // (currently claude-haiku-4-5-20251001). See docs.anthropic.com/en/docs/about-claude/models/overview.
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5 (fastest, cost-effective)',
    pricePerMTokIn: 1,
    pricePerMTokOut: 5,
    default: true
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    // Introductory pricing through 2026-08-31 is $2/$10; standard pricing
    // ($3/$15) takes effect 2026-09-01. Using the currently-effective rate —
    // update after the cutover.
    pricePerMTokIn: 2,
    pricePerMTokOut: 10
  },
  {
    provider: 'anthropic',
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    pricePerMTokIn: 5,
    pricePerMTokOut: 25
  }
]

const REPLICATE_MODELS: LLMCatalogModel[] = [
  {
    provider: 'replicate',
    id: 'meta/meta-llama-3-8b-instruct',
    label: 'Llama 3 8B Instruct (fast, cost-effective)',
    // Replicate meters most models by compute-seconds, not tokens; this is
    // a third-party aggregator's token-equivalent estimate for this model
    // (llmpricecheck.com), not an official per-token Replicate price.
    // Treat as rough and re-verify before relying on it.
    pricePerMTokIn: 0.04,
    pricePerMTokOut: 0.04,
    default: true
  },
  {
    provider: 'replicate',
    id: 'meta/meta-llama-3-70b-instruct',
    label: 'Llama 3 70B Instruct'
    // Pricing not verified against an authoritative per-token source —
    // Replicate bills this per-second of compute. Left unknown rather than
    // guessed; UI should show cost as "unknown" for this entry.
  },
  {
    provider: 'replicate',
    id: 'mistralai/mixtral-8x7b-instruct-v0.1',
    label: 'Mixtral 8x7B Instruct'
    // Same caveat as above — no verified per-token price.
  }
]

export const LLM_MODEL_CATALOG: readonly LLMCatalogModel[] = [
  ...OPENAI_MODELS,
  ...ANTHROPIC_MODELS,
  ...REPLICATE_MODELS
]

/** All catalog entries for one provider, in display order. Empty array for an unknown/custom provider. */
export function listModelsForProvider(provider: LLMCatalogProviderId): LLMCatalogModel[] {
  return LLM_MODEL_CATALOG.filter((m) => m.provider === provider)
}

/** The one model flagged `default: true` for a provider, or `undefined` if none is (shouldn't happen for built-in providers). */
export function getDefaultModel(provider: LLMCatalogProviderId): LLMCatalogModel | undefined {
  return LLM_MODEL_CATALOG.find((m) => m.provider === provider && m.default === true)
}

/** Look up one catalog entry by provider + exact model id. `undefined` for a custom/unlisted model — that's expected, not an error. */
export function findCatalogModel(
  provider: LLMCatalogProviderId,
  modelId: string
): LLMCatalogModel | undefined {
  return LLM_MODEL_CATALOG.find((m) => m.provider === provider && m.id === modelId)
}
