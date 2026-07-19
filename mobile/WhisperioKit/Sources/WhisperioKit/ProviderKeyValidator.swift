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
}

/// Verifies a pasted API key against the provider's own API with a cheap, side-effect-free,
/// authenticated GET — the real check that "reuse the existing connection logic" was missing
/// (SettingsView's Connections rows only ever checked "key text is non-empty"). Only
/// OpenAI/ElevenLabs/Deepgram are wired into the onboarding provider sheet today, but every
/// provider is implemented here so Settings (or a future step) can adopt the same validator.
public enum ProviderKeyValidator {
    public static func validate(_ id: ProviderID, key: String) async -> Result<Void, ProviderKeyValidationError> {
        // On-device needs no key and no network — always valid.
        guard id != .onDevice else { return .success(()) }

        guard let request = request(for: id, key: key) else {
            return .failure(.unexpected(0))
        }

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
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
        }
        req.httpMethod = "GET"
        req.timeoutInterval = 15
        return req
    }
}
