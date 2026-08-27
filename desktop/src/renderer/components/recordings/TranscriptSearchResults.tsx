import { useState, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import type { TranscriptSearchResult } from '../../hooks/useTranscriptSearch'

/* ─── Full-text search results ───
 *
 * Pure presentation: it renders what searchService.ts already decided (order,
 * snippet window, which spans matched) and reports activation back up. It does
 * NOT open recordings itself — `onOpenRecording(recordingId)` hands the id to
 * RecordingsView's existing selection flow, so search never grows a second way
 * to load a recording.
 *
 * Snippets arrive as typed segments, never as markup: nothing here goes near
 * dangerouslySetInnerHTML, so transcript text is always rendered as React text.
 * All colors come from `theme` (= --wsp-* tokens, see theme.ts) — no literals.
 */

export interface TranscriptSearchResultsProps {
  theme: Theme
  results: TranscriptSearchResult[]
  loading: boolean
  error: string | null
  query: string
  formatDate: (timestamp: number) => string
  onOpenRecording: (recordingId: string) => void
}

export function TranscriptSearchResults({
  theme,
  results,
  loading,
  error,
  query,
  formatDate,
  onOpenRecording
}: TranscriptSearchResultsProps): ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const s = makeStyles(theme)

  if (error) {
    return (
      <div style={s.state} role="alert" data-testid="search-error">
        {error}
      </div>
    )
  }

  if (loading && results.length === 0) {
    return (
      <div style={s.state} data-testid="search-loading">
        Searching…
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div style={s.state} data-testid="search-empty">
        No transcripts match “{query}”.
      </div>
    )
  }

  return (
    <div style={s.list} role="listbox" aria-label="Search results" data-testid="search-results">
      {results.map((result) => {
        const hovered = hoveredId === result.recordingId
        return (
          <div
            key={result.recordingId}
            role="option"
            aria-selected={false}
            tabIndex={0}
            data-testid={`search-result-${result.recordingId}`}
            style={{ ...s.row, borderColor: hovered ? theme.accent : theme.border }}
            onClick={() => onOpenRecording(result.recordingId)}
            // Explicit key handling rather than a native <button>: the row is a
            // multi-line card, and this keeps Enter/Space activation identical
            // in every environment instead of relying on implicit click
            // synthesis. Space is preventDefault'd so it doesn't scroll.
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpenRecording(result.recordingId)
              }
            }}
            onMouseEnter={() => setHoveredId(result.recordingId)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div style={s.rowHeader}>
              <span style={s.date}>{formatDate(result.timestamp)}</span>
              <span style={s.filename}>{result.filename}</span>
              {result.filenameMatched && (
                <span style={s.badge} data-testid={`search-filename-badge-${result.recordingId}`}>
                  filename
                </span>
              )}
              <span style={s.meta}>
                {result.matchCount} match{result.matchCount !== 1 ? 'es' : ''}
              </span>
            </div>
            <div style={s.snippet}>
              {result.snippet.map((segment, index) =>
                segment.type === 'match' ? (
                  <mark key={index} style={s.mark}>
                    {segment.value}
                  </mark>
                ) : (
                  <span key={index}>{segment.value}</span>
                )
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function makeStyles(theme: Theme): Record<string, CSSProperties> {
  return {
    list: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    },
    state: {
      padding: '14px 4px',
      fontSize: '12px',
      color: theme.textMuted
    },
    row: {
      background: theme.bgSecondary,
      border: `1px solid ${theme.border}`,
      borderRadius: '14px',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      cursor: 'pointer',
      boxShadow: theme.e1,
      transition: 'border-color 0.15s'
    },
    rowHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap'
    },
    date: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '.04em',
      color: theme.textSecondary
    },
    filename: {
      fontSize: '11px',
      color: theme.textMuted,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '240px'
    },
    badge: {
      fontSize: '10px',
      fontWeight: 600,
      letterSpacing: '.04em',
      color: theme.accent,
      border: `1px solid ${theme.accent}`,
      borderRadius: 999,
      padding: '1px 8px'
    },
    meta: {
      fontSize: '11px',
      color: theme.textMuted,
      marginLeft: 'auto'
    },
    snippet: {
      fontSize: '12.5px',
      lineHeight: 1.55,
      color: theme.text,
      wordBreak: 'break-word'
    },
    mark: {
      background: theme.accentGlow,
      color: theme.text,
      borderRadius: '4px',
      padding: '0 2px'
    }
  }
}
