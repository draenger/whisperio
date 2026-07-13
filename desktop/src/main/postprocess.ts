// AI transcript cleanup (v1.4 Work Item A). Sits between STT and
// paste/recordingStore: takes the raw transcript + an already-resolved
// `LLMProvider` and returns a cleaned-up version, or the untouched `raw` text
// whenever cleanup can't safely happen. This is the ONLY place transcript
// cleanup logic lives — callers (transcribe.ts) own settings + provider
// wiring, this module owns the actual cleanup contract.
//
// Fail-soft is total and never throws: disabled, no provider, provider
// failure, an aborted call (new dictation superseding this one), or an
// output that looks hallucinated all resolve to `raw`. The offline invariant
// (never break dictation because AI cleanup couldn't reach the network) is
// enforced here, not by callers remembering to catch.

import type { LLMProvider } from './llm/provider'
import { buildCleanupMessages, type CleanupMode as PromptCleanupMode } from './llm/prompts'

export type CleanupMode = 'off' | PromptCleanupMode

export interface CleanupOptions {
  /** 'off' short-circuits to `raw` before touching the provider at all. */
  cleanupMode: CleanupMode
  /** Comma/newline-separated preferred spellings, or '' when none configured. */
  vocab: string
  /** Free-text tone/register instruction. Not wired to settings yet (Work Item B). */
  tone?: string
  /** Already-resolved provider (DI) — `null` when none is configured/available. */
  provider: LLMProvider | null
  /** Tied to the dictation cycle: a new dictation aborts a cleanup in flight. */
  signal?: AbortSignal
}

const CLEANUP_TEMPERATURE = 0.2

// A cleaned transcript that comes back meaningfully longer than the input is
// far more likely to be a hallucinated continuation than a legitimate
// cleanup (cleanup only removes fillers/adds punctuation — it should never
// grow the text much). Guard against it by falling back to `raw`.
const HALLUCINATION_LENGTH_RATIO = 1.6

function isAbort(err: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true
  return err instanceof Error && err.name === 'AbortError'
}

// Some models wrap their answer in quotes/backticks/a fenced code block even
// when told to return only the text. Strip one layer of that so it doesn't
// leak into the pasted result.
const WRAP_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'] // “ ”
]

function stripWrapping(text: string): string {
  let result = text.trim()

  const fence = result.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  if (fence) {
    result = fence[1].trim()
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [open, close] of WRAP_PAIRS) {
      if (result.length > open.length + close.length && result.startsWith(open) && result.endsWith(close)) {
        result = result.slice(open.length, result.length - close.length).trim()
        changed = true
      }
    }
  }

  return result
}

/**
 * Clean up a raw STT transcript via the given provider. Never throws — any
 * failure to safely produce a cleaned transcript resolves to `raw`.
 */
export async function cleanupTranscription(raw: string, opts: CleanupOptions): Promise<string> {
  const mode = opts.cleanupMode
  if (mode === 'off') return raw
  if (!raw || !raw.trim()) return raw

  if (!opts.provider) {
    console.info('[Whisperio] Cleanup skipped: no LLM provider available, using raw transcript.')
    return raw
  }

  const messages = buildCleanupMessages({
    raw,
    vocab: opts.vocab,
    tone: opts.tone ?? '',
    mode
  })

  try {
    const completion = await opts.provider.complete({
      messages,
      temperature: CLEANUP_TEMPERATURE,
      signal: opts.signal
    })

    const cleaned = stripWrapping(completion)
    if (!cleaned) return raw
    if (cleaned.length > raw.length * HALLUCINATION_LENGTH_RATIO) return raw
    return cleaned
  } catch (err) {
    if (isAbort(err, opts.signal)) {
      console.info('[Whisperio] Cleanup aborted (new dictation started), using raw transcript.')
    } else {
      console.info(
        '[Whisperio] Cleanup failed, using raw transcript:',
        err instanceof Error ? err.message : String(err)
      )
    }
    return raw
  }
}
