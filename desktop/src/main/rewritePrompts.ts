import type { Identifiable } from './seededStore'

// Rewrite presets — the catalog of "render" instructions the app can apply to a
// transcript (fix technical terms, clean up, email, bullets…). A TS port of the
// mobile RewritePresetCatalog seeds, PLUS the existing desktop technical-terms
// post-processing prompt as a first-class seed so today's behavior is preserved.
//
// Seeds ship read-only; users may edit/delete/add via the generic seededStore
// (soft-delete + restore). This module stays PURE (no fs/electron) so it unit-
// tests trivially — the persistence + path resolution live in the wiring layer.

export interface RewritePreset extends Identifiable {
  id: string
  name: string
  prompt: string
  icon: string
  isSeed: boolean
}

/** File (under userData) the persisted rewrite-preset edit state is stored in. */
export const REWRITE_PRESETS_FILENAME = 'rewrite-presets.json'

/** Id of the default post-processing preset (preserves the pre-existing behavior). */
export const TECHNICAL_TERMS_PRESET_ID = 'technical-terms'

// The exact system prompt the previous hardcoded postProcessWithLLM used, with
// the vocabulary list turned into a `{{vocabulary}}` placeholder that
// buildRewriteMessages substitutes. Keeping it verbatim preserves behavior.
const TECHNICAL_TERMS_PROMPT =
  `Fix misrecognized technical terms in this speech-to-text transcript. ` +
  `Use these exact spellings: {{vocabulary}}\n\n` +
  `Rules:\n` +
  `- Only fix obvious speech recognition errors (e.g. "get" → "git", "get hub" → "GitHub")\n` +
  `- Do NOT change meaning, rephrase, add words, or remove words\n` +
  `- Preserve the original language (Polish/English)\n` +
  `- Return ONLY the corrected text, nothing else`

/** The built-in rewrite presets, in display order. Ids are stable keys. */
export const REWRITE_SEEDS: RewritePreset[] = [
  {
    id: TECHNICAL_TERMS_PRESET_ID,
    name: 'Fix technical terms',
    prompt: TECHNICAL_TERMS_PROMPT,
    icon: 'wrench',
    isSeed: true
  },
  {
    id: 'clean-up',
    name: 'Clean up',
    prompt:
      'You are a transcript editor. Rewrite the text below so it reads cleanly: fix punctuation, ' +
      'capitalization, and obvious speech-to-text errors, remove filler words (um, uh, you know, like), ' +
      'and merge false starts. Do not change the meaning, add information, or summarize. Keep the ' +
      'original language. Return only the cleaned text.',
    icon: 'spark',
    isSeed: true
  },
  {
    id: 'email',
    name: 'Email',
    prompt:
      'Turn the following spoken notes into a clear, polite email. Infer a suitable subject line and put ' +
      "it on the first line prefixed with 'Subject: '. Use a natural greeting and sign-off, group the " +
      'content into short paragraphs, and keep every fact from the notes without inventing details. Match ' +
      'the language of the notes. Return only the email.',
    icon: 'send',
    isSeed: true
  },
  {
    id: 'english-message',
    name: 'Message in English',
    prompt:
      'Translate and rewrite the following into a natural, friendly English message suitable for a chat ' +
      'app. Keep it concise and conversational, preserve all the meaning, and fix any grammar so it reads ' +
      'like a fluent native speaker wrote it. Return only the English message.',
    icon: 'globe',
    isSeed: true
  },
  {
    id: 'bullets',
    name: 'Bullet summary',
    prompt:
      'Summarize the following into 3-6 concise bullet points capturing the key points and any action ' +
      "items. Start each bullet with '- '. Do not add information that isn't in the text. Keep the " +
      'original language. Return only the bullet list.',
    icon: 'list',
    isSeed: true
  },
  {
    id: 'slack',
    name: 'Slack message',
    prompt:
      'Rewrite the following spoken notes as a short, friendly Slack message for teammates. Keep it casual ' +
      'but clear, use line breaks for readability, and add a relevant emoji only where it feels natural. ' +
      'Preserve all facts and the original language. Return only the message.',
    icon: 'message',
    isSeed: true
  },
  {
    id: 'tweet',
    name: 'Tweet',
    prompt:
      'Rewrite the following as a single engaging post of at most 280 characters. Keep the core point, ' +
      'make it punchy, drop hashtags unless they add real value, and never exceed 280 characters. Match ' +
      'the original language. Return only the post text.',
    icon: 'spark',
    isSeed: true
  }
]

export interface RewriteMessages {
  system: string
  user: string
}

/**
 * Build the (system, user) pair a chat model applies to run a rewrite. The
 * chosen prompt (a preset's prompt or a BYO customPrompt) becomes the system
 * message with any `{{vocabulary}}` placeholder substituted; the transcript
 * becomes the (trimmed) user message. An empty/whitespace-only transcript yields
 * an empty user message so callers can guard (nothing to rewrite).
 */
export function buildRewriteMessages(
  input: { preset?: RewritePreset; customPrompt?: string },
  transcript: string,
  vocabulary = ''
): RewriteMessages {
  const raw = (input.customPrompt ?? input.preset?.prompt ?? '').trim()
  const system = raw.replace(/\{\{\s*vocabulary\s*\}\}/g, vocabulary)
  const user = (transcript ?? '').trim()
  return { system, user }
}

/**
 * Resolve the system prompt for the auto post-process path from the selected /
 * default preset, falling back to the technical-terms seed (today's behavior).
 */
export function resolveRewriteSystemPrompt(
  presets: RewritePreset[],
  presetId: string | undefined,
  vocabulary: string
): string {
  const preset =
    (presetId ? presets.find((p) => p.id === presetId) : undefined) ??
    presets.find((p) => p.id === TECHNICAL_TERMS_PRESET_ID) ??
    presets[0]
  if (!preset) return ''
  return buildRewriteMessages({ preset }, '', vocabulary).system
}
