/* ─── Full-text search: bounded snippets with structured highlight segments ───
 *
 * The renderer must never receive HTML built from transcript text (that would
 * be an injection surface on data the user dictated). Instead a snippet is a
 * flat list of typed segments — 'text' and 'match' — that the results
 * component renders as React nodes / <mark>. Every segment value is sliced
 * from the ORIGINAL transcript, so casing and Polish diacritics survive
 * untouched even though the matching itself ran on folded text.
 */

import type { MatchRange } from './normalize'

export type SearchSnippetSegment = { type: 'text' | 'match'; value: string }

/** Characters of context kept before the first match, when there is room. */
const LEAD_CONTEXT = 60

/** Truncation indicator. Not counted against `maxLength` — the bounded part is
 *  the transcript text itself (at most `maxLength` characters), plus at most
 *  one leading and one trailing ellipsis. */
const ELLIPSIS = '…'

/**
 * A window of at most `maxLength` characters of `source`, centred on the first
 * match, split into text/match segments.
 *
 * With no matches (a filename-only hit) the snippet is simply the head of the
 * transcript, so the row still shows what the recording was about.
 */
export function buildSnippet(
  source: string,
  matches: MatchRange[],
  maxLength: number
): SearchSnippetSegment[] {
  if (!source) return []

  const first = matches.length > 0 ? matches[0] : null
  let windowStart = first ? Math.max(0, first.start - LEAD_CONTEXT) : 0
  let windowEnd = Math.min(source.length, windowStart + maxLength)
  // If the tail ran out before the budget did, spend what's left backwards so
  // the snippet is always as wide as it is allowed to be.
  windowStart = Math.max(0, Math.min(windowStart, windowEnd - maxLength))

  const segments: SearchSnippetSegment[] = []
  let cursor = windowStart
  for (const match of matches) {
    if (match.end <= windowStart) continue
    if (match.start >= windowEnd) break
    const start = Math.max(match.start, windowStart)
    const end = Math.min(match.end, windowEnd)
    if (start > cursor) segments.push({ type: 'text', value: source.slice(cursor, start) })
    if (end > start) segments.push({ type: 'match', value: source.slice(start, end) })
    cursor = Math.max(cursor, end)
  }
  if (cursor < windowEnd) segments.push({ type: 'text', value: source.slice(cursor, windowEnd) })

  if (windowStart > 0) segments.unshift({ type: 'text', value: ELLIPSIS })
  if (windowEnd < source.length) segments.push({ type: 'text', value: ELLIPSIS })

  return segments
}
