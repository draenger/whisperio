import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the storage layer, not the filesystem: searchService must go through
// recordingStore's public API and nothing else (no path building, no fs).
const getRecordings = vi.fn()
vi.mock('../src/main/recordingStore', () => ({
  getRecordings: (): unknown[] => getRecordings()
}))

import {
  searchRecordings,
  searchTranscripts,
  SEARCH_MAX_RESULTS,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MAX_SNIPPET_LENGTH,
  type SearchableRecording
} from '../src/main/searchService'

let nextTs = 1_700_000_000_000

function rec(overrides: Partial<SearchableRecording> & { id: string }): SearchableRecording {
  return {
    filename: `recording-${overrides.id}.webm`,
    timestamp: (nextTs -= 1000),
    duration: 12,
    provider: 'openai',
    status: 'completed',
    transcription: '',
    ...overrides
  }
}

function snippetText(segments: { value: string }[]): string {
  return segments.map((s) => s.value).join('')
}

function ids(results: { recordingId: string }[]): string[] {
  return results.map((r) => r.recordingId)
}

beforeEach(() => {
  getRecordings.mockReset()
})

describe('searchRecordings — query handling', () => {
  const records = [rec({ id: 'a', transcription: 'ważny raport roczny' })]

  it('returns [] for an empty query', () => {
    expect(searchRecordings('', records)).toEqual([])
  })

  it('returns [] for a whitespace-only query', () => {
    expect(searchRecordings('   \n\t ', records)).toEqual([])
  })

  it('returns [] for a combining-marks-only query', () => {
    expect(searchRecordings('̨́', records)).toEqual([])
  })

  it('returns [] for a non-string query', () => {
    expect(searchRecordings(42 as unknown as string, records)).toEqual([])
  })

  it('never touches storage for an empty query', () => {
    const exploding = [
      new Proxy({} as SearchableRecording, {
        get() {
          throw new Error('storage must not be read for an empty query')
        }
      })
    ]
    expect(searchRecordings('  ', exploding)).toEqual([])
  })

  it('returns [] when nothing matches', () => {
    expect(searchRecordings('faktura', records)).toEqual([])
  })

  it('truncates an over-long query instead of rejecting it', () => {
    // Padding is part of the phrase, so this still finds nothing — the point is
    // that an oversized query degrades quietly rather than throwing...
    const query = 'ważny' + 'x'.repeat(SEARCH_MAX_QUERY_LENGTH)
    expect(searchRecordings(query, records)).toEqual([])
    // ...and a query whose meaningful part survives truncation still matches.
    const padded = 'ważny'.padEnd(SEARCH_MAX_QUERY_LENGTH + 50, ' ')
    expect(ids(searchRecordings(padded, records))).toEqual(['a'])
  })
})

describe('searchRecordings — matching', () => {
  it('matches case-insensitively', () => {
    const records = [rec({ id: 'a', transcription: 'Raport ROCZNY gotowy' })]
    expect(ids(searchRecordings('roczny', records))).toEqual(['a'])
    expect(ids(searchRecordings('RAPORT', records))).toEqual(['a'])
  })

  it('matches Polish text with and without ogonki, both directions', () => {
    const accented = [rec({ id: 'acc', transcription: 'To bardzo ważny temat' })]
    const plain = [rec({ id: 'plain', transcription: 'To bardzo wazny temat' })]
    expect(ids(searchRecordings('wazny', accented))).toEqual(['acc'])
    expect(ids(searchRecordings('ważny', plain))).toEqual(['plain'])
  })

  it('covers every Polish diacritic', () => {
    const records = [rec({ id: 'pl', transcription: 'Zażółć gęślą jaźń, ŁÓDŹ i ćma' })]
    for (const query of ['zazolc', 'gesla', 'jazn', 'lodz', 'cma']) {
      expect(ids(searchRecordings(query, records)), query).toEqual(['pl'])
    }
  })

  it('requires every term of a multi-word query to be present', () => {
    const records = [
      rec({ id: 'both', transcription: 'raport roczny jest gotowy' }),
      rec({ id: 'one', transcription: 'raport kwartalny jest gotowy' })
    ]
    expect(ids(searchRecordings('raport roczny', records))).toEqual(['both'])
  })

  it('matches terms found in the filename even when the transcript lacks them', () => {
    const records = [rec({ id: 'a', filename: 'spotkanie-zespolu.webm', transcription: 'nic tu nie ma' })]
    const [result] = searchRecordings('zespołu', records)
    expect(result.recordingId).toBe('a')
    expect(result.filenameMatched).toBe(true)
  })
})

describe('searchRecordings — ranking', () => {
  it('ranks a filename match above a transcript-only match', () => {
    const records = [
      rec({ id: 'text', transcription: 'raport raport raport raport raport' }),
      rec({ id: 'name', filename: 'raport.webm', transcription: 'nic' })
    ]
    expect(ids(searchRecordings('raport', records))).toEqual(['name', 'text'])
  })

  it('ranks an exact phrase above the same terms scattered apart', () => {
    const records = [
      rec({ id: 'scattered', transcription: 'raport jest gotowy, roczny raport, roczny plan, roczny cel' }),
      rec({ id: 'phrase', transcription: 'oto raport roczny' })
    ]
    expect(ids(searchRecordings('raport roczny', records))).toEqual(['phrase', 'scattered'])
  })

  it('ranks more occurrences above fewer when everything else is equal', () => {
    const records = [
      rec({ id: 'few', transcription: 'kot' }),
      rec({ id: 'many', transcription: 'kot kot kot' })
    ]
    expect(ids(searchRecordings('kot', records))).toEqual(['many', 'few'])
  })

  it('breaks a score tie on the earlier first match, ahead of the date', () => {
    const records = [
      // `late` is NEWER, so only the position rule can put `early` first.
      rec({ id: 'late', timestamp: 2_000, transcription: 'aaaaaaaaaa kot' }),
      rec({ id: 'early', timestamp: 1_000, transcription: 'kot aaaaaaaaaa' })
    ]
    expect(ids(searchRecordings('kot', records))).toEqual(['early', 'late'])
  })

  it('breaks a remaining tie on the newer recording', () => {
    const records = [
      rec({ id: 'older', timestamp: 1_000, transcription: 'kot w domu' }),
      rec({ id: 'newer', timestamp: 9_000, transcription: 'kot w polu' })
    ]
    expect(ids(searchRecordings('kot', records))).toEqual(['newer', 'older'])
  })

  it('falls back to a stable id tie-break, and is deterministic across input orders', () => {
    const a = rec({ id: 'rec-a', timestamp: 5_000, transcription: 'kot' })
    const b = rec({ id: 'rec-b', timestamp: 5_000, transcription: 'kot' })
    expect(ids(searchRecordings('kot', [b, a]))).toEqual(['rec-a', 'rec-b'])
    expect(ids(searchRecordings('kot', [a, b]))).toEqual(['rec-a', 'rec-b'])
  })

  it('caps the number of results', () => {
    const records = Array.from({ length: SEARCH_MAX_RESULTS + 20 }, (_, i) =>
      rec({ id: `rec-${i}`, transcription: 'kot' })
    )
    expect(searchRecordings('kot', records)).toHaveLength(SEARCH_MAX_RESULTS)
  })
})

describe('searchRecordings — snippets', () => {
  it('preserves original casing and diacritics in the matched segment', () => {
    const records = [rec({ id: 'a', transcription: 'To jest Ważny raport roczny' })]
    const [result] = searchRecordings('wazny', records)
    expect(result.snippet).toEqual([
      { type: 'text', value: 'To jest ' },
      { type: 'match', value: 'Ważny' },
      { type: 'text', value: ' raport roczny' }
    ])
  })

  it('marks every occurrence in the snippet', () => {
    const records = [rec({ id: 'a', transcription: 'kot i kot i kot' })]
    const [result] = searchRecordings('kot', records)
    expect(result.snippet.filter((s) => s.type === 'match')).toHaveLength(3)
    expect(result.matchCount).toBe(3)
  })

  it('highlights a multi-word phrase as one span', () => {
    const records = [rec({ id: 'a', transcription: 'oto raport roczny na dziś' })]
    const [result] = searchRecordings('raport roczny', records)
    expect(result.snippet.filter((s) => s.type === 'match').map((s) => s.value)).toEqual(['raport roczny'])
  })

  it('bounds the snippet length', () => {
    const transcript = 'x'.repeat(2000) + 'kot' + 'y'.repeat(2000)
    const [result] = searchRecordings('kot', [rec({ id: 'a', transcription: transcript })])
    const text = snippetText(result.snippet)
    expect(text.replace(/…/g, '').length).toBe(SEARCH_MAX_SNIPPET_LENGTH)
    expect(text).toContain('…')
  })

  it('still returns transcript context for a filename-only match', () => {
    const records = [rec({ id: 'a', filename: 'spotkanie.webm', transcription: 'zupełnie inny tekst' })]
    const [result] = searchRecordings('spotkanie', records)
    expect(snippetText(result.snippet)).toBe('zupełnie inny tekst')
    expect(result.snippet.every((s) => s.type === 'text')).toBe(true)
  })
})

describe('searchRecordings — resilience', () => {
  it('skips records with no transcript instead of failing', () => {
    const records = [
      rec({ id: 'empty', transcription: undefined }),
      rec({ id: 'ok', transcription: 'kot' })
    ]
    expect(ids(searchRecordings('kot', records))).toEqual(['ok'])
  })

  it('skips malformed rows and keeps searching the valid ones', () => {
    const records: unknown[] = [
      null,
      undefined,
      'not-a-record',
      { id: '' },
      { id: 'no-filename', transcription: 'kot', timestamp: 'yesterday' },
      rec({ id: 'ok', transcription: 'kot' })
    ]
    const results = searchRecordings('kot', records)
    expect(ids(results).sort()).toEqual(['no-filename', 'ok'])
    const malformed = results.find((r) => r.recordingId === 'no-filename')!
    expect(malformed.filename).toBe('')
    expect(malformed.timestamp).toBe(0)
  })

  it('survives a row whose fields throw on access', () => {
    const hostile = new Proxy({ id: 'boom' } as SearchableRecording, {
      get(_target, prop) {
        if (prop === 'id') return 'boom'
        throw new Error('unreadable record')
      }
    })
    expect(ids(searchRecordings('kot', [hostile, rec({ id: 'ok', transcription: 'kot' })]))).toEqual(['ok'])
  })

  it('never returns a filesystem path to the renderer', () => {
    const records = [{ ...rec({ id: 'a', transcription: 'kot' }), filepath: '/secret/recordings/a.webm' }]
    const [result] = searchRecordings('kot', records)
    expect(Object.keys(result)).not.toContain('filepath')
    expect(JSON.stringify(result)).not.toContain('/secret/')
  })

  it('returns only IPC-serializable values', () => {
    const records = [rec({ id: 'a', transcription: 'kot' })]
    const results = searchRecordings('kot', records)
    expect(JSON.parse(JSON.stringify(results))).toEqual(results)
  })
})

describe('searchTranscripts — storage-backed entry point', () => {
  it('searches what recordingStore.getRecordings() returns', () => {
    getRecordings.mockReturnValue([rec({ id: 'a', transcription: 'ważny raport' })])
    expect(ids(searchTranscripts('wazny'))).toEqual(['a'])
    expect(getRecordings).toHaveBeenCalledTimes(1)
  })

  it('short-circuits empty/blank/non-string queries without hitting storage', () => {
    getRecordings.mockReturnValue([])
    expect(searchTranscripts('')).toEqual([])
    expect(searchTranscripts('   ')).toEqual([])
    expect(searchTranscripts(null as unknown as string)).toEqual([])
    expect(getRecordings).not.toHaveBeenCalled()
  })
})
