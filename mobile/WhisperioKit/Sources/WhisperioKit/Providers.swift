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

/// An optional post-processing pass (punctuation, de-umm, custom-vocab fixes).
/// On Apple this is Foundation Models; degrade silently when unavailable.
public protocol CleanupProvider: Sendable {
    /// Whether the cleanup engine is available on this device/OS right now.
    var isAvailable: Bool { get }
    func clean(_ text: String, vocabulary: [String]) async throws -> String
}
