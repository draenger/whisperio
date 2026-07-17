import Foundation
import Testing
@testable import WhisperioKit

// MARK: - SpeakerSegmentBuilder (diarized words → segments)

@Suite struct SpeakerSegmentBuilderTests {
    private func word(_ text: String, _ speaker: String?, start: TimeInterval = 0,
                      end: TimeInterval = 0, type: String = "word") -> DiarizedWord {
        DiarizedWord(text: text, start: start, end: end, type: type, speakerID: speaker)
    }

    @Test func consecutiveSameSpeakerWordsMergeIntoOneSegment() {
        let segments = SpeakerSegmentBuilder.build(words: [
            word("Hello", "speaker_0", start: 0.0, end: 0.4),
            word(" ", nil, type: "spacing"),
            word("there", "speaker_0", start: 0.5, end: 0.9)
        ])
        #expect(segments == [SpeakerSegment(speaker: "speaker_0", start: 0.0, end: 0.9,
                                            text: "Hello there")])
    }

    @Test func speakerChangeOpensANewSegment() {
        let segments = SpeakerSegmentBuilder.build(words: [
            word("Hi", "speaker_0", start: 0, end: 0.3),
            word(" ", nil, type: "spacing"),
            word("Anna", "speaker_0", start: 0.4, end: 0.8),
            word("Hey", "speaker_1", start: 1.2, end: 1.5),
            word(" ", nil, type: "spacing"),
            word("Marek", "speaker_1", start: 1.6, end: 2.0)
        ])
        #expect(segments.count == 2)
        #expect(segments[0].speaker == "speaker_0")
        #expect(segments[0].text == "Hi Anna")
        #expect(segments[1].speaker == "speaker_1")
        #expect(segments[1].text == "Hey Marek")
        #expect(segments[1].start == 1.2)
        #expect(segments[1].end == 2.0)
    }

    @Test func sameSpeakerReturningLaterGetsItsOwnSegment() {
        let segments = SpeakerSegmentBuilder.build(words: [
            word("one", "speaker_0"),
            word("two", "speaker_1"),
            word("three", "speaker_0")
        ])
        #expect(segments.map(\.speaker) == ["speaker_0", "speaker_1", "speaker_0"])
    }

    @Test func audioEventsAreSkippedWithoutBreakingASegment() {
        let segments = SpeakerSegmentBuilder.build(words: [
            word("before", "speaker_0"),
            word("(laughter)", nil, type: "audio_event"),
            word(" ", nil, type: "spacing"),
            word("after", "speaker_0")
        ])
        #expect(segments.count == 1)
        #expect(segments[0].text == "before after")
    }

    @Test func emptyInputYieldsNoSegments() {
        #expect(SpeakerSegmentBuilder.build(words: []).isEmpty)
        #expect(SpeakerSegmentBuilder.build(words: [word(" ", nil, type: "spacing")]).isEmpty)
    }

    @Test func speakerOrderFollowsFirstAppearance() {
        let segments = [
            SpeakerSegment(speaker: "speaker_1", start: 0, end: 1, text: "a"),
            SpeakerSegment(speaker: "speaker_0", start: 1, end: 2, text: "b"),
            SpeakerSegment(speaker: "speaker_1", start: 2, end: 3, text: "c")
        ]
        #expect(SpeakerSegmentBuilder.speakerOrder(segments) == ["speaker_1", "speaker_0"])
    }

    @Test func displayNamePrefersAssignedNameThenNumbering() {
        let order = ["speaker_1", "speaker_0"]
        #expect(SpeakerSegmentBuilder.displayName(for: "speaker_1", names: [:], order: order)
            == "Speaker 1")
        #expect(SpeakerSegmentBuilder.displayName(for: "speaker_0", names: [:], order: order)
            == "Speaker 2")
        #expect(SpeakerSegmentBuilder.displayName(for: "speaker_0",
                                                  names: ["speaker_0": "Anna"], order: order)
            == "Anna")
        // Blank assigned names fall back to numbering rather than rendering empty.
        #expect(SpeakerSegmentBuilder.displayName(for: "speaker_1",
                                                  names: ["speaker_1": "  "], order: order)
            == "Speaker 1")
    }

    @Test func transcriptTextRendersNamedParagraphs() {
        let segments = [
            SpeakerSegment(speaker: "speaker_0", start: 0, end: 1, text: "Hi Anna"),
            SpeakerSegment(speaker: "speaker_1", start: 1, end: 2, text: "Hey")
        ]
        let text = SpeakerSegmentBuilder.transcriptText(
            segments: segments, names: ["speaker_1": "Anna"])
        #expect(text == "Speaker 1: Hi Anna\n\nAnna: Hey")
    }
}

// MARK: - SpeakerNameGuess (LLM prompt/parse)

@Suite struct SpeakerNameGuessTests {
    private let known = ["speaker_0", "speaker_1"]

    @Test func parsesAPlainJSONObject() {
        let out = SpeakerNameGuess.parse(#"{"speaker_0": "Anna"}"#, knownSpeakers: known)
        #expect(out == ["speaker_0": "Anna"])
    }

    @Test func parsesAFencedReplyWithProse() {
        let raw = """
        Sure! Based on the introductions:
        ```json
        {"speaker_0": "Anna", "speaker_1": "Marek"}
        ```
        """
        let out = SpeakerNameGuess.parse(raw, knownSpeakers: known)
        #expect(out == ["speaker_0": "Anna", "speaker_1": "Marek"])
    }

    @Test func dropsUnknownSpeakersAndBlankNames() {
        let raw = #"{"speaker_0": "Anna", "speaker_7": "Ghost", "speaker_1": "  "}"#
        let out = SpeakerNameGuess.parse(raw, knownSpeakers: known)
        #expect(out == ["speaker_0": "Anna"])
    }

    @Test func garbageYieldsNothing() {
        #expect(SpeakerNameGuess.parse("no json here", knownSpeakers: known).isEmpty)
        #expect(SpeakerNameGuess.parse("{}", knownSpeakers: known).isEmpty)
    }

    @Test func promptContainsTranscriptAndIds() {
        let segments = [
            SpeakerSegment(speaker: "speaker_0", start: 0, end: 1, text: "I'm Anna"),
            SpeakerSegment(speaker: "speaker_1", start: 1, end: 2, text: "Hi Anna")
        ]
        let prompt = SpeakerNameGuess.prompt(segments: segments)
        #expect(prompt.contains("speaker_0: I'm Anna"))
        #expect(prompt.contains("speaker_1: Hi Anna"))
        #expect(prompt.contains("ONLY a JSON object"))
    }
}

// MARK: - Recording additive fields survive the entity round-trip

@Suite struct ConversationPersistenceTests {
    @Test func recordingCodableToleratesMissingConversationFields() throws {
        // A pre-conversation JSON blob (no segments/speakerNames keys) must keep decoding.
        let legacy = """
        {"id":"\(UUID().uuidString)","filename":"a.m4a","timestamp":0,"duration":1,
         "status":"completed"}
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let r = try decoder.decode(Recording.self, from: legacy)
        #expect(r.segments == nil)
        #expect(r.speakerNames == nil)
        #expect(!r.isConversation)
    }

    @available(iOS 17, macOS 14, *)
    @Test func segmentsAndNamesRoundTripThroughTheEntity() {
        let segments = [
            SpeakerSegment(speaker: "speaker_0", start: 0, end: 1.5, text: "Hello"),
            SpeakerSegment(speaker: "speaker_1", start: 2, end: 3, text: "Hi")
        ]
        let r = Recording(filename: "conv.m4a", duration: 3, status: .completed,
                          provider: .elevenLabs, transcription: "Hello Hi",
                          segments: segments, speakerNames: ["speaker_0": "Anna"])
        let roundTripped = RecordingEntity(r).recording
        #expect(roundTripped.segments == segments)
        #expect(roundTripped.speakerNames == ["speaker_0": "Anna"])
        #expect(roundTripped.isConversation)
    }

    @available(iOS 17, macOS 14, *)
    @Test func plainDictationKeepsNilBlobsThroughTheEntity() {
        let r = Recording(filename: "a.m4a", duration: 1, status: .completed,
                          transcription: "hello")
        let entity = RecordingEntity(r)
        #expect(entity.segmentsData == nil)
        #expect(entity.speakerNamesData == nil)
        #expect(entity.recording.segments == nil)
        #expect(!entity.recording.isConversation)
    }

    @available(iOS 17, macOS 14, *)
    @Test func malformedBlobsDecodeAsNilNotACrash() {
        let entity = RecordingEntity(Recording(filename: "a.m4a", duration: 1))
        entity.segmentsData = Data("not json".utf8)
        entity.speakerNamesData = Data("[1,2]".utf8)
        #expect(entity.recording.segments == nil)
        #expect(entity.recording.speakerNames == nil)
    }
}
