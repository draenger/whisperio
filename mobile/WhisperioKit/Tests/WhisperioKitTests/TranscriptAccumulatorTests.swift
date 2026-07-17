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

    /// Regression #2: on-device SFSpeech can reset its hypothesis after a pause WITHOUT
    /// ending the task — no final result, no error, the next partial just contains only
    /// the new words. updateCurrent must detect that and bank the old partial instead of
    /// letting the replacement erase it.
    @Test func silentRecognizerResetBanksInsteadOfErasing() {
        var acc = TranscriptAccumulator()
        acc.updateCurrent("kupiłem")
        acc.updateCurrent("kupiłem dziś mleko w sklepie")
        // Pause → recognizer restarts silently; first fresh partial is one new word.
        acc.updateCurrent("i")
        acc.updateCurrent("i chleb z masłem")
        #expect(acc.liveText == "kupiłem dziś mleko w sklepie i chleb z masłem")
    }

    @Test func genuineRevisionsStillReplaceNotAppend() {
        var acc = TranscriptAccumulator()
        // The recognizer revising its hypothesis keeps most of the text — no banking.
        acc.updateCurrent("I scream selling is a great business")
        acc.updateCurrent("Ice cream selling is a great business")
        #expect(acc.liveText == "Ice cream selling is a great business")
        // Same leading word with a big shrink is also a revision, not a reset.
        acc.updateCurrent("Ice cream")
        #expect(acc.liveText == "Ice cream")
    }

    @Test func resetDetectionHeuristics() {
        // Fresh short word vs long banked text, different first word → reset.
        #expect(TranscriptAccumulator.isUtteranceReset(
            from: "everything said before the pause", to: "new"))
        // Longer or comparable text → revision.
        #expect(!TranscriptAccumulator.isUtteranceReset(from: "I scream", to: "Ice cream"))
        // Same first word → revision even when much shorter.
        #expect(!TranscriptAccumulator.isUtteranceReset(
            from: "hello world how are you", to: "hello"))
        // Empty edges never trigger.
        #expect(!TranscriptAccumulator.isUtteranceReset(from: "", to: "x"))
        #expect(!TranscriptAccumulator.isUtteranceReset(from: "x", to: ""))
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
