import Foundation
import Combine
import WhisperioKit
#if canImport(UIKit)
import UIKit
#endif

// Persisted user settings (provider chain + keys), mirroring the desktop settings.
// Stored in UserDefaults as JSON so it survives relaunches.
@MainActor
final class SettingsStore: ObservableObject {
    @Published var settings: WhisperioSettings { didSet { save() } }
    @Published var didCompleteSetup: Bool {
        didSet { UserDefaults.standard.set(didCompleteSetup, forKey: Self.setupKey) }
    }

    /// Labels of secrets the Keychain refused to store on the last save. They live in memory only
    /// (forgotten on quit) and are never written to UserDefaults.
    @Published private(set) var keychainWriteFailures: Set<String> = []

    static let keychainFailureWarning = "Couldn't save the key to Keychain - it will be forgotten when the app quits."

    func isKeyUnsaved(_ value: String) -> Bool {
        settings.isUnsavedSecret(value, failed: keychainWriteFailures)
    }

    private static let key = "whisperio.settings.v1"
    private static let setupKey = "whisperio.setupDone.v1"

    init() {
        let d = UserDefaults.standard
        var loaded = WhisperioSettings()
        if let data = d.data(forKey: Self.key),
           let s = try? JSONDecoder().decode(WhisperioSettings.self, from: data) {
            loaded = s
        }
        didCompleteSetup = d.bool(forKey: Self.setupKey)

        // R1: one-shot repair for the build-62 onboarding regression (see
        // migrateBuild62PolishSeedRegression below for the full story).
        Self.migrateBuild62PolishSeedRegression(&loaded)

        // API secrets live in the Keychain, not in the UserDefaults blob. Prefer the Keychain
        // copy; a secret the Keychain does not have keeps the legacy plaintext value a pre-Keychain
        // build left in the blob, so nothing is lost across the upgrade. `WhisperioSettings.secretFields`
        // is the single list of secrets (openAI, elevenLabs, groq, deepgram, assemblyAI, mistral,
        // replicate, selfHosted, githubToken) — adding a key there is enough.
        let legacyPlaintext = loaded.plaintextSecretLabels
        loaded.hydrateSecrets(read: Keychain.get)
        settings = loaded

        // Migrate + scrub: if the persisted blob carried a plaintext secret, move it into the
        // Keychain and rewrite the blob without it. (Property observers don't fire in init,
        // so call save() explicitly.)
        if !legacyPlaintext.isEmpty {
            save()
        }
    }

    // R1: build 62 shipped an onboarding language step that seeded its chips (and, on
    // finish, the persisted `language`) with a hardcoded ["pl", "en"] instead of reading the
    // user's real keyboards — so anyone who breezed through that step without touching it
    // got silently stuck transcribing as Polish. One-shot, narrowly scoped repair: only
    // fires when BOTH `language` and `preferredLanguages` exactly match that shipped seed,
    // AND there's no independent evidence the user actually wanted Polish — a Polish
    // keyboard installed (iOS, the same UITextInputMode source the fixed onboarding step
    // itself now reads) or Polish among the system's preferred languages (macOS, which has
    // no keyboard-extension equivalent to check). A genuine Polish speaker who happens to
    // match the seed will, by definition, also carry one of those signals and is left alone.
    private static func migrateBuild62PolishSeedRegression(_ settings: inout WhisperioSettings) {
        guard settings.language == "pl", settings.preferredLanguages == ["pl", "en"] else { return }
        let hasRealPolishSignal: Bool
        #if canImport(UIKit) && os(iOS)
        hasRealPolishSignal = UITextInputMode.activeInputModes.contains { mode in
            guard let lang = mode.primaryLanguage else { return false }
            return Locale(identifier: lang).language.languageCode?.identifier.lowercased() == "pl"
        }
        #else
        hasRealPolishSignal = Locale.preferredLanguages.contains { raw in
            Locale(identifier: raw).language.languageCode?.identifier.lowercased() == "pl"
        }
        #endif
        guard !hasRealPolishSignal else { return }
        settings.language = "auto"
        settings.preferredLanguages = []
    }

    private func save() {
        // Keep the keyboard extension's privacy chip honest: it can't read the engine chain
        // itself, so the app records whether the primary engine is on-device via the shared
        // App Group on every settings write (a no-op until the group container exists).
        // Both on-device engines (Apple Speech and local WhisperKit) count — audio never
        // leaves the device for either.
        let primary = settings.providerChain.first ?? .onDevice
        SharedStore.setEngineOnDevice(primary == .onDevice || primary == .localWhisper)
        // Secrets go to the Keychain only; everything else is persisted to UserDefaults with
        // the key fields blanked so no API secret is ever written in plaintext.
        // If a Keychain write fails the key is kept in memory for this session only (fail closed,
        // like desktop): it is still scrubbed from UserDefaults and `keychainWriteFailures`
        // records it so Settings can warn. The next save retries the Keychain write.
        let failed = settings.persistSecretsReportingFailures { value, item in Keychain.set(value, for: item) }
        if failed != keychainWriteFailures { keychainWriteFailures = failed }
        let sanitized = settings.scrubbedOfSecrets()
        if let data = try? JSONEncoder().encode(sanitized) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    // Build the live provider chain from the ordered model slots. Slot 0 (the primary)
    // always runs; the rest follow in order only when "Fallback engines" is on. Each slot
    // instantiates its provider with the slot's model — falling back to the per-engine
    // selected model when the slot doesn't pin one (unconfigured engines are skipped by
    // ProviderChain).
    func makeChain(onFallback: (@Sendable (ProviderID, ProviderID) -> Void)? = nil) -> ProviderChain {
        let s = settings
        var slots = s.modelOrder
        if slots.isEmpty { slots = [ProviderSlot(provider: .onDevice)] }
        if !s.fallbackEnabled { slots = [slots[0]] }
        // Cloud engines stay disabled until the user has granted explicit consent — even
        // as a fallback. On-device (Apple Speech) never needs consent.
        if !s.cloudConsentGranted {
            slots.removeAll { s.isCloud($0.provider) }
            if slots.isEmpty { slots = [ProviderSlot(provider: .onDevice)] }
        }
        return ProviderChain(providers: slots.map { provider(for: $0, s) }, onFallback: onFallback)
    }

    // One-off single-engine chain for retranscribing saved audio with an explicitly chosen
    // engine. Same consent gate as makeChain(): cloud engines are refused (nil) until the
    // user has granted cloud consent.
    func makeSingleEngineChain(_ id: ProviderID) -> ProviderChain? {
        let s = settings
        if s.isCloud(id) && !s.cloudConsentGranted { return nil }
        return ProviderChain(providers: [provider(for: id, s)])
    }

    /// Whether the engine could actually run right now (consent + key for cloud ones) —
    /// drives the retranscribe menu's availability labels.
    func isEngineReady(_ id: ProviderID) -> Bool {
        let s = settings
        switch id {
        case .onDevice: return true
        case .localWhisper:
            // Real download-state gate — no key/consent to check, but a not-downloaded model
            // must fail the chain honestly rather than report a blanket "ready" like .onDevice.
            return LocalWhisperModelStore.isDownloaded(
                LocalWhisperModel(rawValue: s.localWhisperModel) ?? .base
            )
        case .openAI:
            return s.cloudConsentGranted && !s.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .elevenLabs:
            return s.cloudConsentGranted && !s.elevenLabsKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .groq:
            return s.cloudConsentGranted && !s.groqKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .deepgram:
            return s.cloudConsentGranted && !s.deepgramKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .assemblyAI:
            return s.cloudConsentGranted && !s.assemblyAIKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .mistral:
            return s.cloudConsentGranted && !s.mistralKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .replicate:
            return s.cloudConsentGranted && !s.replicateKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .selfHosted:
            // Same cloud-consent gate as every other remote engine (audio does leave the device,
            // even though it's the user's own server) — SettingsView.toggleConnection just skips
            // showing the confirmation sheet for this one, granting consent silently instead.
            return s.cloudConsentGranted && !s.selfHostedURL.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }

    // Engines that can diarize at all (architectural capability, independent of whether they're
    // currently configured) — the set Conversation mode's gating and the retranscribe menu's
    // "keeps speakers" labeling both key off of.
    private static let diarizingProviderIDs: [ProviderID] = [.elevenLabs, .openAI, .deepgram, .assemblyAI]

    /// Whether `id` names an engine capable of diarization at all (key/consent-independent) —
    /// drives which retranscribe options warn about losing speaker labels vs. which keep them.
    func isDiarizingEngine(_ id: ProviderID) -> Bool { Self.diarizingProviderIDs.contains(id) }

    /// Build the diarizing transcriber for Conversation mode: the first diarization-capable engine
    /// (ElevenLabs Scribe up to 32 speakers, OpenAI gpt-4o-transcribe-diarize up to 4, Deepgram
    /// Nova, or AssemblyAI Universal) that's actually configured, preferring the user's own
    /// model-order ranking among diarizing engines (so a chosen primary sticks), then falling
    /// back through the rest — so a user who's only set up Deepgram or AssemblyAI still gets real
    /// diarization instead of a dead end. Gated the same way makeChain()
    /// gates cloud STT: nil until cloud consent is granted, so callers surface the setup state
    /// instead of failing silently.
    func makeConversationTranscriber() -> (any DiarizingProvider)? {
        let s = settings
        guard s.cloudConsentGranted else { return nil }
        var order = s.modelOrder.map(\.provider).filter { Self.diarizingProviderIDs.contains($0) }
        for id in Self.diarizingProviderIDs where !order.contains(id) { order.append(id) }
        for id in order {
            if let candidate = provider(for: id, s) as? any DiarizingProvider, candidate.isConfigured {
                return candidate
            }
        }
        return nil
    }

    /// One-off diarizing transcriber for a specific engine the user explicitly picked (e.g. a
    /// retranscribe menu's "keeps speakers" option). Unlike makeConversationTranscriber() this
    /// never substitutes a different engine — it returns the requested one only if it's both
    /// diarization-capable and configured, so "retranscribe with X" can never silently run as Y.
    func makeDiarizingProvider(_ id: ProviderID) -> (any DiarizingProvider)? {
        let s = settings
        guard s.cloudConsentGranted, Self.diarizingProviderIDs.contains(id) else { return nil }
        guard let candidate = provider(for: id, s) as? any DiarizingProvider, candidate.isConfigured else { return nil }
        return candidate
    }

    /// Best-guess diarizing engine for Conversation-mode setup/consent copy, before consent is
    /// granted (so `makeConversationTranscriber()` can't run yet to tell us): whichever diarizing
    /// engine already has a key saved wins; ElevenLabs is the default when none do, preserving the
    /// original copy for a fresh install.
    var conversationEngineHint: ProviderID {
        let s = settings
        if !s.elevenLabsKey.trimmingCharacters(in: .whitespaces).isEmpty { return .elevenLabs }
        if !s.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty { return .openAI }
        if !s.deepgramKey.trimmingCharacters(in: .whitespaces).isEmpty { return .deepgram }
        if !s.assemblyAIKey.trimmingCharacters(in: .whitespaces).isEmpty { return .assemblyAI }
        return .elevenLabs
    }

    // Build the text-LLM client for rewrite (render presets) + journaling, honoring the
    // user's explicit Intelligence provider pick. `.auto` keeps the shipped resolution, now
    // with an on-device local model slotted in before the unconfigured dead end: configured
    // OpenAI stays preferred whenever it's actually keyed (an explicit pasted key is explicit
    // intent — zero behavior change for existing cloud users); when it isn't, Apple
    // Intelligence serves if its on-device model is available right now (no network call, no
    // consent gate — it never leaves the device); when that's unavailable too, a downloaded
    // local GGUF ("Intelligence") serves so a device without Apple Intelligence still gets
    // local rewrites/summaries/command-mode; only then does it settle on the honest
    // unconfigured-OpenAI path. An explicit pick pins that backend: `.openAI` always builds
    // the OpenAI client (unconfigured when consent/key is missing — callers already surface
    // that honestly); `.appleIntelligence` runs on-device when the runtime check passes;
    // `.localModel` runs the downloaded GGUF; each of the on-device picks falls back to the
    // same honest unconfigured-OpenAI path when its backend isn't ready (never crashes on an
    // older OS or a not-downloaded model, never silently substitutes the cloud the user opted
    // out of).
    func makeChatClient() -> ChatLLM {
        let s = settings
        let openAIReady = s.cloudConsentGranted && !s.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty

        // Explicit local-model pick: run the on-device GGUF only when it's actually downloaded;
        // otherwise fall through to the honest unconfigured path below (never the keyed cloud the
        // user didn't pick, never a crash on a not-downloaded model).
        if s.intelligenceProvider == .localModel,
           LocalLLMModelManager.shared.isDownloaded(s.localLLMModel) {
            return LocalLLMChatClient(modelID: s.localLLMModel)
        }

        let wantsAppleIntelligence = s.intelligenceProvider == .appleIntelligence
            || (s.intelligenceProvider == .auto && !openAIReady)
        if wantsAppleIntelligence {
            #if canImport(FoundationModels)
            if #available(iOS 26.0, macOS 26.0, *), AppleIntelligenceService.isAvailable {
                return AppleIntelligenceChatClient()
            }
            #endif
        }

        // `.auto` last on-device rung, reached only when no OpenAI key is configured and Apple
        // Intelligence isn't available: a downloaded local model beats the unconfigured-OpenAI
        // dead end. (Guarded on !openAIReady so a configured key still wins first.)
        if s.intelligenceProvider == .auto, !openAIReady,
           LocalLLMModelManager.shared.isDownloaded(s.localLLMModel) {
            return LocalLLMChatClient(modelID: s.localLLMModel)
        }

        // A pinned-but-unavailable Apple Intelligence or local-model pick must stay unconfigured —
        // never silently swap to the keyed cloud client the user explicitly opted out of. Only
        // `.auto` (with a configured key) and an explicit `.openAI` pick carry the real key.
        let usesKeyedOpenAI = openAIReady
            && s.intelligenceProvider != .appleIntelligence
            && s.intelligenceProvider != .localModel
        let key = usesKeyedOpenAI ? s.openAIKey : ""
        return OpenAIChatClient(apiKey: key, baseURL: s.openAIBaseURL)
    }

    // Build the runner that applies a rewrite (render) preset to a transcript. Wraps the shared
    // chat client — so it inherits the same cloud-consent + key gate via `isConfigured` — with
    // the user's configured chat model. Callers guard on `isConfigured` and surface the consent
    // sheet / Settings rather than failing silently.
    // Display name of the engine `makeChatClient()` currently resolves to, for the AI-generated
    // notice. Nil when unknown. No persistence: reflects the current configuration.
    var chatEngineName: String? {
        let client = makeChatClient()
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *), client is AppleIntelligenceChatClient {
            return "Apple Intelligence"
        }
        #endif
        if client is LocalLLMChatClient { return "on-device model" }
        if client is OpenAIChatClient { return "OpenAI" }
        return nil
    }

    func makeRewriter() -> Rewriter {
        Rewriter(client: makeChatClient(), model: settings.chatModel)
    }

    // Build the GitHub sync client from the token (Keychain-backed) + repo config. Returns nil when
    // the token, owner, or repo is missing — so callers keep the "Sync now" action disabled and
    // never fire an unconfigured request. Mirrors the house HTTP style: the client owns a dedicated
    // ephemeral URLSession with real timeouts + Bearer auth (see `GitHubURLSessionTransport`).
    func makeGitHubSync() -> GitHubClient? {
        let s = settings
        let token = s.githubToken.trimmingCharacters(in: .whitespaces)
        let owner = s.githubOwner.trimmingCharacters(in: .whitespaces)
        let repo = s.githubRepo.trimmingCharacters(in: .whitespaces)
        guard !token.isEmpty, !owner.isEmpty, !repo.isEmpty else { return nil }
        let branch = s.githubBranch.trimmingCharacters(in: .whitespaces)
        return GitHubClient(owner: owner, repo: repo,
                            branch: branch.isEmpty ? "main" : branch,
                            transport: GitHubURLSessionTransport(token: token))
    }

    // A single-engine build (retranscribe menu, single-engine chains) runs with the
    // engine's per-engine selected model — same as a modelless slot.
    private func provider(for id: ProviderID, _ s: WhisperioSettings) -> any TranscriptionProvider {
        provider(for: ProviderSlot(provider: id), s)
    }

    // Instantiate a slot's provider honoring the slot's model: the slot's pinned model wins;
    // an empty one resolves to the per-engine selected model (see resolvedModel(for:)).
    private func provider(for slot: ProviderSlot, _ s: WhisperioSettings) -> any TranscriptionProvider {
        let model = s.resolvedModel(for: slot)
        switch slot.provider {
        case .onDevice:
            return AppleSpeechProvider(language: s.language, vocabulary: s.vocabularyTerms,
                                       requireOnDevice: !s.appleAllowOnline)
        case .localWhisper:
            return LocalWhisperProvider(modelRawValue: model)
        case .openAI:
            return OpenAIProvider(apiKey: s.openAIKey, baseURL: s.openAIBaseURL,
                                  model: model, language: s.language,
                                  prompt: s.customVocabulary)
        case .elevenLabs:
            return ElevenLabsProvider(apiKey: s.elevenLabsKey,
                                      languageCode: s.language, keyterms: s.vocabularyTerms,
                                      model: model)
        case .groq:
            return GroqProvider(apiKey: s.groqKey, model: model,
                                language: s.language, prompt: s.customVocabulary)
        case .deepgram:
            return DeepgramProvider(apiKey: s.deepgramKey, model: model,
                                    language: s.language)
        case .assemblyAI:
            return AssemblyAIProvider(apiKey: s.assemblyAIKey, model: model,
                                      language: s.language)
        case .mistral:
            return MistralProvider(apiKey: s.mistralKey, model: model,
                                   language: s.language)
        case .replicate:
            return ReplicateProvider(apiKey: s.replicateKey, model: model)
        case .selfHosted:
            return SelfHostedProvider(baseURL: s.selfHostedURL, apiKey: s.selfHostedKey,
                                      model: model, language: s.language)
        }
    }

    // Tidy a transcript when cleanup is enabled (deterministic, works on every device).
    func cleanup(_ text: String) -> String {
        settings.cleanupEnabled ? TextCleaner.tidy(text) : text
    }
}

// Real key verification before anything is persisted — used by onboarding's provider sheet.
// Unlike SettingsView's Connections rows (which treat "key text is non-empty" as "Connected"),
// this actually calls the provider's API before writing anything.
extension SettingsStore {
    /// Verify `key` against `id`'s API and, only on success, persist it as the primary provider.
    /// Nothing is written on failure — the caller surfaces the validator's error instead.
    func connectProvider(_ id: ProviderID, key: String) async -> Result<Void, ProviderKeyValidationError> {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        let result = await ProviderKeyValidator.validate(id, key: trimmed)
        guard case .success = result else { return result }

        var s = settings
        switch id {
        case .onDevice: break
        // No API key for a local model — model selection happens only via ModelsView's
        // Get/Use flow, never this onboarding key-paste path.
        case .localWhisper: break
        case .openAI: s.openAIKey = trimmed
        case .elevenLabs: s.elevenLabsKey = trimmed
        case .groq: s.groqKey = trimmed
        case .deepgram: s.deepgramKey = trimmed
        case .assemblyAI: s.assemblyAIKey = trimmed
        case .mistral: s.mistralKey = trimmed
        case .replicate: s.replicateKey = trimmed
        // Self-hosted has no API-key concept — the pasted string here is the server URL itself
        // (ProviderKeyValidator.validate(.selfHosted, key:) checks it parses as a URL, mirroring
        // every other provider's "validate then persist" contract without inventing a fake key).
        case .selfHosted: s.selfHostedURL = trimmed
        }
        s.cloudConsentGranted = true
        s.setPrimaryProvider(id)
        settings = s
        return result
    }
}

// Runs a rewrite preset against a transcript through the shared chat client. `isConfigured`
// mirrors the client's gate (cloud consent granted + OpenAI key present) so a caller can guard
// and route to consent/Settings instead of firing an unconfigured request. Temperature is pinned
// to 0 for stable, deterministic rewrites (ported from the desktop post-processing shape).
struct Rewriter {
    let client: ChatLLM
    let model: String

    var isConfigured: Bool { client.isConfigured }

    /// Apply `preset` to `transcript`, returning the trimmed rewritten text. Throws on an empty
    /// transcript (nothing to rewrite) or any client failure so the caller can surface it.
    func run(preset: RewritePreset, transcript: String) async throws -> String {
        let m = RewritePromptBuilder.messages(preset: preset, transcript: transcript)
        guard !m.user.isEmpty else { throw Self.err("There's nothing to rewrite.") }
        let messages = [ChatMessage(role: "system", content: m.system),
                        ChatMessage(role: "user", content: m.user)]
        let out = try await client.complete(messages: messages, model: model, temperature: 0)
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.Rewriter", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
