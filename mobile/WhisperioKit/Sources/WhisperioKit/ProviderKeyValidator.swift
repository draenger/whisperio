import Foundation

/// Why a provider key failed to verify — surfaced to the UI so onboarding/Settings can show
/// a real, legible reason instead of a generic failure.
public enum ProviderKeyValidationError: Error, Sendable, Equatable {
    /// The provider rejected the key (401/403).
    case invalidKey
    /// The request never completed (offline, timeout, DNS, TLS, …) — carries the underlying
    /// error's description for display.
    case network(String)
    /// The provider responded, but not with success or an auth failure — carries the status code.
    case unexpected(Int)
    /// A self-hosted server URL violating `BaseURLPolicy` (e.g. plain http to a public host).
    case invalidURL(String)
}

/// Verifies a pasted API key against the provider's own API with a cheap, side-effect-free,
/// authenticated GET — the real check that "reuse the existing connection logic" was missing
/// (SettingsView's Connections rows only ever checked "key text is non-empty"). Only
/// OpenAI/ElevenLabs/Deepgram are wired into the onboarding provider sheet today, but every
/// provider is implemented here so Settings (or a future step) can adopt the same validator.
public enum ProviderKeyValidator {
    /// Probe session: real timeouts, and no redirect-following (the key rides in the headers).
    static let validationSession = NoRedirectSessionDelegate.makeSession(requestTimeout: 30, resourceTimeout: 30)

    public static func validate(_ id: ProviderID, key: String) async -> Result<Void, ProviderKeyValidationError> {
        // On-device engines need no key and no network — always valid.
        guard id != .onDevice, id != .localWhisper else { return .success(()) }

        // Self-hosted has no vendor to authenticate against — "the key" here is the server URL
        // (see SelfHostedProvider), so the only honest check is that it actually parses as a
        // reachable address. The status text UI already covers whether the server responds.
        if id == .selfHosted { return validateSelfHostedURL(key) }

        guard let request = request(for: id, key: key) else {
            return .failure(.unexpected(0))
        }

        do {
            let (_, response) = try await Self.validationSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failure(.unexpected(0)) }
            switch http.statusCode {
            case 200...299: return .success(())
            case 401, 403: return .failure(.invalidKey)
            default: return .failure(.unexpected(http.statusCode))
            }
        } catch {
            return .failure(.network(error.localizedDescription))
        }
    }

    private static func request(for id: ProviderID, key: String) -> URLRequest? {
        var req: URLRequest
        switch id {
        case .onDevice:
            return nil
        case .localWhisper:
            return nil
        case .openAI:
            guard let url = URL(string: "https://api.openai.com/v1/models") else { return nil }
            req = URLRequest(url: url)
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        case .elevenLabs:
            guard let url = URL(string: "https://api.elevenlabs.io/v1/user") else { return nil }
            req = URLRequest(url: url)
            req.setValue(key, forHTTPHeaderField: "xi-api-key")
        case .deepgram:
            guard let url = URL(string: "https://api.deepgram.com/v1/projects") else { return nil }
            req = URLRequest(url: url)
            req.setValue("Token \(key)", forHTTPHeaderField: "Authorization")
        case .groq:
            guard let url = URL(string: "https://api.groq.com/openai/v1/models") else { return nil }
            req = URLRequest(url: url)
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        case .assemblyAI:
            guard let url = URL(string: "https://api.assemblyai.com/v2/transcript?limit=1") else { return nil }
            req = URLRequest(url: url)
            // Raw key, no "Bearer" prefix — matches AssemblyAIProvider's existing header casing.
            req.setValue(key, forHTTPHeaderField: "authorization")
        case .mistral:
            guard let url = URL(string: "https://api.mistral.ai/v1/models") else { return nil }
            req = URLRequest(url: url)
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        case .replicate:
            guard let url = URL(string: "https://api.replicate.com/v1/account") else { return nil }
            req = URLRequest(url: url)
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        case .selfHosted:
            // Handled entirely in `validate(_:key:)` before this is ever reached — no HTTP
            // request to build. Kept here only so the switch stays exhaustive.
            return nil
        }
        req.httpMethod = "GET"
        req.timeoutInterval = 15
        return req
    }

    /// A self-hosted server URL "validates" iff it parses to a reachable address (a scheme
    /// implied or explicit, and a host) — there's no vendor account to authenticate against, so
    /// this is the whole honest check. Accepts a bare host ("localhost:8000") the same way
    /// `SelfHostedProvider` does, defaulting to `http://`.
    private static func validateSelfHostedURL(_ raw: String) -> Result<Void, ProviderKeyValidationError> {
        // Same rule as the request path: https, or http only for loopback/private hosts.
        switch BaseURLPolicy.validate(raw, assumeHTTPForBareHost: true) {
        case .success: return .success(())
        case .failure(.empty): return .failure(.unexpected(0))
        case .failure(let e): return .failure(.invalidURL(e.localizedDescription))
        }
    }
}
