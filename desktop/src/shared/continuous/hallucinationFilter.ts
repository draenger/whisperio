/** Rejects empty / hallucinated / filler-only transcripts before they get pasted. */

export type RejectReason = 'empty' | 'too-short' | 'hallucination' | 'filler-only'
export interface FilterResult {
  accept: boolean
  reason?: RejectReason
  text: string
}

/** Whole-text Whisper hallucinations (PL + EN). Matched after normalize(). */
export const HALLUCINATION_PHRASES: readonly string[] = [
  'Dziękuję za uwagę',
  'Dziękuję za uwagę i do zobaczenia',
  'Dzięki za obejrzenie',
  'Dziękuję za obejrzenie',
  'Napisy stworzone przez społeczność Amara.org',
  'Thank you for watching',
  'Thanks for watching',
  'Thank you for watching and see you next time',
  'Please subscribe',
  'Please subscribe to my channel',
  'Zapraszam do subskrypcji',
  'Zapraszamy do subskrypcji',
  'Subskrybuj',
  'Do zobaczenia',
  'Do zobaczenia w następnym odcinku'
]

const FILLERS = new Set([
  'y', 'yy', 'yyy', 'yyyy', 'e', 'ee', 'eee', 'eeee', 'eh', 'ehm', 'hm', 'hmm', 'hmmm',
  'mm', 'mmm', 'mhm', 'aha', 'uh', 'uhm', 'um', 'no'
])

const SUBTITLE_CONNECTORS = new Set([
  'by', 'przez', 'wykonane', 'stworzone', 'wykonal', 'wykonala', 'tlumaczenie', 'tlumaczyl', 'dla', 'from'
])

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const NORMALIZED_PHRASES = HALLUCINATION_PHRASES.map((p) => normalize(p).split(' '))

/** True when `words` is one or more back-to-back repetitions of `phrase`. */
function onlyPhrase(words: string[], phrase: string[]): boolean {
  if (words.length % phrase.length !== 0) return false
  return words.every((w, i) => w === phrase[i % phrase.length])
}

function isSubtitleCredit(raw: string, words: string[]): boolean {
  if (/^\s*napisy\s*:/i.test(raw)) return true
  if (words[0] === 'napisy' && words.length > 1 && SUBTITLE_CONNECTORS.has(words[1])) return true
  return words[0] === 'subtitles' && words[1] === 'by'
}

export function filterTranscript(text: string, durationMs?: number, minDurationMs = 500): FilterResult {
  const trimmed = (text ?? '').trim()
  const norm = normalize(trimmed)
  if (norm === '') return { accept: false, reason: 'empty', text: trimmed }
  if (durationMs !== undefined && durationMs < minDurationMs) {
    return { accept: false, reason: 'too-short', text: trimmed }
  }
  const words = norm.split(' ')
  if (isSubtitleCredit(trimmed, words) || NORMALIZED_PHRASES.some((p) => onlyPhrase(words, p))) {
    return { accept: false, reason: 'hallucination', text: trimmed }
  }
  // A lone "no" is a filler; "no no" / "no dobra" are real speech.
  if (words.every((w) => FILLERS.has(w)) && !(words.includes('no') && words.length > 1)) {
    return { accept: false, reason: 'filler-only', text: trimmed }
  }
  return { accept: true, text: trimmed }
}
