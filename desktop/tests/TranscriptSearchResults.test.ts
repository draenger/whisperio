// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { TranscriptSearchResults } from '../src/renderer/components/recordings/TranscriptSearchResults'
import { buildTheme } from '../src/renderer/theme'
import type { TranscriptSearchResult } from '../src/renderer/hooks/useTranscriptSearch'

/**
 * Renderer coverage for the full-text search results list.
 *
 * No JSX here (plain createElement calls) — same convention as
 * tests/RecordingsPanel.test.ts / tests/CleanupPanel.test.ts: this repo's
 * *.test.ts files don't have the React JSX runtime wired up.
 */

const theme = buildTheme('dark', 'teal')

const formatDate = (timestamp: number): string => `date:${timestamp}`

const RESULT: TranscriptSearchResult = {
  recordingId: 'rec-1',
  filename: 'recording-2026-08-20-101500.webm',
  timestamp: 1710000000000,
  duration: 12.5,
  provider: 'openai',
  status: 'completed',
  snippet: [
    { type: 'text', value: 'To jest ' },
    { type: 'match', value: 'Ważny' },
    { type: 'text', value: ' raport i znowu ' },
    { type: 'match', value: 'ważny' },
    { type: 'text', value: ' temat' }
  ],
  filenameMatched: false,
  matchCount: 2,
  score: 504
}

function renderResults(overrides: Partial<Parameters<typeof TranscriptSearchResults>[0]> = {}): {
  onOpenRecording: ReturnType<typeof vi.fn>
} {
  const onOpenRecording = vi.fn()
  render(
    createElement(TranscriptSearchResults, {
      theme,
      results: [RESULT],
      loading: false,
      error: null,
      query: 'wazny',
      formatDate,
      onOpenRecording,
      ...overrides
    })
  )
  return { onOpenRecording }
}

afterEach(() => {
  cleanup()
})

describe('TranscriptSearchResults — rendering', () => {
  it('renders the recording date, filename and match count', () => {
    renderResults()
    const row = screen.getByTestId('search-result-rec-1')
    expect(within(row).getByText('date:1710000000000')).toBeTruthy()
    expect(within(row).getByText(RESULT.filename)).toBeTruthy()
    expect(within(row).getByText('2 matches')).toBeTruthy()
  })

  it('renders the snippet as text with matched terms in <mark>, keeping the original diacritics', () => {
    renderResults()
    const row = screen.getByTestId('search-result-rec-1')
    expect(row.textContent).toContain('To jest Ważny raport i znowu ważny temat')

    const marks = row.querySelectorAll('mark')
    expect(Array.from(marks).map((m) => m.textContent)).toEqual(['Ważny', 'ważny'])
  })

  it('renders transcript text as React nodes, never as injected HTML', () => {
    renderResults({
      results: [
        {
          ...RESULT,
          snippet: [
            { type: 'text', value: 'przed ' },
            { type: 'match', value: '<img src=x onerror=alert(1)>' },
            { type: 'text', value: ' po' }
          ]
        }
      ]
    })
    const row = screen.getByTestId('search-result-rec-1')
    expect(row.querySelector('img')).toBeNull()
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('flags a filename match with a badge', () => {
    renderResults({ results: [{ ...RESULT, filenameMatched: true }] })
    expect(screen.getByTestId('search-filename-badge-rec-1').textContent).toBe('filename')
  })

  it('omits the badge for a transcript-only match', () => {
    renderResults()
    expect(screen.queryByTestId('search-filename-badge-rec-1')).toBeNull()
  })

  it('says "1 match" (singular) for a single occurrence', () => {
    renderResults({ results: [{ ...RESULT, matchCount: 1 }] })
    expect(screen.getByText('1 match')).toBeTruthy()
  })

  it('renders every result with a stable row per recording id', () => {
    renderResults({
      results: [RESULT, { ...RESULT, recordingId: 'rec-2' }]
    })
    expect(screen.getByTestId('search-result-rec-1')).toBeTruthy()
    expect(screen.getByTestId('search-result-rec-2')).toBeTruthy()
  })
})

describe('TranscriptSearchResults — states', () => {
  it('renders the no-results state with the query echoed back', () => {
    renderResults({ results: [], query: 'faktura' })
    expect(screen.getByTestId('search-empty').textContent).toContain('faktura')
  })

  it('renders the loading state while the first response is in flight', () => {
    renderResults({ results: [], loading: true })
    expect(screen.getByTestId('search-loading')).toBeTruthy()
  })

  it('keeps showing results rather than flashing "Searching…" on a follow-up query', () => {
    renderResults({ loading: true })
    expect(screen.queryByTestId('search-loading')).toBeNull()
    expect(screen.getByTestId('search-result-rec-1')).toBeTruthy()
  })

  it('renders the error state as an alert and hides results', () => {
    renderResults({ error: 'Search is unavailable right now.' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Search is unavailable right now.')
    expect(screen.queryByTestId('search-result-rec-1')).toBeNull()
  })
})

describe('TranscriptSearchResults — activation', () => {
  it('calls onOpenRecording with the recording id on click', () => {
    const { onOpenRecording } = renderResults()
    fireEvent.click(screen.getByTestId('search-result-rec-1'))
    expect(onOpenRecording).toHaveBeenCalledWith('rec-1')
  })

  it('calls onOpenRecording when Enter is pressed on the focused result', () => {
    const { onOpenRecording } = renderResults({
      results: [RESULT, { ...RESULT, recordingId: 'rec-2' }]
    })
    const row = screen.getByTestId('search-result-rec-2')
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onOpenRecording).toHaveBeenCalledTimes(1)
    expect(onOpenRecording).toHaveBeenCalledWith('rec-2')
  })

  it('also activates on Space, and ignores unrelated keys', () => {
    const { onOpenRecording } = renderResults()
    const row = screen.getByTestId('search-result-rec-1')
    fireEvent.keyDown(row, { key: ' ' })
    expect(onOpenRecording).toHaveBeenCalledWith('rec-1')

    onOpenRecording.mockClear()
    fireEvent.keyDown(row, { key: 'a' })
    expect(onOpenRecording).not.toHaveBeenCalled()
  })

  it('exposes each result as a keyboard-reachable option', () => {
    renderResults()
    const row = screen.getByTestId('search-result-rec-1')
    expect(row.getAttribute('role')).toBe('option')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('listbox', { name: 'Search results' })).toBeTruthy()
  })
})
