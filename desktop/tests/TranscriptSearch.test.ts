// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createElement } from 'react'
import { act, render, cleanup, fireEvent, screen } from '@testing-library/react'
import { TranscriptSearch } from '../src/renderer/components/recordings/TranscriptSearch'
import { buildTheme } from '../src/renderer/theme'
import type { TranscriptSearchResult } from '../src/renderer/hooks/useTranscriptSearch'

/**
 * Renderer coverage for the search box + its debounced, stale-safe IPC use.
 *
 * No JSX (plain createElement) — same convention as the other *.test.ts files
 * in this repo. Timers are faked so the debounce window is asserted exactly
 * rather than waited out.
 */

const theme = buildTheme('dark', 'teal')
const DEBOUNCE = 250

function result(overrides: Partial<TranscriptSearchResult> = {}): TranscriptSearchResult {
  return {
    recordingId: 'rec-1',
    filename: 'recording-1.webm',
    timestamp: 1710000000000,
    duration: 12,
    provider: 'openai',
    status: 'completed',
    snippet: [{ type: 'match', value: 'ważny' }],
    filenameMatched: false,
    matchCount: 1,
    score: 502,
    ...overrides
  }
}

function mockSearch(impl?: (query: string) => Promise<TranscriptSearchResult[]>): ReturnType<typeof vi.fn> {
  const search = vi.fn(impl ?? (async () => [result()]))
  // @ts-expect-error minimal test double — only the method this component calls
  window.api = { recordings: { search } }
  return search
}

function renderSearch(): { onOpenRecording: ReturnType<typeof vi.fn> } {
  const onOpenRecording = vi.fn()
  render(
    createElement(TranscriptSearch, {
      theme,
      formatDate: (ts: number) => `date:${ts}`,
      onOpenRecording,
      debounceMs: DEBOUNCE
    })
  )
  return { onOpenRecording }
}

function type(value: string): void {
  fireEvent.change(screen.getByTestId('transcript-search-input'), { target: { value } })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await flush()
}

/** Drain the microtask queue so a resolved IPC promise has been applied to
 *  state. Timers are faked in this file, and RTL's polling helper schedules
 *  its own timers — which would never fire here. This is the explicit
 *  equivalent, with no wall-clock waiting at all. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('TranscriptSearch — input', () => {
  it('renders an accessibly labelled search box', () => {
    mockSearch()
    renderSearch()
    expect(screen.getByLabelText('Search transcripts')).toBeTruthy()
  })

  it('shows no results panel while the query is empty', () => {
    mockSearch()
    renderSearch()
    expect(screen.queryByTestId('search-results')).toBeNull()
    expect(screen.queryByTestId('search-empty')).toBeNull()
  })

  it('never calls IPC for an empty or whitespace-only query', async () => {
    const search = mockSearch()
    renderSearch()
    type('   ')
    await advance(DEBOUNCE * 4)
    expect(search).not.toHaveBeenCalled()
  })
})

describe('TranscriptSearch — debounce', () => {
  it('issues one request for a burst of keystrokes, after the debounce window', async () => {
    const search = mockSearch()
    renderSearch()

    type('w')
    type('wa')
    type('waz')
    type('wazny')
    await advance(DEBOUNCE - 1)
    expect(search).not.toHaveBeenCalled()

    await advance(2)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('wazny')
  })

  it('trims the query before sending it', async () => {
    const search = mockSearch()
    renderSearch()
    type('  wazny  ')
    await advance(DEBOUNCE)
    expect(search).toHaveBeenCalledWith('wazny')
  })
})

describe('TranscriptSearch — results', () => {
  it('renders returned results and opens the recording on click', async () => {
    mockSearch()
    const { onOpenRecording } = renderSearch()
    type('wazny')
    await advance(DEBOUNCE)

    expect(screen.getByTestId('search-result-rec-1')).toBeTruthy()
    fireEvent.click(screen.getByTestId('search-result-rec-1'))
    expect(onOpenRecording).toHaveBeenCalledWith('rec-1')
  })

  it('renders the no-results state when nothing matches', async () => {
    mockSearch(async () => [])
    renderSearch()
    type('faktura')
    await advance(DEBOUNCE)
    expect(screen.getByTestId('search-empty')).toBeTruthy()
  })

  it('surfaces an error state when the IPC call rejects, without crashing', async () => {
    mockSearch(async () => {
      throw new Error('no handler registered')
    })
    renderSearch()
    type('wazny')
    await advance(DEBOUNCE)

    expect(screen.getByTestId('search-error')).toBeTruthy()
    // The technical reason is not leaked to the user.
    expect(screen.getByTestId('search-error').textContent).not.toContain('no handler')
    expect((screen.getByTestId('transcript-search-input') as HTMLInputElement).value).toBe('wazny')
  })

  it('clears results and hides the panel when the query is cleared', async () => {
    mockSearch()
    renderSearch()
    type('wazny')
    await advance(DEBOUNCE)
    expect(screen.getByTestId('search-result-rec-1')).toBeTruthy()

    fireEvent.click(screen.getByTestId('transcript-search-clear'))
    await flush()
    expect(screen.queryByTestId('search-results')).toBeNull()
    expect((screen.getByTestId('transcript-search-input') as HTMLInputElement).value).toBe('')
  })

  it('clears the query on Escape', async () => {
    mockSearch()
    renderSearch()
    type('wazny')
    fireEvent.keyDown(screen.getByTestId('transcript-search-input'), { key: 'Escape' })
    await flush()
    expect((screen.getByTestId('transcript-search-input') as HTMLInputElement).value).toBe('')
  })

  it('does not let a slow response for an older query overwrite a newer one', async () => {
    const pending: Record<string, (value: TranscriptSearchResult[]) => void> = {}
    const search = mockSearch(
      (query) => new Promise<TranscriptSearchResult[]>((resolve) => (pending[query] = resolve))
    )
    renderSearch()

    type('wa')
    await advance(DEBOUNCE)
    type('wazny')
    await advance(DEBOUNCE)
    expect(search).toHaveBeenCalledTimes(2)

    // Newer query answers first...
    await act(async () => {
      pending['wazny']([result({ recordingId: 'rec-new' })])
    })
    await flush()
    expect(screen.getByTestId('search-result-rec-new')).toBeTruthy()

    // ...then the stale one lands and must be discarded.
    await act(async () => {
      pending['wa']([result({ recordingId: 'rec-stale' })])
    })
    await flush()
    expect(screen.queryByTestId('search-result-rec-stale')).toBeNull()
    expect(screen.getByTestId('search-result-rec-new')).toBeTruthy()
  })
})

describe('TranscriptSearch — Ctrl+F shortcut', () => {
  it('focuses and selects the search box on Ctrl+F, and swallows the native find', () => {
    mockSearch()
    renderSearch()
    const input = screen.getByTestId('transcript-search-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wazny' } })
    input.blur()

    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('wazny'.length)
    expect(event.defaultPrevented).toBe(true)
  })

  it('supports Meta+F (macOS)', () => {
    mockSearch()
    renderSearch()
    const input = screen.getByTestId('transcript-search-input')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(input)
  })

  it('ignores a plain "f" and other modifier combinations', () => {
    mockSearch()
    renderSearch()
    const input = screen.getByTestId('transcript-search-input')
    for (const init of [
      { key: 'f' },
      { key: 'f', altKey: true },
      { key: 'g', ctrlKey: true }
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, cancelable: true })
      act(() => {
        window.dispatchEvent(event)
      })
      expect(event.defaultPrevented).toBe(false)
      expect(document.activeElement).not.toBe(input)
    }
  })

  it('stops listening once unmounted', () => {
    mockSearch()
    renderSearch()
    cleanup()
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
  })
})
