import Foundation
import Testing
@testable import WhisperioKit

// MARK: - TranscriptAccumulator (live dictation append-across-pauses)

@Suite struct TranscriptAccumulatorTests {
    @Test func partialsReplaceWithinASegment() {
        var acc = TranscriptAccumulator()
        acc.updateCurrent("hello")
        acc.updateCurrent("hello world")
        #expect(acc.liveText == "hello world")
    }

    @Test func finalizedSegmentsAppend() {
        var acc = TranscriptAccumulator()
        acc.updateCurrent("first sentence")
        acc.bankSegment()
        acc.updateCurrent("second")
        #expect(acc.liveText == "first sentence second")
    }

    /// Regression: SFSpeech on-device often ends a pause with a plain error and NO final
    /// result. The restart path must bank the in-flight partial — before the fix it cleared
    /// it, so everything said before the pause vanished and only the new words remained.
    @Test func errorRestartWithoutFinalResultKeepsEarlierText() {
        var acc = TranscriptAccumulator()
        acc.updateCurrent("everything said before the pause")
        // Segment dies on an error → restart banks instead of wiping.
        acc.bankSegment()
        acc.updateCurrent("new words after the pause")
        #expect(acc.liveText == "everything said before the pause new words after the pause")
        // And a follow-up finalize keeps compounding, never replacing.
        acc.bankSegment()
        acc.updateCurrent("third part")
        #expect(acc.liveText
            == "everything said before the pause new words after the pause third part")
    }

    @Test func bankingEmptySegmentIsANoOp() {
        var acc = TranscriptAccumulator()
        acc.updateCurrent("kept")
        acc.bankSegment()
        acc.bankSegment()   // no partial in flight — nothing changes
        #expect(acc.liveText == "kept")
    }

    @Test func joinTrimsAndSpacesFragments() {
        #expect(TranscriptAccumulator.join("a ", " b") == "a b")
        #expect(TranscriptAccumulator.join("", "b") == "b")
        #expect(TranscriptAccumulator.join("a", "") == "a")
        #expect(TranscriptAccumulator.join("", "") == "")
    }

    @Test func resetClearsEverything() {
        var acc = TranscriptAccumulator()
        acc.updateCurrent("x")
        acc.bankSegment()
        acc.reset()
        #expect(acc.liveText == "")
    }
}
