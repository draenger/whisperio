import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import { useTranscriptSearch } from '../../hooks/useTranscriptSearch'
import { TranscriptSearchResults } from './TranscriptSearchResults'

/* ─── Full-text search entry point (search box + results panel) ───
 *
 * Sits at the top of the recordings list. While the box is empty it's just an
 * input; as soon as there's a query the results panel takes over the space
 * above the list, and clearing the box puts the list straight back — no route,
 * no modal, nothing to dismiss.
 *
 * Ctrl+F (Cmd+F on macOS) focuses and selects the box. The shortcut is only
 * swallowed (preventDefault) once we know we're going to handle it, and it is
 * deliberately still honoured while another input has focus: in a window whose
 * entire content is transcripts, "find" can only plausibly mean this.
 */

export interface TranscriptSearchProps {
  theme: Theme
  formatDate: (timestamp: number) => string
  onOpenRecording: (recordingId: string) => void
  /** Notified whenever the search box goes from empty to non-empty and back,
   *  so the host view can swap the recordings list out for the results panel
   *  without this component having to own the list. */
  onActiveChange?: (active: boolean) => void
  /** Debounce override — the tests drive this; production uses the default. */
  debounceMs?: number
}

export function TranscriptSearch({
  theme,
  formatDate,
  onOpenRecording,
  onActiveChange,
  debounceMs
}: TranscriptSearchProps): ReactElement {
  const { query, setQuery, clear, results, loading, error, active } = useTranscriptSearch(debounceMs)
  const inputRef = useRef<HTMLInputElement>(null)
  const s = makeStyles(theme)

  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const isFindCombo = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f'
      if (!isFindCombo) return
      const input = inputRef.current
      if (!input) return
      event.preventDefault()
      input.focus()
      input.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div style={s.wrap}>
      <div style={s.field}>
        <span style={s.icon} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          aria-label="Search transcripts"
          placeholder="Search transcripts…  (Ctrl+F)"
          data-testid="transcript-search-input"
          style={s.input}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              clear()
            }
          }}
        />
        {active && (
          <button
            type="button"
            aria-label="Clear search"
            data-testid="transcript-search-clear"
            style={s.clear}
            onClick={() => {
              clear()
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        )}
      </div>

      {active && (
        <TranscriptSearchResults
          theme={theme}
          results={results}
          loading={loading}
          error={error}
          query={query.trim()}
          formatDate={formatDate}
          onOpenRecording={onOpenRecording}
        />
      )}
    </div>
  )
}

function makeStyles(theme: Theme): Record<string, CSSProperties> {
  return {
    wrap: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    },
    field: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      background: theme.inputBg,
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '12px',
      padding: '8px 12px'
    },
    icon: {
      display: 'flex',
      flexShrink: 0,
      color: theme.textMuted
    },
    input: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: theme.text,
      fontSize: '13px',
      fontFamily: 'IBM Plex Sans, sans-serif'
    },
    clear: {
      background: 'transparent',
      border: 'none',
      color: theme.textMuted,
      cursor: 'pointer',
      fontSize: '16px',
      lineHeight: 1,
      padding: '0 2px'
    }
  }
}
