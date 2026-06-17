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
    public var cleanupEnabled: Bool      // on-device AI cleanup pass when available
    public var saveRecordings: Bool

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
        saveRecordings: Bool = true
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
        self.saveRecordings = saveRecordings
    }

    /// Vocabulary parsed into trimmed, non-empty terms.
    public var vocabularyTerms: [String] {
        customVocabulary
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
