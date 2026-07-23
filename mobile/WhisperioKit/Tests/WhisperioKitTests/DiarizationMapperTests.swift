import Foundation
import Testing
@testable import WhisperioKit

// MARK: - AssemblyAISegmentMapper (utterances → segments)

@Suite struct AssemblyAISegmentMapperTests {
    // A trimmed but realistic AssemblyAI `utterances` array (speaker_labels=true), as returned
    // alongside the job's flat `text` on a completed transcript.
    private let fixtureJSON = """
    [
      {"speaker": "A", "text": "Hey, how's it going?", "start": 320, "end": 1780, "confidence": 0.97, "words": []},
      {"speaker": "B", "text": "Pretty good, thanks for asking.", "start": 1900, "end": 3400, "confidence": 0.95, "words": []},
      {"speaker": "A", "text": "Glad to hear it.", "start": 3500, "end": 4200, "confidence": 0.96, "words": []}
    ]
    """

    private func decode() throws -> [AssemblyAISegmentMapper.Utterance] {
        try JSONDecoder().decode([AssemblyAISegmentMapper.Utterance].self, from: Data(fixtureJSON.utf8))
    }

    @Test func decodesRealisticUtteranceFixture() throws {
        let utterances = try decode()
        #expect(utterances.count == 3)
        #expect(utterances[0].speaker == "A")
        #expect(utterances[0].start == 320)
        #expect(utterances[0].end == 1780)
    }

    @Test func mapsLetterSpeakersToLowercasedIDsWithSecondTimestamps() throws {
        let segments = AssemblyAISegmentMapper.segments(from: try decode())
        #expect(segments.map(\.speaker) == ["speaker_a", "speaker_b", "speaker_a"])
        #expect(segments[0].start == 0.32)
        #expect(segments[0].end == 1.78)
        #expect(segments[0].text == "Hey, how's it going?")
    }

    @Test func blankUtteranceTextIsDropped() {
        let segments = AssemblyAISegmentMapper.segments(from: [
            .init(speaker: "A", text: "   ", start: 0, end: 100)
        ])
        #expect(segments.isEmpty)
    }
}

// MARK: - DeepgramSegmentMapper (utterances → segments)

@Suite struct DeepgramSegmentMapperTests {
    // A trimmed but realistic Deepgram `results.utterances` array (diarize=true&utterances=true).
    private let fixtureJSON = """
    [
      {"start": 0.32, "end": 1.78, "confidence": 0.98, "channel": 0, "transcript": "Hey, how's it going?", "words": [], "speaker": 0, "id": "abc-1"},
      {"start": 1.9, "end": 3.4, "confidence": 0.94, "channel": 0, "transcript": "Pretty good, thanks for asking.", "words": [], "speaker": 1, "id": "abc-2"}
    ]
    """

    private func decode() throws -> [DeepgramSegmentMapper.Utterance] {
        try JSONDecoder().decode([DeepgramSegmentMapper.Utterance].self, from: Data(fixtureJSON.utf8))
    }

    @Test func decodesRealisticUtteranceFixture() throws {
        let utterances = try decode()
        #expect(utterances.count == 2)
        #expect(utterances[0].speaker == 0)
        #expect(utterances[1].speaker == 1)
    }

    @Test func mapsIntegerSpeakersToSpeakerIDsPreservingSecondTimestamps() throws {
        let segments = DeepgramSegmentMapper.segments(from: try decode())
        #expect(segments.map(\.speaker) == ["speaker_0", "speaker_1"])
        #expect(segments[0].start == 0.32)
        #expect(segments[0].end == 1.78)
        #expect(segments[1].text == "Pretty good, thanks for asking.")
    }

    @Test func blankTranscriptIsDropped() {
        let segments = DeepgramSegmentMapper.segments(from: [
            .init(speaker: 0, transcript: "  ", start: 0, end: 1)
        ])
        #expect(segments.isEmpty)
    }
}

// MARK: - OpenAISegmentMapper (gpt-4o-transcribe-diarize segments → segments)

@Suite struct OpenAISegmentMapperTests {
    // A trimmed but realistic `diarized_json` `segments` array from gpt-4o-transcribe-diarize.
    private let fixtureJSON = """
    [
      {"speaker": "A", "text": "Hey, how's it going?", "start": 0.32, "end": 1.78},
      {"speaker": "B", "text": "Pretty good, thanks for asking.", "start": 1.9, "end": 3.4},
      {"speaker": "A", "text": "Glad to hear it.", "start": 3.5, "end": 4.2}
    ]
    """

    private func decode() throws -> [OpenAISegmentMapper.Segment] {
        try JSONDecoder().decode([OpenAISegmentMapper.Segment].self, from: Data(fixtureJSON.utf8))
    }

    @Test func decodesRealisticSegmentFixture() throws {
        let segments = try decode()
        #expect(segments.count == 3)
        #expect(segments[0].speaker == "A")
        #expect(segments[0].start == 0.32)
        #expect(segments[0].end == 1.78)
    }

    @Test func mapsLetterSpeakersToLowercasedIDsPreservingSecondTimestamps() throws {
        let segments = OpenAISegmentMapper.segments(from: try decode())
        #expect(segments.map(\.speaker) == ["speaker_a", "speaker_b", "speaker_a"])
        #expect(segments[0].start == 0.32)
        #expect(segments[0].end == 1.78)
        #expect(segments[0].text == "Hey, how's it going?")
    }

    @Test func blankSegmentTextIsDropped() {
        let segments = OpenAISegmentMapper.segments(from: [
            .init(speaker: "A", text: "   ", start: 0, end: 100)
        ])
        #expect(segments.isEmpty)
    }

    @Test func missingSpeakerAndTimestampsDefaultDefensively() {
        let segments = OpenAISegmentMapper.segments(from: [
            .init(speaker: nil, text: "Untagged speech.", start: nil, end: nil)
        ])
        #expect(segments.count == 1)
        #expect(segments[0].speaker == "speaker_a")
        #expect(segments[0].start == 0)
        #expect(segments[0].end == 0)
    }
}
