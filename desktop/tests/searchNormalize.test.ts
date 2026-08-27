import { describe, it, expect } from 'vitest'
import {
  normalizeSearchText,
  foldWithIndex,
  findMatches,
  mergeRanges
} from '../src/main/search/normalize'
import { buildSnippet } from '../src/main/search/snippet'

/**
 * Unicode folding + source-preserving match projection (full-text search).
 *
 * The contract under test: matching is case- and diacritics-insensitive, but
 * every range it produces still points at the ORIGINAL text, so a snippet can
 * quote Polish exactly as it was dictated.
 */

function matchedText(source: string, query: string): string[] {
  const folded = foldWithIndex(source)
  return findMatches(folded, normalizeSearchText(query)).map((r) => source.slice(r.start, r.end))
}

describe('normalizeSearchText', () => {
  it('lowercases and strips Polish diacritics', () => {
    expect(normalizeSearchText('ĄĆĘŁŃÓŚŹŻ')).toBe('acelnoszz')
    expect(normalizeSearchText('ąćęłńóśźż')).toBe('acelnoszz')
  })

  it('folds ł/Ł, which NFD alone leaves untouched', () => {
    expect('ł'.normalize('NFD')).toBe('ł')
    expect(normalizeSearchText('Łaska')).toBe('laska')
  })

  it('collapses whitespace runs and trims both ends', () => {
    expect(normalizeSearchText('  ważny   raport \n roczny  ')).toBe('wazny raport roczny')
  })

  it('returns an empty string for whitespace-only and combining-mark-only input', () => {
    expect(normalizeSearchText('   \t\n ')).toBe('')
    expect(normalizeSearchText('̨́')).toBe('')
  })
})

describe('findMatches — diacritics-insensitive, original coordinates', () => {
  it('matches an unaccented query against accented text', () => {
    expect(matchedText('To bardzo ważny raport', 'wazny')).toEqual(['ważny'])
  })

  it('matches an accented query against unaccented text', () => {
    expect(matchedText('To bardzo wazny raport', 'ważny')).toEqual(['wazny'])
  })

  it('matches across every Polish diacritic, preserving the original spelling', () => {
    const source = 'Zażółć gęślą jaźń — ŁÓDŹ, ćma, ńka'
    for (const query of ['zazolc', 'gesla', 'jazn', 'lodz', 'cma', 'nka']) {
      expect(matchedText(source, query).length, query).toBe(1)
    }
    expect(matchedText(source, 'lodz')).toEqual(['ŁÓDŹ'])
  })

  it('is case-insensitive in both directions', () => {
    expect(matchedText('Raport ROCZNY', 'roczny')).toEqual(['ROCZNY'])
    expect(matchedText('Raport roczny', 'ROCZNY')).toEqual(['roczny'])
  })

  it('finds repeated matches, including at the very start and end', () => {
    expect(matchedText('kot i kot', 'kot')).toEqual(['kot', 'kot'])
  })

  it('matches a multi-word phrase across a collapsed whitespace run', () => {
    expect(matchedText('to jest ważny   raport roczny', 'ważny raport')).toEqual(['ważny   raport'])
  })

  it('returns nothing for a non-matching or empty query', () => {
    expect(matchedText('ważny raport', 'faktura')).toEqual([])
    expect(matchedText('ważny raport', '   ')).toEqual([])
    expect(findMatches(foldWithIndex(''), 'kot')).toEqual([])
  })

  it('keeps original coordinates correct after a surrogate pair', () => {
    const source = '🎙️ ważny raport'
    const [range] = findMatches(foldWithIndex(source), 'raport')
    expect(source.slice(range.start, range.end)).toBe('raport')
  })
})

describe('mergeRanges', () => {
  it('leaves 0/1 ranges alone and merges overlapping ones', () => {
    expect(mergeRanges([])).toEqual([])
    expect(mergeRanges([{ start: 2, end: 5 }])).toEqual([{ start: 2, end: 5 }])
    expect(
      mergeRanges([
        { start: 10, end: 14 },
        { start: 0, end: 4 },
        { start: 2, end: 8 }
      ])
    ).toEqual([
      { start: 0, end: 8 },
      { start: 10, end: 14 }
    ])
  })
})

describe('buildSnippet', () => {
  const long = 'x'.repeat(400) + 'ważny' + 'y'.repeat(400)

  it('returns nothing for empty source text', () => {
    expect(buildSnippet('', [], 240)).toEqual([])
  })

  it('splits into text/match segments preserving original casing and ogonki', () => {
    const source = 'To jest Ważny raport'
    const segments = buildSnippet(source, findMatches(foldWithIndex(source), 'wazny'), 240)
    expect(segments).toEqual([
      { type: 'text', value: 'To jest ' },
      { type: 'match', value: 'Ważny' },
      { type: 'text', value: ' raport' }
    ])
  })

  it('highlights every match in the window', () => {
    const source = 'kot i kot i kot'
    const segments = buildSnippet(source, findMatches(foldWithIndex(source), 'kot'), 240)
    expect(segments.filter((s) => s.type === 'match').map((s) => s.value)).toEqual(['kot', 'kot', 'kot'])
  })

  it('bounds the snippet and marks both truncated ends', () => {
    const segments = buildSnippet(long, findMatches(foldWithIndex(long), 'wazny'), 240)
    const text = segments.map((s) => s.value).join('')
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    // The bound applies to transcript text; the two ellipses are extra.
    expect(text.replace(/…/g, '').length).toBe(240)
    expect(segments.some((s) => s.type === 'match' && s.value === 'ważny')).toBe(true)
  })

  it('spends the whole budget backwards when the match sits at the very end', () => {
    const source = 'z'.repeat(400) + 'ważny'
    const segments = buildSnippet(source, findMatches(foldWithIndex(source), 'wazny'), 240)
    const text = segments.map((s) => s.value).join('')
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('ważny')).toBe(true)
    expect(text.replace(/…/g, '').length).toBe(240)
  })

  it('falls back to the head of the transcript when there is no match to centre on', () => {
    const source = 'a'.repeat(300)
    const segments = buildSnippet(source, [], 240)
    expect(segments).toEqual([
      { type: 'text', value: 'a'.repeat(240) },
      { type: 'text', value: '…' }
    ])
  })

  it('ignores matches that fall outside the window', () => {
    const source = 'kot' + 'q'.repeat(400) + 'kot'
    const segments = buildSnippet(source, findMatches(foldWithIndex(source), 'kot'), 100)
    expect(segments.filter((s) => s.type === 'match')).toHaveLength(1)
  })
})
