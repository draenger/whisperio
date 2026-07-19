import Foundation

/// Identifies a transcription engine. Raw values match the desktop settings JSON so a
/// future shared/synced config stays compatible. `onDevice` is mobile-only (tier 1).
public enum ProviderID: String, Codable, Sendable, CaseIterable {
    case onDevice = "ondevice"
    case openAI = "openai"
    case elevenLabs = "elevenlabs"
    case groq = "groq"
    case deepgram = "deepgram"
    case assemblyAI = "assemblyai"
    case mistral = "mistral"
}

/// Single source of truth for a provider's human-readable name — used by both OnboardingView's
/// provider sheet and SettingsView's Connections rows so the two stop duplicating this map.
public extension ProviderID {
    var displayName: String {
        switch self {
        case .onDevice: return "Apple — on-device"
        case .openAI: return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        case .groq: return "Groq"
        case .deepgram: return "Deepgram"
        case .assemblyAI: return "AssemblyAI"
        case .mistral: return "Mistral"
        }
    }
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
    /// User-assigned category id (see the app's category taxonomy). Optional so recordings
    /// persisted before categories existed keep decoding — nil means "never assigned".
    public var category: String?
    /// The AI-rewritten output for this recording. Optional so recordings persisted before
    /// rewrite existed keep decoding — nil means "never rewritten".
    public var render: String?
    /// Id of the rewrite preset that produced `render`. Optional for the same reason — nil
    /// means "no render, or produced before presets were tracked".
    public var renderPresetID: String?
    /// Last logical mutation time, used for last-writer-wins conflict resolution when the same
    /// recording is written concurrently or out of order (across devices / a CloudKit sync).
    /// Optional so recordings persisted before LWW existed keep decoding — nil is treated as the
    /// record's `timestamp` (its creation time) when comparing writers. See `lastWriteAt`.
    public var updatedAt: Date?
    /// Speaker-diarized segments (Conversation mode). Optional so recordings persisted before
    /// conversations existed keep decoding — nil/empty means "plain dictation".
    public var segments: [SpeakerSegment]?
    /// User-assigned display names per raw speaker id ("speaker_0" → "Anna"). Kept separate
    /// from `segments` so a rename is a tiny metadata write that never rewrites the transcript.
    public var speakerNames: [String: String]?

    /// True when this recording is a diarized conversation (has at least one speaker segment).
    public var isConversation: Bool { !(segments ?? []).isEmpty }

    /// The effective time to compare for last-writer-wins: the explicit `updatedAt` when set,
    /// otherwise the creation `timestamp`. Newer wins on merge/write.
    public var lastWriteAt: Date { updatedAt ?? timestamp }

    public init(
        id: UUID = UUID(),
        filename: String,
        timestamp: Date = Date(),
        duration: TimeInterval,
        status: Status = .pending,
        provider: ProviderID? = nil,
        transcription: String? = nil,
        error: String? = nil,
        category: String? = nil,
        render: String? = nil,
        renderPresetID: String? = nil,
        updatedAt: Date? = nil,
        segments: [SpeakerSegment]? = nil,
        speakerNames: [String: String]? = nil
    ) {
        self.id = id
        self.filename = filename
        self.timestamp = timestamp
        self.duration = duration
        self.status = status
        self.provider = provider
        self.transcription = transcription
        self.error = error
        self.category = category
        self.render = render
        self.renderPresetID = renderPresetID
        self.updatedAt = updatedAt
        self.segments = segments
        self.speakerNames = speakerNames
    }
}
