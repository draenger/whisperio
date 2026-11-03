import { normalizeSnippetPhrase } from '../shared/snippets'

// Snippets (Wispr-Flow parity, Phase 1 #2 — exact-match variant).
//
// A snippet maps a spoken TRIGGER phrase to a stored replacement TEXT, e.g.
// "my address" -> "221B Baker Street, London NW1 6XE". When the user's whole
// final transcript (after AI cleanup, if any) IS the trigger phrase, the
// transcript is replaced by the snippet text.
//
// Matching contract (pure, no I/O, language-agnostic):
//   - whole-phrase: the ENTIRE transcript must equal the trigger. A trigger
//     that merely appears inside a longer sentence never fires — that keeps
//     ordinary dictation from being silently rewritten.
//   - case-insensitive (Unicode-aware toLowerCase after NFC normalisation, so
//     "Mój Adres" == "mój adres" and composed/decomposed accents compare equal).
//   - punctuation-tolerant at the edges only: leading/trailing whitespace and
//     Unicode punctuation (\p{P}, e.g. STT/cleanup adding "My address." or
//     "¿mi dirección?") are ignored on both sides. Punctuation INSIDE the
//     phrase still has to match; runs of internal whitespace collapse to one.
//   - first matching snippet (list order) wins; empty triggers never match.
//   - an empty / missing snippet list is a no-op (feature off).

export interface Snippet {
  trigger: string
  text: string
}

export { normalizeSnippetPhrase } from '../shared/snippets'

/** Keeps only well-formed entries (string trigger with content, string text). */
export function sanitizeSnippets(value: unknown): Snippet[] {
  if (!Array.isArray(value)) return []
  const out: Snippet[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { trigger, text } = item as Record<string, unknown>
    if (typeof trigger !== 'string' || typeof text !== 'string') continue
    out.push({ trigger, text })
  }
  return out
}

/**
 * Returns the snippet text when `text` (as a whole) matches a trigger,
 * otherwise `text` unchanged.
 */
export function expandSnippets(text: string, snippets: readonly Snippet[] | null | undefined): string {
  if (!text || !snippets || snippets.length === 0) return text
  const spoken = normalizeSnippetPhrase(text)
  if (!spoken) return text
  for (const snippet of snippets) {
    if (!snippet || typeof snippet.trigger !== 'string' || typeof snippet.text !== 'string') continue
    const trigger = normalizeSnippetPhrase(snippet.trigger)
    if (trigger && trigger === spoken && snippet.text.trim()) return snippet.text
  }
  return text
}
