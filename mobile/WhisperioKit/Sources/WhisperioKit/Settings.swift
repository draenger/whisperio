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
/// Which capture sources feed the daily Journal digest. Keyboard dictations are usually chat
/// replies the user may not want summarized alongside real notes, so this is a real, meaningful
/// choice — not every source belongs in every day's summary. Every source still keeps its own
/// tag on the recording itself; this only decides what `DigestStore.generate` bundles into the
/// AI/manual summary for a day. See mob-settings.jsx:173,415-424 for the design and copy.
public enum DigestSourceMode: String, Codable, Sendable, CaseIterable {
    /// Everything — in-app, keyboard, Action Button and Watch — lands in the daily digest.
    case all
    /// Only in-app dictations count (source `"app"`/`"mic"`, or nil — recordings persisted
    /// before the `source` field existed, which were all in-app back then). Keyboard/Watch/
    /// Action-Button/Back-Tap notes stay out of the digest but remain in the library.
    case appOnly
    /// Nothing is auto-included — each day the user ticks which of that day's real sources the
    /// summary should cover (`DigestDayView`'s Generate flow presents the picker).
    case manual
}

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

/// One slot in the ordered transcription model chain: which provider runs and with which
/// model id. `model` may be empty — it then resolves to that engine's per-engine selected
/// model (see `WhisperioSettings.resolvedModel(for:)`), so a slot without an explicit model
/// keeps following the engine's configured default. The same provider can appear in several
/// slots with different models.
public struct ProviderSlot: Codable, Sendable, Equatable, Hashable {
    public var provider: ProviderID
    public var model: String

    public init(provider: ProviderID, model: String = "") {
        self.provider = provider
        self.model = model
    }

    // Tolerant decoding — a slot persisted without a model keeps decoding; `model` falls
    // back to empty ("follow the engine's selected model").
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        provider = try c.decode(ProviderID.self, forKey: .provider)
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
    }
}

/// A user-defined transcript category, persisted as plain data — not a UI type. The app target
/// (which owns icon/color rendering) turns this into whatever category shape it renders; here
/// it's just the durable id/label/icon plus a `hueIndex` that cycles through the design's fixed
/// accent-hue palette in creation order, so a freshly added category gets a stable, distinct
/// color without this Kit needing to know what a `Color` is. Seed categories (Work/Personal/
/// Ideas/Messages/Code/To-do) are NOT stored here — they're fixed in the app's category
/// taxonomy; this only carries the ones the user added themselves (see R7's "New category" row).
public struct CustomCategory: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var label: String
    public var icon: String
    public var hueIndex: Int

    public init(id: String = UUID().uuidString, label: String, icon: String = "spark", hueIndex: Int = 0) {
        self.id = id
        self.label = label
        self.icon = icon
        self.hueIndex = hueIndex
    }

    // Tolerant decoding — a legacy/partial blob falls back to sane defaults instead of throwing,
    // matching every other persisted type in this Kit.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "spark"
        hueIndex = try c.decodeIfPresent(Int.self, forKey: .hueIndex) ?? 0
    }
}

/// Automatic stop timeout after silence. Off by default so Whisperio behaves like a normal
/// dictation app unless the user opts into auto-release.
/// User settings, mirroring the desktop `AppSettings` shape (so config can be shared/synced
/// later). No secrets are baked in — all keys default to empty and are entered at runtime.
public struct WhisperioSettings: Codable, Sendable, Equatable {
    /// The ordered (provider, model) slots — the "Model order" card in Settings. Slot 0 is
    /// the primary engine that transcribes; later slots are walked in order on failure when
    /// `fallbackEnabled` is on. Replaces the legacy `providerChain` (primary) +
    /// `fallbackChain` (ordered fallbacks) pair — both remain available as computed
    /// compatibility accessors, and legacy blobs are migrated on decode.
    public var modelOrder: [ProviderSlot]

    /// The classic implicit engine order — privacy/offline first, cloud last. Used both as
    /// the default slot order and as the migration fallback for legacy blobs that never
    /// persisted a chain, preserving the pre-slot "try all the others" behavior.
    public static let classicOrder: [ProviderID] = [.onDevice, .openAI, .elevenLabs,
                                                    .groq, .deepgram, .assemblyAI, .mistral]

    // Cloud (BYO key) — empty until the user opts in and pastes a key at runtime.
    public var openAIKey: String
    public var openAIBaseURL: String
    public var whisperModel: String
    public var elevenLabsKey: String
    /// ElevenLabs Scribe model id (e.g. "scribe_v2", "scribe_v1"). Empty means "follow
    /// ElevenLabsProvider's own default" (diarize/keyterms picks v2, otherwise v1) — the exact
    /// behavior existing users already had before this field existed, so leaving it unset is a
    /// true no-op, not a silent model change.
    public var elevenLabsModel: String
    /// Groq — OpenAI-compatible Whisper inference (fastest cloud Whisper).
    public var groqKey: String
    public var groqModel: String
    /// Deepgram — Nova models, streaming & diarization.
    public var deepgramKey: String
    public var deepgramModel: String
    /// AssemblyAI — Universal models, speaker labels.
    public var assemblyAIKey: String
    public var assemblyAIModel: String
    /// Mistral — Voxtral open-weights transcription.
    public var mistralKey: String
    public var mistralModel: String
    /// Replicate — hosted inference (BYO API token). `replicateModel` names an owner/name (or
    /// owner/name:version) slug; empty follows `ReplicateProvider`'s default (`openai/whisper`).
    public var replicateKey: String
    public var replicateModel: String
    /// Self-hosted OpenAI-compatible STT server (whisper.cpp server / faster-whisper-server /
    /// speaches). `selfHostedKey` is an optional bearer token — many self-hosted setups run with
    /// no auth at all, so unlike the other cloud keys an empty one is a normal, working state,
    /// not "not configured" (configuration is driven by `selfHostedURL` instead).
    public var selfHostedURL: String
    public var selfHostedKey: String
    public var selfHostedModel: String
    /// On-device Whisper (WhisperKit/CoreML) — which local model variant a modelless
    /// `.localWhisper` slot follows. One of `LocalWhisperModel`'s raw values (e.g.
    /// "openai_whisper-base"). Not a secret — no Keychain scrubbing needed, unlike the cloud keys.
    public var localWhisperModel: String
    /// Chat model for the text-LLM (rewrite render presets + journaling summary) — one
    /// configurable value both flows share, ported from the desktop's 'gpt-4o-mini' default.
    public var chatModel: String

    // Transcription tuning.
    public var language: String          // "auto" or an ISO code
    /// The user's confirmed languages from onboarding step 2 (ordered; first is primary),
    /// e.g. seeded from the device's enabled keyboards. Persisted for Settings/onboarding to
    /// reflect back to the user; `language` (above) is what engines actually consume — set to
    /// the first entry here when the user confirms their selection. Empty means "never set"
    /// (e.g. pre-onboarding-v2 installs), not "no languages".
    public var preferredLanguages: [String]
    public var customVocabulary: String  // comma-separated terms

    // Behavior.
    public var cleanupEnabled: Bool      // tidy punctuation/casing/spacing after transcription
    public var fallbackEnabled: Bool     // walk the model order past slot 0 if the primary fails
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

    /// Which capture sources `DigestStore.generate` bundles into a day's digest. Defaults to
    /// `.all` — today's shipped behavior (every completed note counts) — so existing users see
    /// no change until they opt into filtering keyboard/Watch notes out.
    public var digestSourceMode: DigestSourceMode

    /// Whether a note's category is auto-assigned by the classification LLM call. Defaults to
    /// `true` — today's shipped behavior (every note is classified) — so existing users see no
    /// change; turning it off skips the classification network call entirely (notes land
    /// uncategorized/in their existing category) per R7.
    public var autoCategorize: Bool
    /// User-added transcript categories, appended after the fixed seed taxonomy. Empty by
    /// default — every user starts with just the seeds; see `CustomCategory`.
    public var customCategories: [CustomCategory]

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

    // Storage & data (auto-clean). Off by default — nothing is ever deleted unless the user
    // opts in on the Storage & data screen.
    /// When on, recordings older than `autoDeleteAfterDays` are erased on foreground.
    public var autoDeleteEnabled: Bool
    /// Retention window for auto-delete. The UI offers 1/7/30; any positive value is honored.
    public var autoDeleteAfterDays: Int
    /// When off, the audio file is discarded right after transcription — only text is kept.
    public var keepAudioRecordings: Bool

    /// R3: whether the "Engine & privacy" (OldDeviceView) screen has already been shown once
    /// for this device. Set the first time Recording is opened on a device where
    /// `SFSpeechRecognizer` cannot do on-device recognition, so the notice is honest (only
    /// shown on devices that actually lack the capability) and only shown once.
    public var oldDeviceNoticeShown: Bool

    public init(
        modelOrder: [ProviderSlot]? = nil,
        providerChain: [ProviderID] = [.onDevice],
        fallbackChain: [ProviderID] = WhisperioSettings.classicOrder,
        openAIKey: String = "",
        openAIBaseURL: String = "",
        whisperModel: String = "",
        elevenLabsKey: String = "",
        elevenLabsModel: String = "",
        groqKey: String = "",
        groqModel: String = "whisper-large-v3-turbo",
        deepgramKey: String = "",
        deepgramModel: String = "nova-3",
        assemblyAIKey: String = "",
        assemblyAIModel: String = "universal-2",
        mistralKey: String = "",
        mistralModel: String = "voxtral-small",
        replicateKey: String = "",
        replicateModel: String = "",
        selfHostedURL: String = "",
        selfHostedKey: String = "",
        selfHostedModel: String = "",
        localWhisperModel: String = "openai_whisper-base",
        chatModel: String = "gpt-4o-mini",
        language: String = "auto",
        preferredLanguages: [String] = [],
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
        digestSourceMode: DigestSourceMode = .all,
        autoCategorize: Bool = true,
        customCategories: [CustomCategory] = [],
        githubSyncEnabled: Bool = false,
        githubOwner: String = "",
        githubRepo: String = "",
        githubBranch: String = "main",
        githubPathPrefix: String = "",
        githubToken: String = "",
        storageMode: StorageMode = .iCloud,
        syncMode: SyncMode = .automatic,
        syncIntervalMinutes: Int = 15,
        autoDeleteEnabled: Bool = false,
        autoDeleteAfterDays: Int = 7,
        keepAudioRecordings: Bool = true,
        oldDeviceNoticeShown: Bool = false
    ) {
        // An explicit non-empty slot list wins; otherwise synthesize the equivalent slots
        // from the legacy primary + fallback pair (also how fresh defaults are built).
        if let modelOrder, !modelOrder.isEmpty {
            self.modelOrder = modelOrder
        } else {
            self.modelOrder = Self.migratedOrder(primary: providerChain.first ?? .onDevice,
                                                 fallback: fallbackChain)
        }
        self.openAIKey = openAIKey
        self.openAIBaseURL = openAIBaseURL
        self.whisperModel = whisperModel
        self.elevenLabsKey = elevenLabsKey
        self.elevenLabsModel = elevenLabsModel
        self.groqKey = groqKey
        self.groqModel = groqModel
        self.deepgramKey = deepgramKey
        self.deepgramModel = deepgramModel
        self.assemblyAIKey = assemblyAIKey
        self.assemblyAIModel = assemblyAIModel
        self.mistralKey = mistralKey
        self.mistralModel = mistralModel
        self.replicateKey = replicateKey
        self.replicateModel = replicateModel
        self.selfHostedURL = selfHostedURL
        self.selfHostedKey = selfHostedKey
        self.selfHostedModel = selfHostedModel
        self.localWhisperModel = localWhisperModel
        self.chatModel = chatModel
        self.language = language
        self.preferredLanguages = preferredLanguages
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
        self.digestSourceMode = digestSourceMode
        self.autoCategorize = autoCategorize
        self.customCategories = customCategories
        self.githubSyncEnabled = githubSyncEnabled
        self.githubOwner = githubOwner
        self.githubRepo = githubRepo
        self.githubBranch = githubBranch
        self.githubPathPrefix = githubPathPrefix
        self.githubToken = githubToken
        self.storageMode = storageMode
        self.syncMode = syncMode
        self.syncIntervalMinutes = syncIntervalMinutes
        self.autoDeleteEnabled = autoDeleteEnabled
        self.autoDeleteAfterDays = autoDeleteAfterDays
        self.keepAudioRecordings = keepAudioRecordings
        self.oldDeviceNoticeShown = oldDeviceNoticeShown
    }

    /// Legacy persisted keys from before `modelOrder` existed — read only, never written.
    private enum LegacyKeys: String, CodingKey { case providerChain, fallbackChain }

    /// The legacy primary + ordered fallback pair folded into equivalent slots: the primary
    /// first, then each fallback engine once (the primary is skipped if it reappears). Slots
    /// carry an empty model so they keep following each engine's per-engine selected model —
    /// exactly what the legacy chain did at transcription time.
    private static func migratedOrder(primary: ProviderID,
                                      fallback: [ProviderID]) -> [ProviderSlot] {
        var order = [ProviderSlot(provider: primary)]
        for id in fallback where !order.contains(where: { $0.provider == id }) {
            order.append(ProviderSlot(provider: id))
        }
        return order
    }

    // Tolerant decoding — missing keys (older persisted settings, or future-added fields)
    // fall back to defaults instead of throwing, so a stored API key is never lost.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = WhisperioSettings()
        // Slot order: prefer the new shape; otherwise migrate the legacy primary+fallback
        // pair into equivalent slots. `try?` throughout so an unknown engine raw value (a
        // future build's provider) falls back instead of throwing the whole blob away.
        if let slots = (try? c.decodeIfPresent([ProviderSlot].self, forKey: .modelOrder)) ?? nil,
           !slots.isEmpty {
            modelOrder = slots
        } else {
            let legacy = try decoder.container(keyedBy: LegacyKeys.self)
            let primary = ((try? legacy.decodeIfPresent([ProviderID].self, forKey: .providerChain)) ?? nil)?
                .first ?? .onDevice
            let fallback = (try? legacy.decodeIfPresent([ProviderID].self, forKey: .fallbackChain)) ?? nil
                ?? Self.classicOrder
            modelOrder = Self.migratedOrder(primary: primary, fallback: fallback)
        }
        openAIKey = try c.decodeIfPresent(String.self, forKey: .openAIKey) ?? d.openAIKey
        openAIBaseURL = try c.decodeIfPresent(String.self, forKey: .openAIBaseURL) ?? d.openAIBaseURL
        whisperModel = try c.decodeIfPresent(String.self, forKey: .whisperModel) ?? d.whisperModel
        elevenLabsKey = try c.decodeIfPresent(String.self, forKey: .elevenLabsKey) ?? d.elevenLabsKey
        elevenLabsModel = try c.decodeIfPresent(String.self, forKey: .elevenLabsModel) ?? d.elevenLabsModel
        groqKey = try c.decodeIfPresent(String.self, forKey: .groqKey) ?? d.groqKey
        groqModel = try c.decodeIfPresent(String.self, forKey: .groqModel) ?? d.groqModel
        deepgramKey = try c.decodeIfPresent(String.self, forKey: .deepgramKey) ?? d.deepgramKey
        deepgramModel = try c.decodeIfPresent(String.self, forKey: .deepgramModel) ?? d.deepgramModel
        assemblyAIKey = try c.decodeIfPresent(String.self, forKey: .assemblyAIKey) ?? d.assemblyAIKey
        assemblyAIModel = try c.decodeIfPresent(String.self, forKey: .assemblyAIModel) ?? d.assemblyAIModel
        mistralKey = try c.decodeIfPresent(String.self, forKey: .mistralKey) ?? d.mistralKey
        mistralModel = try c.decodeIfPresent(String.self, forKey: .mistralModel) ?? d.mistralModel
        replicateKey = try c.decodeIfPresent(String.self, forKey: .replicateKey) ?? d.replicateKey
        replicateModel = try c.decodeIfPresent(String.self, forKey: .replicateModel) ?? d.replicateModel
        selfHostedURL = try c.decodeIfPresent(String.self, forKey: .selfHostedURL) ?? d.selfHostedURL
        selfHostedKey = try c.decodeIfPresent(String.self, forKey: .selfHostedKey) ?? d.selfHostedKey
        selfHostedModel = try c.decodeIfPresent(String.self, forKey: .selfHostedModel) ?? d.selfHostedModel
        localWhisperModel = try c.decodeIfPresent(String.self, forKey: .localWhisperModel) ?? d.localWhisperModel
        chatModel = try c.decodeIfPresent(String.self, forKey: .chatModel) ?? d.chatModel
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? d.language
        preferredLanguages = try c.decodeIfPresent([String].self, forKey: .preferredLanguages) ?? d.preferredLanguages
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
        // Same unknown-raw-value tolerance as syncMode below: `try?` swallows both "missing" and
        // "unrecognized" (a future build's mode) instead of throwing the whole blob away.
        digestSourceMode = (try? c.decodeIfPresent(DigestSourceMode.self, forKey: .digestSourceMode)) ?? d.digestSourceMode
        autoCategorize = try c.decodeIfPresent(Bool.self, forKey: .autoCategorize) ?? d.autoCategorize
        customCategories = try c.decodeIfPresent([CustomCategory].self, forKey: .customCategories) ?? d.customCategories
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
        autoDeleteEnabled = try c.decodeIfPresent(Bool.self, forKey: .autoDeleteEnabled) ?? d.autoDeleteEnabled
        let decodedDays = try c.decodeIfPresent(Int.self, forKey: .autoDeleteAfterDays) ?? d.autoDeleteAfterDays
        autoDeleteAfterDays = decodedDays > 0 ? decodedDays : d.autoDeleteAfterDays
        keepAudioRecordings = try c.decodeIfPresent(Bool.self, forKey: .keepAudioRecordings) ?? d.keepAudioRecordings
        oldDeviceNoticeShown = try c.decodeIfPresent(Bool.self, forKey: .oldDeviceNoticeShown) ?? d.oldDeviceNoticeShown
    }

    /// Whether the given engine requires (and currently has) cloud consent to run. Both
    /// `.onDevice` (Apple Speech) and `.localWhisper` (WhisperKit CoreML) are on-device engines —
    /// audio never leaves the device for either — so neither ever triggers the cloud-consent gate.
    public func isCloud(_ id: ProviderID) -> Bool { id != .onDevice && id != .localWhisper }

    // MARK: - Model order accessors

    /// The engine that actually transcribes — slot 0 of the model order.
    public var primaryProvider: ProviderID { modelOrder.first?.provider ?? .onDevice }

    /// Compatibility view of the slot order as a plain provider list (slot 0 = primary).
    /// Setting it keeps the semantics old call sites relied on (`s.providerChain = [id]`
    /// picked the engine): the first element becomes the primary via `setPrimaryProvider`.
    public var providerChain: [ProviderID] {
        get { modelOrder.map(\.provider) }
        set { setPrimaryProvider(newValue.first ?? .onDevice) }
    }

    /// Compatibility view of the ordered fallbacks — every slot's provider after slot 0.
    public var fallbackChain: [ProviderID] { Array(modelOrder.dropFirst().map(\.provider)) }

    /// Make `id` the primary engine (slot 0). Reuses the first existing slot for that
    /// provider — moving it to the front keeps its pinned model — or inserts a fresh slot
    /// that follows the engine's selected model. Never drops the rest of the order.
    public mutating func setPrimaryProvider(_ id: ProviderID) {
        if let i = modelOrder.firstIndex(where: { $0.provider == id }) {
            let slot = modelOrder.remove(at: i)
            modelOrder.insert(slot, at: 0)
        } else {
            modelOrder.insert(ProviderSlot(provider: id), at: 0)
        }
    }

    /// The per-engine "selected model" — the default a modelless slot follows for this
    /// provider. `.onDevice` has no model setting and always returns empty; every cloud engine
    /// (including ElevenLabs, since `elevenLabsModel` was added) has one, though it may be
    /// empty to mean "the provider's own built-in default" (see each field's doc comment).
    public func selectedModel(for id: ProviderID) -> String {
        switch id {
        case .onDevice: return ""
        case .localWhisper: return localWhisperModel
        case .openAI: return whisperModel
        case .elevenLabs: return elevenLabsModel
        case .groq: return groqModel
        case .deepgram: return deepgramModel
        case .assemblyAI: return assemblyAIModel
        case .mistral: return mistralModel
        case .replicate: return replicateModel
        case .selfHosted: return selfHostedModel
        }
    }

    /// The model a slot actually runs with: its own model when pinned, otherwise the
    /// engine's per-engine selected model. The slot wins at transcription time.
    public func resolvedModel(for slot: ProviderSlot) -> String {
        slot.model.isEmpty ? selectedModel(for: slot.provider) : slot.model
    }

    /// Vocabulary parsed into trimmed, non-empty terms.
    public var vocabularyTerms: [String] {
        customVocabulary
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
