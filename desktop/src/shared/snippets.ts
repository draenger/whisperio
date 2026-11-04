const EDGE_PUNCT = /^[\s\p{P}]+|[\s\p{P}]+$/gu
const INNER_WS = /\s+/gu

/** Canonical form used for snippet matching and duplicate validation only. */
export function normalizeSnippetPhrase(phrase: string): string {
  return phrase.normalize('NFC').replace(EDGE_PUNCT, '').replace(INNER_WS, ' ').toLowerCase()
}
