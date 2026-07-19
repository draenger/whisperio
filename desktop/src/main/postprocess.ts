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

import type { LLMProvider, LLMMessage } from './llm/provider'
import { buildCleanupMessages, buildFormatMessages, buildCommandMessages, type CleanupMode as PromptCleanupMode } from './llm/prompts'
import { recordLLM } from './usageTracker'

export type CleanupMode = 'off' | PromptCleanupMode

export interface CleanupOptions {
  /** 'off' short-circuits to `raw` before touching the provider at all. */
  cleanupMode: CleanupMode
  /** Comma/newline-separated preferred spellings, or '' when none configured. */
  vocab: string
  /** Free-text tone/register instruction — resolved from settings.contextAwareTone
   * + a captured DictationContext by transcribe.ts's resolveToneDescription()
   * (Work Item B, v1.5). '' / undefined means no tone hint at all, which
   * buildCleanupMessages (llm/prompts.ts) renders as "Tone profile: (none)". */
  tone?: string
  /** Already-resolved provider (DI) — `null` when none is configured/available. */
  provider: LLMProvider | null
  /** Tied to the dictation cycle: a new dictation aborts a cleanup in flight. */
  signal?: AbortSignal
}

// Richer result for callers that need to distinguish "the provider actually
// produced this" from "we fell back to raw" — the plain-string
// cleanupTranscription() below can't express that distinction, but the
// on-demand RecordingsPanel action (transcribe.ts's cleanupOnDemand) needs it
// to show its inline "AI unreachable — raw kept" hint instead of a full error.
export interface CleanupResult {
  text: string
  /** True only when the provider was called and returned a usable result. */
  ok: boolean
}

export interface FormatOptions {
  /** A cleanupTemplates[].prompt or a free-text custom instruction. */
  instruction: string
  provider: LLMProvider | null
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

// Shared core for both cleanupTranscription (full/light auto+on-demand) and
// formatTranscription (template/custom-instruction on-demand): given a raw
// transcript, a pre-built `messages` array, and a resolved provider, calls
// the provider and applies the same fail-soft guard rails (no provider,
// empty/whitespace raw, empty completion, hallucination-length guard, abort)
// either way. Never throws.
async function runCleanupCore(raw: string, messages: LLMMessage[], provider: LLMProvider | null, signal?: AbortSignal): Promise<CleanupResult> {
  if (!raw || !raw.trim()) return { text: raw, ok: false }

  if (!provider) {
    console.info('[Whisperio] Cleanup skipped: no LLM provider available, using raw transcript.')
    return { text: raw, ok: false }
  }

  try {
    const completion = await provider.complete({
      messages,
      temperature: CLEANUP_TEMPERATURE,
      signal,
      // PACZKA METERING (v1.6): report cost/usage after every successful
      // completion, regardless of cleanup mode/caller. recordLLM() never
      // throws, so this can't turn a metering hiccup into a broken cleanup.
      onUsage: (usage) => {
        recordLLM({
          provider: usage.provider,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          predictTimeSeconds: usage.predictTimeSeconds,
          isLocal: provider.isLocal
        })
      }
    })

    const cleaned = stripWrapping(completion)
    if (!cleaned) return { text: raw, ok: false }
    if (cleaned.length > raw.length * HALLUCINATION_LENGTH_RATIO) return { text: raw, ok: false }
    return { text: cleaned, ok: true }
  } catch (err) {
    if (isAbort(err, signal)) {
      console.info('[Whisperio] Cleanup aborted (new dictation started), using raw transcript.')
    } else {
      console.info(
        '[Whisperio] Cleanup failed, using raw transcript:',
        err instanceof Error ? err.message : String(err)
      )
    }
    return { text: raw, ok: false }
  }
}

/**
 * Clean up a raw STT transcript via the given provider (rule-based full/light
 * mode). Never throws — any failure to safely produce a cleaned transcript
 * resolves to `raw`. Used both by the auto-cleanup path (transcribe.ts, when
 * cleanupAuto is on) and by the on-demand "Clean up (full/light)" action —
 * see cleanupTranscriptionDetailed() for a variant exposing the ok/fail-soft
 * distinction those on-demand callers need for their inline hint.
 */
export async function cleanupTranscription(raw: string, opts: CleanupOptions): Promise<string> {
  return (await cleanupTranscriptionDetailed(raw, opts)).text
}

/**
 * Same rule-based full/light cleanup as cleanupTranscription(), but returns
 * the ok/fail-soft distinction instead of collapsing it to a plain string —
 * for on-demand callers (transcribe.ts's cleanupOnDemand) that need to show
 * "AI unreachable — raw kept" rather than silently pasting raw.
 */
export async function cleanupTranscriptionDetailed(raw: string, opts: CleanupOptions): Promise<CleanupResult> {
  const mode = opts.cleanupMode
  if (mode === 'off') return { text: raw, ok: false }

  const messages = buildCleanupMessages({
    raw,
    vocab: opts.vocab,
    tone: opts.tone ?? '',
    mode
  })

  return runCleanupCore(raw, messages, opts.provider, opts.signal)
}

/**
 * On-demand "format this transcript per a template/custom instruction"
 * (ROUGH-FIRST UX — RecordingsPanel's "Clean up" menu). Same fail-soft
 * contract as cleanupTranscription: no provider, a provider error, or an
 * empty/hallucinated completion all resolve to `{ text: raw, ok: false }`
 * rather than throwing.
 */
export async function formatTranscription(raw: string, opts: FormatOptions): Promise<CleanupResult> {
  if (!opts.instruction || !opts.instruction.trim()) return { text: raw, ok: false }
  const messages = buildFormatMessages({ raw, instruction: opts.instruction })
  return runCleanupCore(raw, messages, opts.provider, opts.signal)
}

export interface CommandRewriteOptions {
  /** The user's SPOKEN instruction (a command-mode dictation transcript,
   * e.g. "make this more formal"), not text to insert. */
  command: string
  provider: LLMProvider | null
  signal?: AbortSignal
}

/**
 * COMMAND mode (desktop hotkey — dictation/hotkeyManager.ts): rewrite an
 * arbitrary piece of text (the current clipboard contents) per a spoken
 * instruction, instead of inserting the spoken words themselves. Same
 * fail-soft contract as formatTranscription/cleanupTranscription — a missing
 * provider, a provider error, an aborted call, or a hallucinated-length
 * completion all resolve to `{ text: selection, ok: false }` rather than
 * throwing; the caller (transcribe.ts's rewriteClipboardForCommand) treats
 * `ok: false` as "leave the clipboard text untouched", never pastes
 * something the model didn't actually produce.
 */
export async function rewriteSelection(selection: string, opts: CommandRewriteOptions): Promise<CleanupResult> {
  if (!opts.command || !opts.command.trim()) return { text: selection, ok: false }
  const messages = buildCommandMessages({ command: opts.command, selection })
  return runCleanupCore(selection, messages, opts.provider, opts.signal)
}
