import Foundation

/// Accumulates a live dictation transcript across SFSpeech recognition segments.
///
/// Apple's recognizer ends a segment on every pause in speech — sometimes with a final
/// result, but on-device often with a plain error and *no* final result. Either way the
/// next segment's transcript starts empty, so whatever the UI should keep showing must be
/// banked here first. The regression this type guards against: restarting a segment
/// without banking wiped everything said before the pause, leaving only the new words.
public struct TranscriptAccumulator: Sendable, Equatable {
    /// Text of segments already finalized (or banked on an error-restart) in this dictation.
    public private(set) var committed: String = ""
    /// Latest partial text of the in-flight segment.
    public private(set) var current: String = ""

    public init() {}

    /// What the UI shows: everything committed so far + the in-progress segment.
    public var liveText: String { Self.join(committed, current) }

    /// Replace the in-flight segment's partial text (SFSpeech partials are cumulative
    /// within a segment, so each callback carries the segment's full text so far).
    ///
    /// Guards against the recognizer's silent reset: after a pause, on-device SFSpeech
    /// sometimes keeps the task alive (no final result, no error) but restarts its
    /// hypothesis, so the next partial contains ONLY the words spoken after the pause.
    /// Blindly replacing `current` would erase everything said before it. When the new
    /// partial looks like a fresh utterance rather than a revision of the old one, the
    /// old partial is banked first — the failure mode becomes a rare duplicated word,
    /// never lost speech.
    public mutating func updateCurrent(_ text: String) {
        if Self.isUtteranceReset(from: current, to: text) {
            bankSegment()
        }
        current = text
    }

    /// Heuristic for "the recognizer started over mid-task": the new partial is much
    /// shorter than what we had AND doesn't begin with the same word. A genuine revision
    /// ("I scream" → "Ice cream selling") keeps most of the length or the leading word;
    /// a reset's first partial is one or two fresh words against a long banked-up text.
    static func isUtteranceReset(from old: String, to new: String) -> Bool {
        guard !old.isEmpty, !new.isEmpty else { return false }
        guard new.count * 2 < old.count else { return false }
        let firstWord = { (s: String) in
            s.split(separator: " ").first.map { $0.lowercased() } ?? ""
        }
        return firstWord(old) != firstWord(new)
    }

    /// Bank the in-flight segment into `committed` and open a fresh one. Called both when
    /// a segment finalizes cleanly AND before an error-driven segment restart — the partial
    /// text is the best (only) record of what was said, so it must never be dropped.
    public mutating func bankSegment() {
        committed = liveText
        current = ""
    }

    public mutating func reset() { self = TranscriptAccumulator() }

    /// Join two transcript fragments with a single separating space, trimming stray edges.
    public static func join(_ a: String, _ b: String) -> String {
        let head = a.trimmingCharacters(in: .whitespacesAndNewlines)
        let tail = b.trimmingCharacters(in: .whitespacesAndNewlines)
        if head.isEmpty { return tail }
        if tail.isEmpty { return head }
        return head + " " + tail
    }
}
