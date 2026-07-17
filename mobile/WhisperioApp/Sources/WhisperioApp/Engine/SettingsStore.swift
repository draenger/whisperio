import Foundation
import Combine
import WhisperioKit

// Persisted user settings (provider chain + keys), mirroring the desktop settings.
// Stored in UserDefaults as JSON so it survives relaunches.
@MainActor
final class SettingsStore: ObservableObject {
    @Published var settings: WhisperioSettings { didSet { save() } }
    @Published var didCompleteSetup: Bool {
        didSet { UserDefaults.standard.set(didCompleteSetup, forKey: Self.setupKey) }
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

        // API secrets live in the Keychain, not in the UserDefaults blob. Prefer the Keychain
        // copy; fall back to any legacy plaintext key still embedded in the blob (pre-Keychain
        // installs) so a stored key is never lost across the upgrade.
        let legacyOpenAI = loaded.openAIKey
        let legacyEleven = loaded.elevenLabsKey
        let legacyGitHub = loaded.githubToken
        loaded.openAIKey = Keychain.get(.openAIKey) ?? legacyOpenAI
        loaded.elevenLabsKey = Keychain.get(.elevenLabsKey) ?? legacyEleven
        loaded.githubToken = Keychain.get(.githubToken) ?? legacyGitHub
        settings = loaded

        // Migrate + scrub: if the persisted blob carried a plaintext secret, move it into the
        // Keychain and rewrite the blob without it. (Property observers don't fire in init,
        // so call save() explicitly.)
        if !legacyOpenAI.isEmpty || !legacyEleven.isEmpty || !legacyGitHub.isEmpty {
            save()
        }
    }

    private func save() {
        // Secrets go to the Keychain only; everything else is persisted to UserDefaults with
        // the key fields blanked so no API secret is ever written in plaintext.
        Keychain.set(settings.openAIKey, for: .openAIKey)
        Keychain.set(settings.elevenLabsKey, for: .elevenLabsKey)
        Keychain.set(settings.githubToken, for: .githubToken)
        var sanitized = settings
        sanitized.openAIKey = ""
        sanitized.elevenLabsKey = ""
        sanitized.githubToken = ""
        if let data = try? JSONEncoder().encode(sanitized) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    // Build the live provider chain. The primary engine first; if fallback is on,
    // the other engines follow (unconfigured ones are skipped by ProviderChain).
    func makeChain() -> ProviderChain {
        let s = settings
        let primary = s.providerChain.first ?? .onDevice
        var order: [ProviderID] = [primary]
        if s.fallbackEnabled {
            for id in [ProviderID.onDevice, .openAI, .elevenLabs] where id != primary {
                order.append(id)
            }
        }
        // Cloud engines stay disabled until the user has granted explicit consent — even
        // as a fallback. On-device (Apple Speech) never needs consent.
        if !s.cloudConsentGranted {
            order.removeAll { s.isCloud($0) }
            if order.isEmpty { order = [.onDevice] }
        }
        return ProviderChain(providers: order.map { provider(for: $0, s) })
    }

    // Build the diarizing transcriber for Conversation mode (ElevenLabs Scribe v2 with
    // diarize=true — the only configured engine that separates speakers). Gated the same way
    // makeChain() gates cloud STT: nil until the user granted cloud consent AND pasted an
    // ElevenLabs key, so callers surface the setup state instead of failing silently.
    func makeConversationTranscriber() -> ElevenLabsProvider? {
        let s = settings
        guard s.cloudConsentGranted,
              !s.elevenLabsKey.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return ElevenLabsProvider(apiKey: s.elevenLabsKey,
                                  languageCode: s.language, keyterms: s.vocabularyTerms)
    }

    // Build the text-LLM client for rewrite (render presets) + journaling. Gated the same
    // way makeChain() gates cloud STT: the client only reports isConfigured when the user has
    // granted cloud consent AND pasted an OpenAI key — otherwise callers see an unconfigured
    // client (empty key) and skip/surface accordingly.
    func makeChatClient() -> ChatLLM {
        let s = settings
        let ready = s.cloudConsentGranted && !s.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty
        return OpenAIChatClient(apiKey: ready ? s.openAIKey : "", baseURL: s.openAIBaseURL)
    }

    // Build the runner that applies a rewrite (render) preset to a transcript. Wraps the shared
    // chat client — so it inherits the same cloud-consent + key gate via `isConfigured` — with
    // the user's configured chat model. Callers guard on `isConfigured` and surface the consent
    // sheet / Settings rather than failing silently.
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

    private func provider(for id: ProviderID, _ s: WhisperioSettings) -> any TranscriptionProvider {
        switch id {
        case .onDevice:
            return AppleSpeechProvider(language: s.language, vocabulary: s.vocabularyTerms,
                                       requireOnDevice: !s.appleAllowOnline)
        case .openAI:
            return OpenAIProvider(apiKey: s.openAIKey, baseURL: s.openAIBaseURL,
                                  model: s.whisperModel, language: s.language,
                                  prompt: s.customVocabulary)
        case .elevenLabs:
            return ElevenLabsProvider(apiKey: s.elevenLabsKey,
                                      languageCode: s.language, keyterms: s.vocabularyTerms)
        }
    }

    // Tidy a transcript when cleanup is enabled (deterministic, works on every device).
    func cleanup(_ text: String) -> String {
        settings.cleanupEnabled ? TextCleaner.tidy(text) : text
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
