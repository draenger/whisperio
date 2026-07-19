import Foundation

/// A speech-to-text engine. Implemented per-platform (on-device `SpeechTranscriber`,
/// OpenAI/ElevenLabs HTTP, etc.) but driven uniformly by `ProviderChain`.
public protocol TranscriptionProvider: Sendable {
    var id: ProviderID { get }
    /// Whether this provider can run right now (key present, on-device model available…).
    var isConfigured: Bool { get }
    /// Transcribe a clip. Throw on any failure so the chain can fall back.
    func transcribe(_ clip: AudioClip) async throws -> String
}

/// The result of a diarized (speaker-labeled) transcription: the flat text plus per-speaker
/// segments. Provider-agnostic — every diarizing engine (ElevenLabs Scribe, Deepgram Nova,
/// AssemblyAI Universal) folds its own wire format down to this shape.
public struct DiarizedTranscription: Sendable, Equatable {
    public let text: String
    public let segments: [SpeakerSegment]

    public init(text: String, segments: [SpeakerSegment]) {
        self.text = text
        self.segments = segments
    }
}

/// A transcription provider that can additionally separate speakers in one pass. Conversation
/// mode gates on this protocol (`as? any DiarizingProvider`) instead of a single hardcoded
/// engine, so any diarization-capable provider — not just ElevenLabs — can run it.
public protocol DiarizingProvider: TranscriptionProvider {
    func transcribeDiarized(_ clip: AudioClip) async throws -> DiarizedTranscription
}

/// An optional post-processing pass (punctuation, de-umm, custom-vocab fixes).
/// On Apple this is Foundation Models; degrade silently when unavailable.
public protocol CleanupProvider: Sendable {
    /// Whether the cleanup engine is available on this device/OS right now.
    var isAvailable: Bool { get }
    func clean(_ text: String, vocabulary: [String]) async throws -> String
}
