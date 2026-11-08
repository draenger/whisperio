import { describe, it, expect } from 'vitest'
import { filterTranscript, HALLUCINATION_PHRASES } from '../src/shared/continuous/hallucinationFilter'

describe('filterTranscript', () => {
  it('rejects empty / whitespace / punctuation-only', () => {
    for (const t of ['', '   ', '...', ' . , ! ', '—']) {
      expect(filterTranscript(t)).toMatchObject({ accept: false, reason: 'empty' })
    }
    expect(filterTranscript(undefined as unknown as string).reason).toBe('empty')
  })

  it('rejects by duration, honoring a custom minimum', () => {
    expect(filterTranscript('Dodaj test', 300)).toMatchObject({ accept: false, reason: 'too-short' })
    expect(filterTranscript('Dodaj test', 500).accept).toBe(true)
    expect(filterTranscript('Dodaj test', 800, 1000).reason).toBe('too-short')
    expect(filterTranscript('Dodaj test').accept).toBe(true)
  })

  it('rejects every listed hallucination, insensitive to case/punctuation/diacritics', () => {
    for (const p of HALLUCINATION_PHRASES) {
      expect(filterTranscript(p).reason).toBe('hallucination')
      expect(filterTranscript(p.toUpperCase() + '!').reason).toBe('hallucination')
      expect(filterTranscript('  ' + p + '.  ').reason).toBe('hallucination')
    }
    expect(filterTranscript('Dziekuje za uwage').reason).toBe('hallucination')
    expect(filterTranscript('dzieki za obejrzenie...').reason).toBe('hallucination')
  })

  it('rejects subtitle credits', () => {
    for (const t of [
      'Napisy stworzone przez społeczność Amara.org',
      'Napisy wykonane przez Jan Kowalski',
      'Napisy by XYZ',
      'Napisy: Jan',
      'Subtitles by the Amara.org community',
      'Napisy przez coś tam'
    ]) {
      expect(filterTranscript(t).reason).toBe('hallucination')
    }
  })

  it('rejects repeated hallucination phrases', () => {
    expect(filterTranscript('Dziękuję za uwagę. Dziękuję za uwagę.').reason).toBe('hallucination')
  })

  it('keeps normal sentences that merely contain hallucination words', () => {
    for (const t of [
      'Dziękuję za uwagę do tego błędu w kodzie',
      'Do zobaczenia jutro na spotkaniu',
      'Napisy końcowe są za długie',
      'Please subscribe the handler to the event',
      'Napisy'
    ]) {
      expect(filterTranscript(t).accept).toBe(true)
    }
  })

  it('rejects filler-only text', () => {
    for (const t of ['yy', 'Yyy...', 'eee', 'Eh.', 'hmm', 'Mhm', 'aha', 'uh, um', 'yy yy eee', 'no', 'No.', 'Hmm, yyy']) {
      expect(filterTranscript(t)).toMatchObject({ accept: false, reason: 'filler-only' })
    }
  })

  it('does not reject sentences with fillers or repeated no', () => {
    for (const t of ['no dobra', 'no no', 'yy to jest test', 'hmm let me think', 'um okay']) {
      expect(filterTranscript(t).accept).toBe(true)
    }
  })

  it('returns trimmed text', () => {
    expect(filterTranscript('  Cześć świecie  ')).toEqual({ accept: true, text: 'Cześć świecie' })
  })
})
