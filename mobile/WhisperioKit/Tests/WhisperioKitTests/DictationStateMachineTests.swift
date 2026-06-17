import Testing
@testable import WhisperioKit

@Suite struct DictationStateMachineTests {
    @Test func happyPathRunsFullLoop() {
        var s: DictationState = .idle
        s = nextDictationState(s, on: .startRecording); #expect(s == .recording)
        s = nextDictationState(s, on: .stopRecording);  #expect(s == .transcribing)
        s = nextDictationState(s, on: .transcribed);    #expect(s == .cleaning)
        s = nextDictationState(s, on: .cleaned);        #expect(s == .output)
        s = nextDictationState(s, on: .delivered);      #expect(s == .idle)
    }

    @Test func cancelFromAnyStateReturnsToIdle() {
        for state: DictationState in [.recording, .transcribing, .cleaning, .output] {
            #expect(nextDictationState(state, on: .cancel) == .idle)
        }
    }

    @Test func failFromAnyStateReturnsToIdle() {
        for state: DictationState in [.recording, .transcribing, .cleaning, .output] {
            #expect(nextDictationState(state, on: .fail) == .idle)
        }
    }

    @Test func invalidTransitionsAreNoOps() {
        // Can't stop a recording that never started, etc.
        #expect(nextDictationState(.idle, on: .stopRecording) == .idle)
        #expect(nextDictationState(.idle, on: .transcribed) == .idle)
        #expect(nextDictationState(.recording, on: .startRecording) == .recording)
        #expect(nextDictationState(.output, on: .transcribed) == .output)
    }
}
