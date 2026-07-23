// Conversation mode — speaker-diarized transcription of a multi-speaker
// recording. Pure domain logic only (segment building from provider words,
// display naming, the three provider mappers); ported 1:1 from the mobile
// app's shared domain module,
// mobile/WhisperioKit/Sources/WhisperioKit/Conversation.swift — see that file
// for the authoritative semantics. HTTP calls live in ../llm/*.ts and the
// diarizing-provider selection in transcribeConversation() (../transcribe.ts).

/**
 * One diarized span of a conversation: a run of consecutive words attributed
 * to the same speaker. `speaker` is the provider's raw id ("speaker_0",
 * "speaker_1", …) — display names are resolved separately (see
 * `displayName`/`speakerOrder` below) so a rename never rewrites the
 * segments themselves.
 */
export interface SpeakerSegment {
  speaker: string
  start: number
  end: number
  text: string
}

/**
 * One word as returned by a diarizing STT provider (ElevenLabs Scribe's
 * `words` array). `type` distinguishes real words from spacing/audio events;
 * only words carry meaning, but spacing between same-speaker words is
 * preserved in the joined segment text.
 */
export interface DiarizedWord {
  text: string
  start?: number
  end?: number
  type: string
  speakerId?: string
}

/**
 * Fold a provider word stream into per-speaker segments: consecutive words
 * with the same speaker id merge into one segment; a speaker change (or the
 * first word) opens a new one. Spacing/audio-event entries never open a
 * segment on their own — they attach to the current speaker's running text.
 * Words with no speaker id inherit the current speaker (Scribe omits ids on
 * spacing), defaulting to "speaker_0" at the very start. Mirrors
 * SpeakerSegmentBuilder.build(words:) in Conversation.swift exactly.
 */
export function buildSpeakerSegments(words: DiarizedWord[]): SpeakerSegment[] {
  const segments: SpeakerSegment[] = []
  let current: SpeakerSegment | null = null

  for (const word of words) {
    const isEvent = word.type === 'audio_event'
    if (isEvent) continue
    const isWord = word.type === 'word'
    const prev: SpeakerSegment | null = current
    const speaker: string = word.speakerId ?? prev?.speaker ?? 'speaker_0'

    if (prev && (prev.speaker === speaker || !isWord)) {
      const next: SpeakerSegment = {
        speaker: prev.speaker,
        start: prev.start,
        end: word.end ?? prev.end,
        text: prev.text + word.text
      }
      current = next
    } else {
      if (prev) segments.push(trimmed(prev))
      if (!isWord) continue
      const next: SpeakerSegment = {
        speaker,
        start: word.start ?? prev?.end ?? 0,
        end: word.end ?? word.start ?? 0,
        text: word.text
      }
      current = next
    }
  }
  if (current) segments.push(trimmed(current))
  return segments.filter((s) => s.text.length > 0)
}

function trimmed(s: SpeakerSegment): SpeakerSegment {
  return { ...s, text: s.text.trim() }
}

/**
 * Stable ordering of the distinct speaker ids as they first appear in the
 * segments — the basis for "Speaker 1", "Speaker 2" numbering.
 */
export function speakerOrder(segments: SpeakerSegment[]): string[] {
  const seen: string[] = []
  for (const s of segments) {
    if (!seen.includes(s.speaker)) seen.push(s.speaker)
  }
  return seen
}

/**
 * Display name for a raw speaker id: the user-assigned name when present,
 * otherwise "Speaker N" by order of first appearance.
 */
export function displayName(
  speaker: string,
  names: Record<string, string>,
  order: string[]
): string {
  const name = names[speaker]?.trim()
  if (name) return name
  const idx = order.indexOf(speaker)
  if (idx !== -1) return `Speaker ${idx + 1}`
  return speaker
}

/**
 * Render the whole conversation as shareable text: one "Name: words"
 * paragraph per segment.
 */
export function transcriptText(
  segments: SpeakerSegment[],
  names: Record<string, string>
): string {
  const order = speakerOrder(segments)
  return segments
    .map((s) => `${displayName(s.speaker, names, order)}: ${s.text}`)
    .join('\n\n')
}

// ─── AssemblyAI mapper ───
// Maps AssemblyAI's `utterances` array (present when `speaker_labels=true`)
// into SpeakerSegments. Field names match AssemblyAI's wire JSON directly.
export interface AssemblyAIUtterance {
  speaker: string
  text: string
  start: number // milliseconds
  end: number // milliseconds
}

export function assemblyAISegments(utterances: AssemblyAIUtterance[]): SpeakerSegment[] {
  const out: SpeakerSegment[] = []
  for (const u of utterances) {
    const text = u.text.trim()
    if (!text) continue
    const letter = u.speaker.trim().toLowerCase()
    out.push({
      speaker: `speaker_${letter}`,
      start: u.start / 1000,
      end: u.end / 1000,
      text
    })
  }
  return out
}

// ─── Deepgram mapper ───
// Maps Deepgram's `results.utterances` array (present when
// `diarize=true&utterances=true`) into SpeakerSegments. Note the field is
// called `transcript`, not `text`, matching the real response.
export interface DeepgramUtterance {
  speaker: number
  transcript: string
  start: number // seconds
  end: number // seconds
}

export function deepgramSegments(utterances: DeepgramUtterance[]): SpeakerSegment[] {
  const out: SpeakerSegment[] = []
  for (const u of utterances) {
    const text = u.transcript.trim()
    if (!text) continue
    out.push({ speaker: `speaker_${u.speaker}`, start: u.start, end: u.end, text })
  }
  return out
}

// ─── OpenAI mapper ───
// Maps OpenAI's `gpt-4o-transcribe-diarize` (response_format=diarized_json)
// `segments` array into SpeakerSegments. OpenAI labels speakers with letters
// ("A", "B", …) rather than the numeric/lettered ids ElevenLabs/AssemblyAI
// use, and doesn't guarantee "A" is always the first speaker to talk — so,
// unlike the other two mappers (which just lowercase/reuse the provider's own
// id), this one assigns stable `speaker_0`/`speaker_1`/… ids itself, in the
// order each raw label FIRST appears in the segment list. Defensive: missing
// start/end default to 0 (a truncated/malformed response shouldn't crash the
// mapper), and an unrecognized/missing speaker label is tolerated as its own
// distinct speaker bucket rather than dropped.
export interface OpenAIDiarizedSegment {
  speaker?: string
  text: string
  start?: number
  end?: number
}

export function openAISegments(segments: OpenAIDiarizedSegment[]): SpeakerSegment[] {
  const out: SpeakerSegment[] = []
  const order: string[] = []
  for (const seg of segments) {
    const text = seg.text?.trim() ?? ''
    if (!text) continue
    const rawLabel = seg.speaker?.trim() || 'unknown'
    let idx = order.indexOf(rawLabel)
    if (idx === -1) {
      idx = order.length
      order.push(rawLabel)
    }
    out.push({
      speaker: `speaker_${idx}`,
      start: seg.start ?? 0,
      end: seg.end ?? 0,
      text
    })
  }
  return out
}
