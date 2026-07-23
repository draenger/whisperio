import { describe, it, expect } from 'vitest'
import {
  buildSpeakerSegments,
  speakerOrder,
  displayName,
  transcriptText,
  assemblyAISegments,
  deepgramSegments,
  openAISegments,
  type DiarizedWord
} from '../src/main/dictation/conversation'

describe('buildSpeakerSegments', () => {
  it('returns an empty array for empty input', () => {
    expect(buildSpeakerSegments([])).toEqual([])
  })

  it('folds a single speaker into one segment', () => {
    const words: DiarizedWord[] = [
      { text: 'Hello ', start: 0, end: 0.5, type: 'word', speakerId: 'speaker_0' },
      { text: 'there', start: 0.5, end: 1, type: 'word', speakerId: 'speaker_0' }
    ]
    const segments = buildSpeakerSegments(words)
    expect(segments).toEqual([{ speaker: 'speaker_0', start: 0, end: 1, text: 'Hello there' }])
  })

  it('opens a new segment on a speaker change', () => {
    const words: DiarizedWord[] = [
      { text: 'Hi', start: 0, end: 0.4, type: 'word', speakerId: 'speaker_0' },
      { text: 'Hey', start: 0.5, end: 0.9, type: 'word', speakerId: 'speaker_1' },
      { text: 'again', start: 1, end: 1.4, type: 'word', speakerId: 'speaker_0' }
    ]
    const segments = buildSpeakerSegments(words)
    expect(segments).toEqual([
      { speaker: 'speaker_0', start: 0, end: 0.4, text: 'Hi' },
      { speaker: 'speaker_1', start: 0.5, end: 0.9, text: 'Hey' },
      { speaker: 'speaker_0', start: 1, end: 1.4, text: 'again' }
    ])
  })

  it('attaches spacing/no-speaker-id words to the current speaker', () => {
    const words: DiarizedWord[] = [
      { text: 'Hello', start: 0, end: 0.4, type: 'word', speakerId: 'speaker_0' },
      { text: ' ', start: 0.4, end: 0.45, type: 'spacing' },
      { text: 'world', start: 0.45, end: 0.9, type: 'word', speakerId: 'speaker_0' }
    ]
    const segments = buildSpeakerSegments(words)
    expect(segments).toEqual([{ speaker: 'speaker_0', start: 0, end: 0.9, text: 'Hello world' }])
  })

  it('skips audio_event entries entirely', () => {
    const words: DiarizedWord[] = [
      { text: 'Hi', start: 0, end: 0.4, type: 'word', speakerId: 'speaker_0' },
      { text: '[laughter]', start: 0.4, end: 0.6, type: 'audio_event', speakerId: 'speaker_0' },
      { text: ' there', start: 0.6, end: 1, type: 'word', speakerId: 'speaker_0' }
    ]
    const segments = buildSpeakerSegments(words)
    expect(segments).toEqual([{ speaker: 'speaker_0', start: 0, end: 1, text: 'Hi there' }])
  })

  it('defaults to speaker_0 when the very first word has no speaker id', () => {
    const words: DiarizedWord[] = [{ text: 'Hello', start: 0, end: 0.5, type: 'word' }]
    const segments = buildSpeakerSegments(words)
    expect(segments).toEqual([{ speaker: 'speaker_0', start: 0, end: 0.5, text: 'Hello' }])
  })

  it('drops segments that trim to empty text', () => {
    const words: DiarizedWord[] = [{ text: '   ', start: 0, end: 0.1, type: 'word', speakerId: 'speaker_0' }]
    expect(buildSpeakerSegments(words)).toEqual([])
  })

  it('trims leading/trailing whitespace from each segment', () => {
    const words: DiarizedWord[] = [
      { text: '  Hello  ', start: 0, end: 0.5, type: 'word', speakerId: 'speaker_0' }
    ]
    expect(buildSpeakerSegments(words)).toEqual([{ speaker: 'speaker_0', start: 0, end: 0.5, text: 'Hello' }])
  })
})

describe('speakerOrder', () => {
  it('returns an empty order for no segments', () => {
    expect(speakerOrder([])).toEqual([])
  })

  it('orders speakers by first appearance, deduped', () => {
    const segments = [
      { speaker: 'speaker_1', start: 0, end: 1, text: 'a' },
      { speaker: 'speaker_0', start: 1, end: 2, text: 'b' },
      { speaker: 'speaker_1', start: 2, end: 3, text: 'c' }
    ]
    expect(speakerOrder(segments)).toEqual(['speaker_1', 'speaker_0'])
  })
})

describe('displayName', () => {
  const order = ['speaker_0', 'speaker_1']

  it('falls back to "Speaker N" by order of first appearance', () => {
    expect(displayName('speaker_0', {}, order)).toBe('Speaker 1')
    expect(displayName('speaker_1', {}, order)).toBe('Speaker 2')
  })

  it('prefers a user-assigned name when present and non-blank', () => {
    expect(displayName('speaker_0', { speaker_0: 'Anna' }, order)).toBe('Anna')
  })

  it('trims a user-assigned name and falls back on blank', () => {
    expect(displayName('speaker_0', { speaker_0: '   ' }, order)).toBe('Speaker 1')
    expect(displayName('speaker_0', { speaker_0: '  Anna  ' }, order)).toBe('Anna')
  })

  it('returns the raw speaker id when it is not in the known order', () => {
    expect(displayName('speaker_9', {}, order)).toBe('speaker_9')
  })
})

describe('transcriptText', () => {
  it('renders one "Name: words" paragraph per segment, joined by a blank line', () => {
    const segments = [
      { speaker: 'speaker_0', start: 0, end: 1, text: "I'm Anna" },
      { speaker: 'speaker_1', start: 1, end: 2, text: 'Hi Anna' }
    ]
    expect(transcriptText(segments, { speaker_0: 'Anna' })).toBe(
      "Anna: I'm Anna\n\nSpeaker 2: Hi Anna"
    )
  })

  it('returns an empty string for no segments', () => {
    expect(transcriptText([], {})).toBe('')
  })
})

describe('assemblyAISegments', () => {
  it('maps utterances, lowercasing the speaker letter and converting ms to seconds', () => {
    const segments = assemblyAISegments([
      { speaker: 'A', text: 'Hello', start: 0, end: 1500 },
      { speaker: 'B', text: 'Hi there', start: 1500, end: 3000 }
    ])
    expect(segments).toEqual([
      { speaker: 'speaker_a', start: 0, end: 1.5, text: 'Hello' },
      { speaker: 'speaker_b', start: 1.5, end: 3, text: 'Hi there' }
    ])
  })

  it('drops utterances whose text trims to empty', () => {
    expect(assemblyAISegments([{ speaker: 'A', text: '   ', start: 0, end: 100 }])).toEqual([])
  })

  it('returns an empty array for no utterances', () => {
    expect(assemblyAISegments([])).toEqual([])
  })
})

describe('deepgramSegments', () => {
  it('maps utterances, keeping numeric speaker ids and seconds untouched', () => {
    const segments = deepgramSegments([
      { speaker: 0, transcript: 'Hello', start: 0, end: 1.2 },
      { speaker: 1, transcript: 'Hi there', start: 1.2, end: 2.5 }
    ])
    expect(segments).toEqual([
      { speaker: 'speaker_0', start: 0, end: 1.2, text: 'Hello' },
      { speaker: 'speaker_1', start: 1.2, end: 2.5, text: 'Hi there' }
    ])
  })

  it('drops utterances whose transcript trims to empty', () => {
    expect(deepgramSegments([{ speaker: 0, transcript: '  ', start: 0, end: 1 }])).toEqual([])
  })

  it('returns an empty array for no utterances', () => {
    expect(deepgramSegments([])).toEqual([])
  })
})

describe('openAISegments', () => {
  it('assigns stable speaker ids in first-appearance order, not by label letter', () => {
    const segments = openAISegments([
      { speaker: 'B', text: 'Hello', start: 0, end: 1 },
      { speaker: 'A', text: 'Hi there', start: 1, end: 2 },
      { speaker: 'B', text: 'again', start: 2, end: 3 }
    ])
    expect(segments).toEqual([
      { speaker: 'speaker_0', start: 0, end: 1, text: 'Hello' },
      { speaker: 'speaker_1', start: 1, end: 2, text: 'Hi there' },
      { speaker: 'speaker_0', start: 2, end: 3, text: 'again' }
    ])
  })

  it('returns an empty array for no segments', () => {
    expect(openAISegments([])).toEqual([])
  })

  it('drops segments whose text trims to empty', () => {
    expect(openAISegments([{ speaker: 'A', text: '   ', start: 0, end: 1 }])).toEqual([])
  })

  it('defaults missing start/end to 0', () => {
    expect(openAISegments([{ speaker: 'A', text: 'Hi' }])).toEqual([
      { speaker: 'speaker_0', start: 0, end: 0, text: 'Hi' }
    ])
  })

  it('tolerates a missing speaker label as its own distinct speaker bucket', () => {
    const segments = openAISegments([
      { text: 'Hi', start: 0, end: 1 },
      { speaker: 'A', text: 'Hey', start: 1, end: 2 }
    ])
    expect(segments).toEqual([
      { speaker: 'speaker_0', start: 0, end: 1, text: 'Hi' },
      { speaker: 'speaker_1', start: 1, end: 2, text: 'Hey' }
    ])
  })
})
