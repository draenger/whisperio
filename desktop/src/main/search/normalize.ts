/* ─── Full-text search: Unicode folding with an index map back to the source ───
 *
 * Search has to be BOTH case- and diacritics-insensitive ("wazny" must find
 * "ważny", and "ważny" must find "wazny"), while the snippet the user reads
 * keeps its original spelling, casing and ogonki. Those two requirements pull
 * in opposite directions: matching happens on a folded string whose character
 * offsets do NOT line up with the original one (a whitespace run collapses,
 * "ł" is remapped, a combining mark disappears).
 *
 * So folding here is done ONE SOURCE CHARACTER AT A TIME, recording for every
 * folded character the [start, end) slice of the ORIGINAL string that produced
 * it. A match found in the folded text can then be projected back onto exact
 * original coordinates — never by applying a folded offset to the raw string,
 * which would silently drift on any Polish text.
 */

/** Characters NFD refuses to decompose — "ł" carries its stroke as part of the
 *  base glyph, so `'ł'.normalize('NFD')` is still "ł". These are folded by hand.
 *  (Polish only needs ł/Ł; the rest are common European neighbours that would
 *  otherwise fall through unfolded.) */
const HARD_FOLD: Record<string, string> = {
  ł: 'l',
  Ł: 'l',
  ß: 'ss',
  đ: 'd',
  Đ: 'd',
  ø: 'o',
  Ø: 'o',
  æ: 'ae',
  Æ: 'ae'
}

/** Fold a single source character: hard-map, strip combining marks, lowercase.
 *  May return '' (e.g. a bare combining mark) or several characters (ß → ss). */
function foldChar(ch: string): string {
  const hard = HARD_FOLD[ch]
  if (hard !== undefined) return hard
  return ch.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

export interface FoldedText {
  /** Lowercased, diacritics-stripped text with whitespace runs collapsed to a
   *  single space and both ends trimmed. Matching happens against this. */
  value: string
  /** starts[i] — index in the ORIGINAL string where value[i] came from. */
  starts: number[]
  /** ends[i] — index in the ORIGINAL string just past value[i]'s source char. */
  ends: number[]
}

const EMPTY_FOLDED: FoldedText = { value: '', starts: [], ends: [] }

/** Fold `source`, keeping a per-character map back to original coordinates. */
export function foldWithIndex(source: string): FoldedText {
  if (typeof source !== 'string' || source.length === 0) return EMPTY_FOLDED

  let value = ''
  const starts: number[] = []
  const ends: number[] = []
  // Starts true so leading whitespace is dropped outright (acts as a left trim).
  let lastWasSpace = true

  let i = 0
  while (i < source.length) {
    // Iterate by code point, not UTF-16 unit, so a surrogate pair is folded as
    // one character — but keep `i`/`next` in UTF-16 units, which is what
    // String.prototype.slice() on the original text expects.
    const ch = String.fromCodePoint(source.codePointAt(i)!)
    const next = i + ch.length

    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        value += ' '
        starts.push(i)
        ends.push(next)
        lastWasSpace = true
      }
    } else {
      const folded = foldChar(ch)
      // Index by UTF-16 unit, NOT by code point: `value` is measured in units
      // (that's what indexOf/slice work in), so the map has to grow one entry
      // per unit or every offset past an astral character silently shifts.
      for (let k = 0; k < folded.length; k++) {
        value += folded[k]
        starts.push(i)
        ends.push(next)
      }
      if (folded.length > 0) lastWasSpace = false
    }
    i = next
  }

  // Right trim: a trailing collapsed space would make "kot " miss "kot".
  while (value.endsWith(' ')) {
    value = value.slice(0, -1)
    starts.pop()
    ends.pop()
  }

  return { value, starts, ends }
}

/** Convenience wrapper — the folded string only, no index map. */
export function normalizeSearchText(source: string): string {
  return foldWithIndex(source).value
}

/** A match expressed in ORIGINAL-string coordinates. */
export interface MatchRange {
  start: number
  end: number
}

/**
 * Every non-overlapping occurrence of `needle` (already folded) inside
 * `folded`, projected back onto original coordinates.
 */
export function findMatches(folded: FoldedText, needle: string): MatchRange[] {
  if (!needle || !folded.value) return []

  const ranges: MatchRange[] = []
  let from = 0
  for (;;) {
    const at = folded.value.indexOf(needle, from)
    if (at === -1) break
    ranges.push({ start: folded.starts[at], end: folded.ends[at + needle.length - 1] })
    from = at + needle.length
  }
  return ranges
}

/** Merge overlapping/adjacent ranges from several terms into a clean, sorted
 *  highlight set — otherwise "kot kotek" would emit nested <mark>s. */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length < 2) return [...ranges]

  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: MatchRange[] = [{ ...sorted[0] }]
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}
