import Foundation

/// The dictation lifecycle, identical to desktop plus an explicit `cleaning` step:
/// `idle → recording → transcribing → cleaning → output → idle`.
public enum DictationState: String, Sendable, Equatable {
    case idle
    case recording
    case transcribing
    case cleaning
    case output
}

/// Events that drive transitions.
public enum DictationEvent: Sendable, Equatable {
    case startRecording
    case stopRecording      // recording → transcribing
    case transcribed        // transcribing → cleaning
    case cleaned            // cleaning → output
    case delivered          // output → idle
    case cancel             // any → idle
    case fail               // any → idle
}

/// Pure transition function — no side effects, trivially unit-testable. Invalid
/// (state, event) pairs are no-ops (return the current state) so callers can fire
/// events defensively without crashing the machine.
public func nextDictationState(_ state: DictationState, on event: DictationEvent) -> DictationState {
    switch event {
    case .cancel, .fail:
        return .idle
    case .startRecording:
        return state == .idle ? .recording : state
    case .stopRecording:
        return state == .recording ? .transcribing : state
    case .transcribed:
        return state == .transcribing ? .cleaning : state
    case .cleaned:
        return state == .cleaning ? .output : state
    case .delivered:
        return state == .output ? .idle : state
    }
}
