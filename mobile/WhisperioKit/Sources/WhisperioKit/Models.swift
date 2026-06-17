import Foundation

/// Identifies a transcription engine. Raw values match the desktop settings JSON so a
/// future shared/synced config stays compatible. `onDevice` is mobile-only (tier 1).
public enum ProviderID: String, Codable, Sendable, CaseIterable {
    case onDevice = "ondevice"
    case openAI = "openai"
    case elevenLabs = "elevenlabs"
}

/// A captured audio clip handed to a transcription provider.
public struct AudioClip: Sendable, Equatable {
    public let data: Data
    public let filename: String
    public let duration: TimeInterval

    public init(data: Data, filename: String, duration: TimeInterval) {
        self.data = data
        self.filename = filename
        self.duration = duration
    }
}

/// The result of a successful transcription, tagged with the engine that produced it.
public struct Transcript: Sendable, Equatable {
    public let text: String
    public let provider: ProviderID

    public init(text: String, provider: ProviderID) {
        self.text = text
        self.provider = provider
    }
}

/// Errors surfaced by the provider chain. Mirrors the desktop fallback semantics.
public enum TranscriptionError: Error, Equatable, Sendable {
    /// No provider in the chain is configured (no keys, no on-device support).
    case noProvidersConfigured
    /// Every provider in the chain failed; carries the first error's message for display.
    case allProvidersFailed(firstError: String)
}

/// One persisted recording + its transcription state (mirrors the desktop history model).
public struct Recording: Identifiable, Codable, Sendable, Equatable {
    public enum Status: String, Codable, Sendable {
        case pending, completed, failed
    }

    public let id: UUID
    public var filename: String
    public var timestamp: Date
    public var duration: TimeInterval
    public var status: Status
    public var provider: ProviderID?
    public var transcription: String?
    public var error: String?

    public init(
        id: UUID = UUID(),
        filename: String,
        timestamp: Date = Date(),
        duration: TimeInterval,
        status: Status = .pending,
        provider: ProviderID? = nil,
        transcription: String? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.filename = filename
        self.timestamp = timestamp
        self.duration = duration
        self.status = status
        self.provider = provider
        self.transcription = transcription
        self.error = error
    }
}
