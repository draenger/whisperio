import { describe, it, expect } from 'vitest'
import { expandSnippets, normalizeSnippetPhrase, sanitizeSnippets, type Snippet } from '../src/main/snippets'

const ADDRESS = '221B Baker Street\nLondon NW1 6XE'
const LIST: Snippet[] = [{ trigger: 'my address', text: ADDRESS }]

describe('expandSnippets — matching contract', () => {
  it('replaces an exact whole-transcript match', () => {
    expect(expandSnippets('my address', LIST)).toBe(ADDRESS)
  })

  it('is case-insensitive on both sides', () => {
    expect(expandSnippets('My Address', LIST)).toBe(ADDRESS)
    expect(expandSnippets('my address', [{ trigger: 'MY ADDRESS', text: 'x' }])).toBe('x')
  })

  it('tolerates punctuation and whitespace at the edges (cleanup adds "." etc.)', () => {
    for (const spoken of ['My address.', '  my address!  ', '"My address?"', '…my address…', '¿my address?', 'my address,\n']) {
      expect(expandSnippets(spoken, LIST)).toBe(ADDRESS)
    }
    expect(expandSnippets('my address', [{ trigger: ' My address. ', text: 'x' }])).toBe('x')
  })

  it('collapses internal whitespace runs', () => {
    expect(expandSnippets('my   address', LIST)).toBe(ADDRESS)
    expect(expandSnippets('my\taddress', LIST)).toBe(ADDRESS)
  })

  it('does NOT fire when the trigger is only part of a longer transcript', () => {
    expect(expandSnippets('send it to my address please', LIST)).toBe('send it to my address please')
    expect(expandSnippets('my address is wrong', LIST)).toBe('my address is wrong')
    expect(expandSnippets('my addresses', LIST)).toBe('my addresses')
  })

  it('requires internal punctuation to match (only edges are tolerant)', () => {
    expect(expandSnippets('my, address', LIST)).toBe('my, address')
    expect(expandSnippets('e-mail sig', [{ trigger: 'e-mail sig', text: 'sig' }])).toBe('sig')
    expect(expandSnippets('email sig', [{ trigger: 'e-mail sig', text: 'sig' }])).toBe('email sig')
  })

  it('is language-agnostic (Unicode case folding + NFC normalisation)', () => {
    expect(expandSnippets('Mój Adres.', [{ trigger: 'mój adres', text: 'ul. Długa 1' }])).toBe('ul. Długa 1')
    expect(expandSnippets('МОЙ АДРЕС', [{ trigger: 'мой адрес', text: 'ru' }])).toBe('ru')
    expect(expandSnippets('私の住所。', [{ trigger: '私の住所', text: 'ja' }])).toBe('ja')
    // decomposed "é" (e + U+0301) vs precomposed "é"
    expect(expandSnippets('café', [{ trigger: 'café', text: 'fr' }])).toBe('fr')
  })

  it('first matching snippet in list order wins', () => {
    const list = [
      { trigger: 'sig', text: 'first' },
      { trigger: 'SIG', text: 'second' }
    ]
    expect(expandSnippets('sig', list)).toBe('first')
  })

  it('returns the text unchanged for an empty/missing list (feature off)', () => {
    expect(expandSnippets('my address', [])).toBe('my address')
    expect(expandSnippets('my address', undefined)).toBe('my address')
    expect(expandSnippets('my address', null)).toBe('my address')
  })

  it('never matches empty or punctuation-only triggers / transcripts', () => {
    const list = [{ trigger: '', text: 'x' }, { trigger: ' ... ', text: 'y' }]
    expect(expandSnippets('', list)).toBe('')
    expect(expandSnippets('...', list)).toBe('...')
    expect(expandSnippets('hello', list)).toBe('hello')
  })

  it('skips malformed entries instead of throwing', () => {
    const list = [null, { trigger: 1, text: 'x' }, { trigger: 'ok', text: 'yes' }] as unknown as Snippet[]
    expect(expandSnippets('ok', list)).toBe('yes')
  })

  it('pastes the snippet text verbatim (no trimming/normalising of the output)', () => {
    expect(expandSnippets('sig', [{ trigger: 'sig', text: '  Best,\n  Ana  ' }])).toBe('  Best,\n  Ana  ')
  })
})

describe('normalizeSnippetPhrase', () => {
  it('lowercases, trims edge punctuation, collapses spaces', () => {
    expect(normalizeSnippetPhrase('  "Hello,   World!"  ')).toBe('hello, world')
  })
})

describe('sanitizeSnippets', () => {
  it('returns [] for non-arrays', () => {
    expect(sanitizeSnippets(undefined)).toEqual([])
    expect(sanitizeSnippets('x')).toEqual([])
    expect(sanitizeSnippets({ trigger: 'a', text: 'b' })).toEqual([])
  })

  it('keeps well-formed entries, drops malformed ones, strips extra fields', () => {
    const out = sanitizeSnippets([
      { trigger: 'a', text: 'b', extra: 1 },
      null,
      'str',
      { trigger: 'c' },
      { trigger: 2, text: 'd' },
      { trigger: '', text: 'kept even if blank' }
    ])
    expect(out).toEqual([
      { trigger: 'a', text: 'b' },
      { trigger: '', text: 'kept even if blank' }
    ])
  })
})
