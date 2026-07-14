import Foundation

/// Where transcripts (the recordings history) are persisted. User-selectable in Settings.
/// `onDevice` keeps everything in a private local SwiftData store; `iCloud` syncs the private
/// CloudKit database across the user's Apple devices. Switching takes effect on next launch
/// (the SwiftData ModelContainer config is fixed at init — see `RecordingSyncStore`).
public enum StorageMode: String, Codable, Sendable, CaseIterable { case onDevice; case iCloud }

/// What Whisperio should do when iOS interrupts an active audio session (phone call, Siri,
/// alarms, FaceTime, other audio owners). iOS always tears down the mic; this only controls
/// whether Whisperio should stop and exit cleanly, or try to start a fresh session again
/// once the interruption ends.
public enum AudioInterruptionBehavior: String, Codable, Sendable, CaseIterable {
    case stop = "stop"
    case resume = "resume"
}

/// When Whisperio actively refreshes from iCloud and publishes those changes into the UI.
///
/// HONESTY NOTE: iOS/SwiftData+CloudKit gives no API to pause the underlying
/// `NSPersistentCloudKitContainer`'s background import — a remote change can land in the
/// on-disk store at any time no matter which mode is selected here. What these modes actually
/// control is narrower but real: (a) whether an import that already landed is immediately
/// reflected in the UI, and (b) when the app proactively asks CloudKit to check for more. See
/// `SyncGating` for the pure decision functions, and the Settings copy in `SettingsView` for the
/// exact wording shown to the user.
public enum SyncMode: String, Codable, Sendable, CaseIterable {
    /// Default — today's shipped behavior. CloudKit import events publish straight into the UI
    /// as they land, and the app also nudges (re-checks) every time it comes to the foreground.
    case automatic
    /// Nudge once when the app comes to the foreground; otherwise stay quiet — no live-publishing
    /// of background imports and no recurring timer.
    case onOpen
    /// Nudge on a repeating timer while the app is in the foreground (`scenePhase == .active`);
    /// the timer stops the moment the app leaves the foreground. Also nudges once on open, same
    /// as `.onOpen`, so the first check doesn't wait a full interval.
    case interval
    /// Never nudge automatically. The user must tap the Sync button to refresh.
    case manual
}

/// Automatic stop timeout after silence. Off by default so Whisperio behaves like a normal
/// dictation app unless the user opts into auto-release.
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
    /// Chat model for the text-LLM (rewrite render presets + journaling summary) — one
    /// configurable value both flows share, ported from the desktop's 'gpt-4o-mini' default.
    public var chatModel: String

    // Transcription tuning.
    public var language: String          // "auto" or an ISO code
    public var customVocabulary: String  // comma-separated terms

    // Behavior.
    public var cleanupEnabled: Bool      // tidy punctuation/casing/spacing after transcription
    public var fallbackEnabled: Bool     // try the other configured engines if the primary fails
    public var saveRecordings: Bool
    /// Stream on-device partial results so text appears live as you speak. On-device only
    /// (and free) — when off, or when a cloud engine is primary, dictation transcribes once
    /// after you stop.
    public var liveTranscriptionEnabled: Bool
    /// Let the Apple Speech engine fall back to Apple's online recognition when on-device
    /// isn't available for the language/device. Off by default — keeps the "audio never
    /// leaves the device" guarantee; when on, audio may be sent to Apple so STT still works.
    public var appleAllowOnline: Bool
    /// What Whisperio should do when iOS interrupts the audio session.
    public var audioInterruptionBehavior: AudioInterruptionBehavior
    /// Auto-stop mic after a period of silence. `0` disables it. Value is seconds.
    public var audioAutoStopTimeoutSeconds: Double

    /// Explicit, persisted consent that audio may leave the device for a cloud provider.
    /// On-device (Apple Speech) never needs this; cloud providers stay disabled until granted.
    public var cloudConsentGranted: Bool

    /// Auto-journaling: when on, prior days' notes are classified + summarized in the background
    /// (once/day) via the cloud text-LLM. Off by default — it sends transcripts to the cloud, so
    /// it stays gated behind the same cloud consent + key as rewrite.
    public var autoDailyDigest: Bool

    // GitHub sync — mirror transcripts/renders/daily syntheses into a Git repo as Markdown.
    // Off by default; the personal access token itself lives in the Keychain (see
    // `Keychain.Item.githubToken`), never in this blob, so it stays out of plaintext backups.
    public var githubSyncEnabled: Bool
    public var githubOwner: String       // repo owner (user or org login)
    public var githubRepo: String        // repository name
    public var githubBranch: String      // branch to commit onto
    public var githubPathPrefix: String  // optional folder prefix inside the repo
    /// Personal access token (BYO). Empty until the user pastes one at runtime. Like the cloud
    /// keys, the persisted copy lives in the Keychain — SettingsStore scrubs this out of the
    /// UserDefaults blob before writing, so it never sits in plaintext backups.
    public var githubToken: String

    /// Where transcripts are stored: local-only (`onDevice`) or synced via the user's private
    /// CloudKit database (`iCloud`). Defaults to `.iCloud` to preserve the shipped behavior for
    /// existing users. Read by `RecordingSyncStore` at launch to pick the SwiftData backend.
    public var storageMode: StorageMode

    /// When Whisperio actively refreshes from iCloud / publishes background imports to the UI.
    /// Defaults to `.automatic` — today's shipped push-driven behavior — so existing users see no
    /// change until they opt into a quieter mode. Unlike `storageMode`, this is read live: no
    /// relaunch is required for a change to take effect (see `RecordingSyncStore`/`DigestSyncStore`
    /// `persistedSyncMode()` and `WZPhoneView`'s scenePhase/timer wiring).
    public var syncMode: SyncMode

    /// Minutes between nudges when `syncMode == .interval`. Only meaningful in that mode.
    /// Intended values are 5/15/30/60 (the Settings UI offers exactly those), but any positive
    /// value is honored; a non-positive or missing value falls back to the default.
    public var syncIntervalMinutes: Int

    public init(
        providerChain: [ProviderID] = [.onDevice],
        openAIKey: String = "",
        openAIBaseURL: String = "",
        whisperModel: String = "",
        elevenLabsKey: String = "",
        chatModel: String = "gpt-4o-mini",
        language: String = "auto",
        customVocabulary: String = "",
        cleanupEnabled: Bool = false,
        fallbackEnabled: Bool = false,
        saveRecordings: Bool = true,
        liveTranscriptionEnabled: Bool = true,
        appleAllowOnline: Bool = false,
        audioInterruptionBehavior: AudioInterruptionBehavior = .stop,
        audioAutoStopTimeoutSeconds: Double = 0,
        cloudConsentGranted: Bool = false,
        autoDailyDigest: Bool = false,
        githubSyncEnabled: Bool = false,
        githubOwner: String = "",
        githubRepo: String = "",
        githubBranch: String = "main",
        githubPathPrefix: String = "",
        githubToken: String = "",
        storageMode: StorageMode = .iCloud,
        syncMode: SyncMode = .automatic,
        syncIntervalMinutes: Int = 15
    ) {
        self.providerChain = providerChain
        self.openAIKey = openAIKey
        self.openAIBaseURL = openAIBaseURL
        self.whisperModel = whisperModel
        self.elevenLabsKey = elevenLabsKey
        self.chatModel = chatModel
        self.language = language
        self.customVocabulary = customVocabulary
        self.cleanupEnabled = cleanupEnabled
        self.fallbackEnabled = fallbackEnabled
        self.saveRecordings = saveRecordings
        self.liveTranscriptionEnabled = liveTranscriptionEnabled
        self.appleAllowOnline = appleAllowOnline
        self.audioInterruptionBehavior = audioInterruptionBehavior
        self.audioAutoStopTimeoutSeconds = audioAutoStopTimeoutSeconds
        self.cloudConsentGranted = cloudConsentGranted
        self.autoDailyDigest = autoDailyDigest
        self.githubSyncEnabled = githubSyncEnabled
        self.githubOwner = githubOwner
        self.githubRepo = githubRepo
        self.githubBranch = githubBranch
        self.githubPathPrefix = githubPathPrefix
        self.githubToken = githubToken
        self.storageMode = storageMode
        self.syncMode = syncMode
        self.syncIntervalMinutes = syncIntervalMinutes
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
        chatModel = try c.decodeIfPresent(String.self, forKey: .chatModel) ?? d.chatModel
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? d.language
        customVocabulary = try c.decodeIfPresent(String.self, forKey: .customVocabulary) ?? d.customVocabulary
        cleanupEnabled = try c.decodeIfPresent(Bool.self, forKey: .cleanupEnabled) ?? d.cleanupEnabled
        fallbackEnabled = try c.decodeIfPresent(Bool.self, forKey: .fallbackEnabled) ?? d.fallbackEnabled
        saveRecordings = try c.decodeIfPresent(Bool.self, forKey: .saveRecordings) ?? d.saveRecordings
        liveTranscriptionEnabled = try c.decodeIfPresent(Bool.self, forKey: .liveTranscriptionEnabled) ?? d.liveTranscriptionEnabled
        appleAllowOnline = try c.decodeIfPresent(Bool.self, forKey: .appleAllowOnline) ?? d.appleAllowOnline
        audioInterruptionBehavior = try c.decodeIfPresent(AudioInterruptionBehavior.self, forKey: .audioInterruptionBehavior) ?? d.audioInterruptionBehavior
        audioAutoStopTimeoutSeconds = try c.decodeIfPresent(Double.self, forKey: .audioAutoStopTimeoutSeconds) ?? d.audioAutoStopTimeoutSeconds
        cloudConsentGranted = try c.decodeIfPresent(Bool.self, forKey: .cloudConsentGranted) ?? d.cloudConsentGranted
        autoDailyDigest = try c.decodeIfPresent(Bool.self, forKey: .autoDailyDigest) ?? d.autoDailyDigest
        githubSyncEnabled = try c.decodeIfPresent(Bool.self, forKey: .githubSyncEnabled) ?? d.githubSyncEnabled
        githubOwner = try c.decodeIfPresent(String.self, forKey: .githubOwner) ?? d.githubOwner
        githubRepo = try c.decodeIfPresent(String.self, forKey: .githubRepo) ?? d.githubRepo
        githubBranch = try c.decodeIfPresent(String.self, forKey: .githubBranch) ?? d.githubBranch
        githubPathPrefix = try c.decodeIfPresent(String.self, forKey: .githubPathPrefix) ?? d.githubPathPrefix
        githubToken = try c.decodeIfPresent(String.self, forKey: .githubToken) ?? d.githubToken
        storageMode = try c.decodeIfPresent(StorageMode.self, forKey: .storageMode) ?? d.storageMode
        // An unknown/garbled raw value (e.g. a future build's mode this build has never heard of)
        // makes the synthesized `SyncMode` decode THROW, not return nil — `decodeIfPresent` only
        // covers a missing key. Wrapping in `try?` catches that throw too (Swift flattens the
        // resulting `SyncMode??` to `SyncMode?`), so both "missing" and "unrecognized" fall back
        // to the default exactly like every other tolerant field here.
        syncMode = (try? c.decodeIfPresent(SyncMode.self, forKey: .syncMode)) ?? d.syncMode
        let decodedMinutes = try c.decodeIfPresent(Int.self, forKey: .syncIntervalMinutes) ?? d.syncIntervalMinutes
        syncIntervalMinutes = decodedMinutes > 0 ? decodedMinutes : d.syncIntervalMinutes
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
