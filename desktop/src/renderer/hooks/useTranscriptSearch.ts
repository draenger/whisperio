import { useCallback, useEffect, useRef, useState } from 'react'

/* ─── Debounced, stale-safe transcript search state ───
 *
 * Owns the whole renderer side of `window.api.recordings.search`: debounce,
 * loading/error states and — the part that's easy to get wrong — discarding
 * responses that belong to a query the user has already moved on from. Every
 * dispatch takes a ticket; only the newest ticket may write state, so a slow
 * answer for "wa" can never overwrite the results for "ważny".
 */

/** Long enough that ordinary typing produces one request, short enough that the
 *  results still feel live. */
export const SEARCH_DEBOUNCE_MS = 250

/** Mirrors src/preload/index.d.ts's SearchSnippetSegment / TranscriptSearchResult.
 *  Renderer-local copy, same convention as RecordingsPanel's RecordingEntry. */
export type SearchSnippetSegment = { type: 'text' | 'match'; value: string }

export interface TranscriptSearchResult {
  recordingId: string
  filename: string
  timestamp: number
  duration: number
  provider: string
  status: 'completed' | 'failed' | 'pending'
  snippet: SearchSnippetSegment[]
  filenameMatched: boolean
  matchCount: number
  score: number
}

export const SEARCH_ERROR_MESSAGE = 'Search is unavailable right now.'

export interface TranscriptSearchState {
  query: string
  setQuery: (query: string) => void
  clear: () => void
  results: TranscriptSearchResult[]
  loading: boolean
  error: string | null
  /** True once the query has any non-whitespace content — what the UI uses to
   *  decide whether the results panel is showing at all. */
  active: boolean
}

export function useTranscriptSearch(debounceMs: number = SEARCH_DEBOUNCE_MS): TranscriptSearchState {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TranscriptSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Monotonic ticket — bumped on dispatch AND on clear, so an in-flight request
  // is invalidated by emptying the box too.
  const ticketRef = useRef(0)

  const trimmed = query.trim()

  useEffect(() => {
    if (!trimmed) {
      ticketRef.current++
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    const timer = setTimeout(() => {
      const ticket = ++ticketRef.current
      void (async () => {
        try {
          const found = await window.api.recordings.search(trimmed)
          if (ticket !== ticketRef.current) return
          setResults(Array.isArray(found) ? found : [])
          setError(null)
        } catch {
          if (ticket !== ticketRef.current) return
          setResults([])
          setError(SEARCH_ERROR_MESSAGE)
        } finally {
          if (ticket === ticketRef.current) setLoading(false)
        }
      })()
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [trimmed, debounceMs])

  const clear = useCallback(() => setQuery(''), [])

  return { query, setQuery, clear, results, loading, error, active: trimmed.length > 0 }
}
