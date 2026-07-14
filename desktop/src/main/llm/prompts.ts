// Pure prompt builders for the LLM abstraction (v1.4 STEP1). No I/O, no
// provider imports — just strings in, `LLMMessage[]` out, so every prompt
// change is a one-line diff to review and a plain-data assertion to test.

import type { LLMMessage } from './provider'

export type CleanupMode = 'full' | 'light'

// Context-aware tone (v1.5 Work Item B). Extensible — new profiles can be
// added here as long as a matching entry is added to
// TONE_PROFILE_DESCRIPTIONS below. Owned here (not settingsManager.ts or
// context.ts) so the "what profiles exist and how are they described to the
// model" concern lives in exactly one place; other modules that need the type
// (settingsManager.ts's toneMap, context.ts's resolveToneProfile) import it
// `import type` — no runtime dependency on this file.
export type ToneProfileId = 'neutral' | 'casual' | 'formal' | 'technical'

// Short, language-agnostic register descriptions rendered into the cleanup
// system prompt's "Tone profile:" line (buildCleanupSystemPrompt below) once
// context-aware tone resolves a profile for the app the user was dictating
// into (see transcribe.ts's resolveToneDescription()). Deliberately terse —
// these describe REGISTER only, never content: CLEANUP_RULES rule 7 below
// already constrains the model to "adjust only register — never meaning"
// regardless of which profile is active, so these strings don't need to
// repeat that guardrail themselves.
export const TONE_PROFILE_DESCRIPTIONS: Record<ToneProfileId, string> = {
  neutral: 'balanced, plain register — no strong formality either way',
  casual: 'relaxed register: contractions welcome, casual phrasing, light emoji tolerated only if the speaker used them',
  formal: 'polished, professional register: no slang, no contractions, no emoji',
  technical: 'precise, matter-of-fact register: keep technical terms and jargon exactly as spoken, no embellishment'
}

export interface CleanupPromptInput {
  raw: string
  /** Comma/newline-separated preferred spellings, or '' when none configured. */
  vocab: string
  /** Free-text tone/register instruction, or '' when none configured. */
  tone: string
  mode: CleanupMode
}

// Numbered rules for the 'full' cleanup system prompt, in order. 'light'
// mode drops the self-correction rule (4) and the tone rule (7) and
// renumbers what's left, so both modes are generated from this one list —
// there's no separate hand-maintained "light" prompt to drift out of sync.
const CLEANUP_RULES: string[] = [
  'Detect the input language and reply in that SAME language. Never translate.',
  'Remove filler words, hesitations, and false starts appropriate to that language.',
  'Add correct punctuation, capitalization, and paragraph breaks at natural boundaries.',
  'Resolve self-corrections: when the speaker revises themselves, keep ONLY the final intended version.\n   Correction cues vary by language — infer from meaning, not a fixed word list.',
  'Never add, invent, summarize, or drop meaningful content. Preserve words and intent.',
  'Preserve proper nouns and technical terms; if a term matches the preferred-spelling list, use that spelling.',
  'If a tone profile is provided, adjust only register — never meaning.'
]

// 1-based rule numbers included per mode, in order. 'light' omits rule 4
// (self-correction) and rule 7 (tone) and renumbers the rest 1..5.
const RULE_INDEXES_BY_MODE: Record<CleanupMode, number[]> = {
  full: [1, 2, 3, 4, 5, 6, 7],
  light: [1, 2, 3, 5, 6]
}

function orNone(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : '(none)'
}

function buildCleanupSystemPrompt(mode: CleanupMode, vocab: string, tone: string): string {
  const rules = RULE_INDEXES_BY_MODE[mode]
    .map((ruleNumber, i) => `${i + 1}. ${CLEANUP_RULES[ruleNumber - 1]}`)
    .join('\n')

  return (
    'You are a speech-to-text cleanup engine. Return ONLY the cleaned text — no commentary, no quotes, no preamble.\n' +
    `${rules}\n` +
    `Preferred spellings: ${orNone(vocab)}\n` +
    `Tone profile: ${orNone(tone)}`
  )
}

/**
 * Build the messages for a transcript-cleanup completion call. `raw` is
 * passed through as the user message verbatim — the system prompt carries
 * all the instructions.
 */
export function buildCleanupMessages({ raw, vocab, tone, mode }: CleanupPromptInput): LLMMessage[] {
  return [
    { role: 'system', content: buildCleanupSystemPrompt(mode, vocab, tone) },
    { role: 'user', content: raw }
  ]
}

export interface FormatPromptInput {
  raw: string
  /** A cleanupTemplates[].prompt from settingsManager.ts, or a one-off free-text
   * instruction typed by the user in RecordingsPanel's "Custom instruction..." field. */
  instruction: string
}

// Used for the ROUGH-FIRST on-demand cleanup action (RecordingsPanel "Clean
// up" -> template or custom instruction), as opposed to buildCleanupMessages'
// full/light rule-based cleanup. Same output discipline (language preserved,
// text only) but the transform itself is whatever `instruction` says, not a
// fixed rule set — so, unlike CLEANUP_RULES, there's nothing to numbers/render
// per mode here.
const FORMAT_SYSTEM_PROMPT_PREFIX =
  'You are a speech-to-text formatting engine. Transform the input text below according to the instruction. ' +
  'Detect the input language and reply in that SAME language — never translate unless the instruction explicitly ' +
  'asks you to. Return ONLY the resulting text — no commentary, no quotes, no preamble.\n\nInstruction: '

/**
 * Build the messages for an on-demand "format this transcript per a
 * template/custom instruction" completion call. Pure builder, same shape as
 * buildCleanupMessages: system prompt carries the instructions, `raw` passes
 * through verbatim as the user message.
 */
export function buildFormatMessages({ raw, instruction }: FormatPromptInput): LLMMessage[] {
  return [
    { role: 'system', content: `${FORMAT_SYSTEM_PROMPT_PREFIX}${instruction.trim()}` },
    { role: 'user', content: raw }
  ]
}

export interface CommandPromptInput {
  /** The user's instruction, e.g. "make this more formal", "fix grammar". */
  command: string
  /** The selected text the instruction applies to. */
  selection: string
}

// Forward-looking: not wired to a provider call yet (Work Item E — apply an
// ad-hoc instruction to selected text from a context menu). Included now so
// the prompt-building surface for that feature lives next to its sibling
// and follows the same "pure builder, same system-prompt discipline" shape.
const COMMAND_SYSTEM_PROMPT =
  "You are a text-editing assistant. Apply the user's instruction to the given text and return ONLY the " +
  'resulting text — no commentary, no quotes, no preamble. Preserve the original language unless the ' +
  'instruction explicitly asks to translate. Never add, invent, or drop content the instruction did not ' +
  'ask you to change.'

/**
 * Build the messages for an ad-hoc "apply this instruction to the selected
 * text" completion call.
 */
export function buildCommandMessages({ command, selection }: CommandPromptInput): LLMMessage[] {
  return [
    { role: 'system', content: COMMAND_SYSTEM_PROMPT },
    { role: 'user', content: `Instruction: ${command}\n\nText:\n${selection}` }
  ]
}
