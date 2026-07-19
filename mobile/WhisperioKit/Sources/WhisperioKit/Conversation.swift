import Foundation

// Conversation mode — speaker-diarized transcription of an in-person conversation.
// Pure domain logic only (segment building from provider words, display naming, the
// speaker-name-guessing prompt/parse pair); capture and HTTP live in the app target.

/// One diarized span of a conversation: a run of consecutive words attributed to the same
/// speaker. `speaker` is the provider's raw id ("speaker_0", "speaker_1", …) — display
/// names are resolved separately through `Recording.speakerNames` so a rename never
/// rewrites the segments themselves.
public struct SpeakerSegment: Codable, Sendable, Equatable {
    public var speaker: String
    public var start: TimeInterval
    public var end: TimeInterval
    public var text: String

    public init(speaker: String, start: TimeInterval, end: TimeInterval, text: String) {
        self.speaker = speaker
        self.start = start
        self.end = end
        self.text = text
    }
}

/// One word as returned by a diarizing STT provider (ElevenLabs Scribe's `words` array).
/// `type` distinguishes real words from spacing/audio events; only words carry meaning,
/// but spacing between same-speaker words is preserved in the joined segment text.
public struct DiarizedWord: Sendable, Equatable {
    public var text: String
    public var start: TimeInterval?
    public var end: TimeInterval?
    public var type: String
    public var speakerID: String?

    public init(text: String, start: TimeInterval? = nil, end: TimeInterval? = nil,
                type: String = "word", speakerID: String? = nil) {
        self.text = text
        self.start = start
        self.end = end
        self.type = type
        self.speakerID = speakerID
    }
}

public enum SpeakerSegmentBuilder {
    /// Fold a provider word stream into per-speaker segments: consecutive words with the
    /// same speaker id merge into one segment; a speaker change (or the first word) opens a
    /// new one. Spacing/audio-event entries never open a segment on their own — they attach
    /// to the current speaker's running text. Words with no speaker id inherit the current
    /// speaker (Scribe omits ids on spacing), defaulting to "speaker_0" at the very start.
    public static func build(words: [DiarizedWord]) -> [SpeakerSegment] {
        var segments: [SpeakerSegment] = []
        var current: SpeakerSegment?

        for word in words {
            let isEvent = word.type == "audio_event"
            if isEvent { continue }
            let isWord = word.type == "word"
            let speaker = word.speakerID ?? current?.speaker ?? "speaker_0"

            if var seg = current, seg.speaker == speaker || !isWord {
                seg.text += word.text
                if let end = word.end { seg.end = end }
                current = seg
            } else {
                if let seg = current { segments.append(trimmed(seg)) }
                guard isWord else { continue }
                current = SpeakerSegment(speaker: speaker,
                                         start: word.start ?? current?.end ?? 0,
                                         end: word.end ?? word.start ?? 0,
                                         text: word.text)
            }
        }
        if let seg = current { segments.append(trimmed(seg)) }
        return segments.filter { !$0.text.isEmpty }
    }

    private static func trimmed(_ s: SpeakerSegment) -> SpeakerSegment {
        var out = s
        out.text = s.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return out
    }

    /// Stable ordering of the distinct speaker ids as they first appear in the segments —
    /// the basis for "Speaker 1", "Speaker 2" numbering.
    public static func speakerOrder(_ segments: [SpeakerSegment]) -> [String] {
        var seen: [String] = []
        for s in segments where !seen.contains(s.speaker) { seen.append(s.speaker) }
        return seen
    }

    /// Display name for a raw speaker id: the user-assigned name when present, otherwise
    /// "Speaker N" by order of first appearance.
    public static func displayName(for speaker: String, names: [String: String],
                                   order: [String]) -> String {
        if let name = names[speaker]?.trimmingCharacters(in: .whitespaces), !name.isEmpty {
            return name
        }
        if let idx = order.firstIndex(of: speaker) { return "Speaker \(idx + 1)" }
        return speaker
    }

    /// Render the whole conversation as shareable text: one "Name: words" paragraph per
    /// segment.
    public static func transcriptText(segments: [SpeakerSegment],
                                      names: [String: String]) -> String {
        let order = speakerOrder(segments)
        return segments
            .map { "\(displayName(for: $0.speaker, names: names, order: order)): \($0.text)" }
            .joined(separator: "\n\n")
    }
}

/// Maps AssemblyAI's `utterances` array (present when `speaker_labels=true`) into
/// `SpeakerSegment`s. `Utterance` is `Decodable` with field names matching AssemblyAI's wire
/// JSON directly, so the provider decodes straight into it (no duplicate wrapper struct) and
/// tests can feed it realistic fixture JSON.
public enum AssemblyAISegmentMapper {
    public struct Utterance: Decodable, Sendable, Equatable {
        public var speaker: String
        public var text: String
        public var start: Int   // milliseconds
        public var end: Int     // milliseconds

        public init(speaker: String, text: String, start: Int, end: Int) {
            self.speaker = speaker
            self.text = text
            self.start = start
            self.end = end
        }
    }

    public static func segments(from utterances: [Utterance]) -> [SpeakerSegment] {
        utterances.compactMap { u in
            let text = u.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            let letter = u.speaker.trimmingCharacters(in: .whitespaces).lowercased()
            return SpeakerSegment(speaker: "speaker_\(letter)",
                                  start: Double(u.start) / 1000,
                                  end: Double(u.end) / 1000,
                                  text: text)
        }
    }
}

/// Maps Deepgram's `results.utterances` array (present when `diarize=true&utterances=true`)
/// into `SpeakerSegment`s. `Utterance` mirrors Deepgram's wire JSON directly (note the field is
/// called `transcript`, not `text`, matching the real response).
public enum DeepgramSegmentMapper {
    public struct Utterance: Decodable, Sendable, Equatable {
        public var speaker: Int
        public var transcript: String
        public var start: TimeInterval   // seconds
        public var end: TimeInterval     // seconds

        public init(speaker: Int, transcript: String, start: TimeInterval, end: TimeInterval) {
            self.speaker = speaker
            self.transcript = transcript
            self.start = start
            self.end = end
        }
    }

    public static func segments(from utterances: [Utterance]) -> [SpeakerSegment] {
        utterances.compactMap { u in
            let text = u.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return SpeakerSegment(speaker: "speaker_\(u.speaker)", start: u.start, end: u.end, text: text)
        }
    }
}

/// Prompt + strict parse for LLM speaker-name guessing ("who said X"): the model reads the
/// labeled transcript and maps speaker ids to real names ONLY where the conversation itself
/// reveals them (introductions, being addressed by name). Mirrors the digest classify
/// pattern — a name is only applied on an unambiguous JSON match, never guessed.
public enum SpeakerNameGuess {
    public static func prompt(segments: [SpeakerSegment]) -> String {
        let order = SpeakerSegmentBuilder.speakerOrder(segments)
        let transcript = segments
            .map { "\($0.speaker): \($0.text)" }
            .joined(separator: "\n")
        return """
        Below is a conversation transcript with generic speaker ids (\(order.joined(separator: ", "))).
        Infer each speaker's real name ONLY when the conversation itself reveals it — an \
        introduction ("I'm Anna"), or another speaker addressing them by name. Keep the \
        transcript's original language in mind; names stay as spoken.

        Reply with ONLY a JSON object mapping speaker ids to names, e.g. \
        {"speaker_0": "Anna"}. Omit speakers whose names are not revealed. If no names are \
        revealed, reply {}.

        Transcript:
        \(transcript)
        """
    }

    /// Parse the model's reply into raw-id → name. Keys must be speaker ids present in the
    /// conversation; blank names are dropped. Tolerates prose/```json fences around the object.
    public static func parse(_ raw: String, knownSpeakers: [String]) -> [String: String] {
        guard let start = raw.firstIndex(of: "{"),
              let end = raw.lastIndex(of: "}"), start < end,
              let data = String(raw[start...end]).data(using: .utf8),
              let map = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        var out: [String: String] = [:]
        let known = Set(knownSpeakers)
        for (key, value) in map {
            let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard known.contains(key), !name.isEmpty else { continue }
            out[key] = name
        }
        return out
    }
}
