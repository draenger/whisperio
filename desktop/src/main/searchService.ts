/* ─── Full-text search across every saved transcript ───
 *
 * Read-time search over the EXISTING storage layer (recordingStore) — no index
 * file, no second copy of the transcripts, nothing to migrate or keep in sync.
 * A dictation corpus is a few thousand short strings at worst, so a scan per
 * query is cheap; if that ever stops being true, the place to add an index is
 * behind this module's `searchTranscripts()` signature, not in the renderer.
 *
 * RANKING (deterministic — never depends on storage enumeration order):
 *
 *   score = 1000 · filename matched all terms
 *         +  100 · whole query appears verbatim in the filename
 *         +  500 · whole query appears verbatim in the transcript
 *         +    2 · min(term occurrences in transcript, 50)
 *
 *   ties break on, in order: earlier first match → newer recording → id.
 *
 * The weights are spread far enough apart that each factor strictly dominates
 * the ones below it: a filename hit always outranks a transcript-only hit, and
 * an exact-phrase hit always outranks a same-terms-scattered hit, no matter how
 * many occurrences the weaker result piles up (the occurrence term is capped at
 * 100 for exactly this reason).
 */

import { getRecordings } from './recordingStore'
import { foldWithIndex, findMatches, mergeRanges, type MatchRange } from './search/normalize'
import { buildSnippet, type SearchSnippetSegment } from './search/snippet'

export type { SearchSnippetSegment }

/** Longer queries are TRUNCATED, not rejected: search is called from a
 *  debounced input, so a pathological paste should degrade quietly rather than
 *  surface an error dialog mid-typing. */
export const SEARCH_MAX_QUERY_LENGTH = 200
export const SEARCH_MAX_RESULTS = 50
export const SEARCH_MAX_SNIPPET_LENGTH = 240

const SCORE_FILENAME_TERMS = 1000
const SCORE_FILENAME_PHRASE = 100
const SCORE_TRANSCRIPT_PHRASE = 500
const SCORE_PER_OCCURRENCE = 2
const MAX_SCORED_OCCURRENCES = 50

/** The subset of RecordingEntry search needs. Kept structural (not an import of
 *  RecordingEntry) so the ranking core stays testable without the storage
 *  layer or an Electron runtime behind it. */
export interface SearchableRecording {
  id: string
  filename: string
  timestamp: number
  duration?: number
  provider?: string
  status?: 'completed' | 'failed' | 'pending'
  transcription?: string
}

export interface TranscriptSearchResult {
  /** Canonical recording id — the renderer opens recordings by this, never by
   *  a filesystem path (no `filepath` is ever returned to the renderer). */
  recordingId: string
  filename: string
  timestamp: number
  duration: number
  provider: string
  status: 'completed' | 'failed' | 'pending'
  snippet: SearchSnippetSegment[]
  /** True when the query matched the recording's filename, not just its text. */
  filenameMatched: boolean
  matchCount: number
  score: number
}

interface ScoredResult {
  result: TranscriptSearchResult
  firstMatch: number
}

function isSearchable(value: unknown): value is SearchableRecording {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SearchableRecording>
  return typeof record.id === 'string' && record.id.length > 0
}

/** Score one record, or null when it doesn't match every term. */
function scoreRecord(
  record: SearchableRecording,
  phrase: string,
  terms: string[]
): ScoredResult | null {
  const transcript = typeof record.transcription === 'string' ? record.transcription : ''
  const filename = typeof record.filename === 'string' ? record.filename : ''

  const foldedTranscript = foldWithIndex(transcript)
  const foldedFilename = foldWithIndex(filename)

  const transcriptRanges: MatchRange[] = []
  let occurrences = 0
  let filenameTerms = 0

  for (const term of terms) {
    const inTranscript = findMatches(foldedTranscript, term)
    const inFilename = findMatches(foldedFilename, term)
    if (inTranscript.length === 0 && inFilename.length === 0) return null
    transcriptRanges.push(...inTranscript)
    occurrences += inTranscript.length
    if (inFilename.length > 0) filenameTerms++
  }

  const filenameMatched = filenameTerms === terms.length
  const phraseInFilename = findMatches(foldedFilename, phrase).length > 0
  const phraseRanges = findMatches(foldedTranscript, phrase)

  const score =
    (filenameMatched ? SCORE_FILENAME_TERMS : 0) +
    (phraseInFilename ? SCORE_FILENAME_PHRASE : 0) +
    (phraseRanges.length > 0 ? SCORE_TRANSCRIPT_PHRASE : 0) +
    Math.min(occurrences, MAX_SCORED_OCCURRENCES) * SCORE_PER_OCCURRENCE

  // Highlight the phrase itself when it's present, so a multi-word query marks
  // "raport roczny" as one span rather than two adjacent ones.
  const highlights = mergeRanges(phraseRanges.length > 0 ? phraseRanges : transcriptRanges)

  return {
    firstMatch: highlights.length > 0 ? highlights[0].start : Number.MAX_SAFE_INTEGER,
    result: {
      recordingId: record.id,
      filename,
      timestamp: typeof record.timestamp === 'number' ? record.timestamp : 0,
      duration: typeof record.duration === 'number' ? record.duration : 0,
      provider: typeof record.provider === 'string' ? record.provider : '',
      status: record.status ?? 'completed',
      snippet: buildSnippet(transcript, highlights, SEARCH_MAX_SNIPPET_LENGTH),
      filenameMatched,
      matchCount: occurrences,
      score
    }
  }
}

/**
 * Rank `records` against `query`. Pure — this is the unit under test; the
 * storage-backed entry point below is the thin wrapper around it.
 */
export function searchRecordings(query: string, records: unknown[]): TranscriptSearchResult[] {
  if (typeof query !== 'string') return []

  const bounded = query.trim().slice(0, SEARCH_MAX_QUERY_LENGTH)
  const phrase = foldWithIndex(bounded).value
  // Empty / whitespace-only / punctuation-and-combining-marks-only queries stop
  // here, BEFORE a single record is touched.
  if (!phrase) return []

  const terms = phrase.split(' ').filter(Boolean)
  if (terms.length === 0) return []

  const scored: ScoredResult[] = []
  for (const candidate of records) {
    // One malformed row must never take the whole search down with it.
    if (!isSearchable(candidate)) continue
    try {
      const hit = scoreRecord(candidate, phrase, terms)
      if (hit) scored.push(hit)
    } catch {
      /* unreadable/oddly-shaped record — skip it, keep searching the rest */
    }
  }

  scored.sort(
    (a, b) =>
      b.result.score - a.result.score ||
      a.firstMatch - b.firstMatch ||
      b.result.timestamp - a.result.timestamp ||
      (a.result.recordingId < b.result.recordingId ? -1 : a.result.recordingId > b.result.recordingId ? 1 : 0)
  )

  return scored.slice(0, SEARCH_MAX_RESULTS).map((entry) => entry.result)
}

/**
 * Storage-backed entry point behind the `recordings:search` IPC channel.
 * Enumerates through recordingStore (tombstones already filtered there) — the
 * renderer never supplies, or learns, a filesystem path.
 */
export function searchTranscripts(query: string): TranscriptSearchResult[] {
  if (typeof query !== 'string' || !query.trim()) return []
  return searchRecordings(query, getRecordings())
}
