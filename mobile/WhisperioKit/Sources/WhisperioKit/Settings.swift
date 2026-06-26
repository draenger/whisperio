import Foundation

/// User settings, mirroring the desktop `AppSettings` shape (so config can be shared/synced
/// later). No secrets are baked in — all keys default to empty and are entered at runtime.
public struct WhisperioSettings: Codable, Sendable, Equatable {
    /// Engine priority order. Default puts privacy/offline first, cloud last.
    public var providerChain: [ProviderID]

    // Cloud (BYO key) — empty until the user opts in and pastes a key at runtime.
    public var openAIKey: String
    public var openAIBaseURL: String
    public var whisperModel: String
    public var elevenLabsKey: String

    // Transcription tuning.
    public var language: String          // "auto" or an ISO code
    public var customVocabulary: String  // comma-separated terms
    public var transcriptionPrompt: String

    // Behavior.
    public var cleanupEnabled: Bool      // tidy punctuation/casing/spacing after transcription
    public var fallbackEnabled: Bool     // try the other configured engines if the primary fails
    public var saveRecordings: Bool
    /// Stream on-device partial results so text appears live as you speak. On-device only
    /// (and free) — when off, or when a cloud engine is primary, dictation transcribes once
    /// after you stop.
    public var liveTranscriptionEnabled: Bool

    /// Explicit, persisted consent that audio may leave the device for a cloud provider.
    /// On-device (Apple Speech) never needs this; cloud providers stay disabled until granted.
    public var cloudConsentGranted: Bool

    public init(
        providerChain: [ProviderID] = [.onDevice],
        openAIKey: String = "",
        openAIBaseURL: String = "",
        whisperModel: String = "",
        elevenLabsKey: String = "",
        language: String = "auto",
        customVocabulary: String = "",
        transcriptionPrompt: String = "",
        cleanupEnabled: Bool = false,
        fallbackEnabled: Bool = false,
        saveRecordings: Bool = true,
        liveTranscriptionEnabled: Bool = true,
        cloudConsentGranted: Bool = false
    ) {
        self.providerChain = providerChain
        self.openAIKey = openAIKey
        self.openAIBaseURL = openAIBaseURL
        self.whisperModel = whisperModel
        self.elevenLabsKey = elevenLabsKey
        self.language = language
        self.customVocabulary = customVocabulary
        self.transcriptionPrompt = transcriptionPrompt
        self.cleanupEnabled = cleanupEnabled
        self.fallbackEnabled = fallbackEnabled
        self.saveRecordings = saveRecordings
        self.liveTranscriptionEnabled = liveTranscriptionEnabled
        self.cloudConsentGranted = cloudConsentGranted
    }

    // Tolerant decoding — missing keys (older persisted settings, or future-added fields)
    // fall back to defaults instead of throwing, so a stored API key is never lost.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = WhisperioSettings()
        providerChain = try c.decodeIfPresent([ProviderID].self, forKey: .providerChain) ?? d.providerChain
        openAIKey = try c.decodeIfPresent(String.self, forKey: .openAIKey) ?? d.openAIKey
        openAIBaseURL = try c.decodeIfPresent(String.self, forKey: .openAIBaseURL) ?? d.openAIBaseURL
        whisperModel = try c.decodeIfPresent(String.self, forKey: .whisperModel) ?? d.whisperModel
        elevenLabsKey = try c.decodeIfPresent(String.self, forKey: .elevenLabsKey) ?? d.elevenLabsKey
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? d.language
        customVocabulary = try c.decodeIfPresent(String.self, forKey: .customVocabulary) ?? d.customVocabulary
        transcriptionPrompt = try c.decodeIfPresent(String.self, forKey: .transcriptionPrompt) ?? d.transcriptionPrompt
        cleanupEnabled = try c.decodeIfPresent(Bool.self, forKey: .cleanupEnabled) ?? d.cleanupEnabled
        fallbackEnabled = try c.decodeIfPresent(Bool.self, forKey: .fallbackEnabled) ?? d.fallbackEnabled
        saveRecordings = try c.decodeIfPresent(Bool.self, forKey: .saveRecordings) ?? d.saveRecordings
        liveTranscriptionEnabled = try c.decodeIfPresent(Bool.self, forKey: .liveTranscriptionEnabled) ?? d.liveTranscriptionEnabled
        cloudConsentGranted = try c.decodeIfPresent(Bool.self, forKey: .cloudConsentGranted) ?? d.cloudConsentGranted
    }

    /// Whether the given engine requires (and currently has) cloud consent to run.
    public func isCloud(_ id: ProviderID) -> Bool { id == .openAI || id == .elevenLabs }

    /// Vocabulary parsed into trimmed, non-empty terms.
    public var vocabularyTerms: [String] {
        customVocabulary
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
