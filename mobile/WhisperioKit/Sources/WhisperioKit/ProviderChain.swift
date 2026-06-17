import Foundation

/// Ordered transcription engines tried in sequence, falling back on failure — a direct
/// port of the desktop `transcribeAudio` logic:
///   1. Try each configured provider in priority order.
///   2. On failure, remember the first error and move to the next.
///   3. If none are configured, still attempt the first one so the user gets a real error.
///   4. If all fail, surface the first error.
public struct ProviderChain: Sendable {
    /// Providers in priority order (index 0 = primary).
    public let providers: [any TranscriptionProvider]
    /// Called when one provider fails and the next is about to be tried (failed, next).
    public let onFallback: (@Sendable (ProviderID, ProviderID) -> Void)?

    public init(
        providers: [any TranscriptionProvider],
        onFallback: (@Sendable (ProviderID, ProviderID) -> Void)? = nil
    ) {
        self.providers = providers
        self.onFallback = onFallback
    }

    public func transcribe(_ clip: AudioClip) async -> Result<Transcript, TranscriptionError> {
        // Prefer configured providers; if none are configured, keep the first so it can
        // throw a descriptive error rather than silently doing nothing.
        var effective = providers.filter { $0.isConfigured }
        if effective.isEmpty {
            guard let first = providers.first else {
                return .failure(.noProvidersConfigured)
            }
            effective = [first]
        }

        var firstError: String?
        for (index, provider) in effective.enumerated() {
            do {
                let text = try await provider.transcribe(clip)
                return .success(Transcript(text: text, provider: provider.id))
            } catch {
                if firstError == nil { firstError = error.localizedDescription }
                if index < effective.count - 1 {
                    onFallback?(provider.id, effective[index + 1].id)
                }
            }
        }

        return .failure(.allProvidersFailed(firstError: firstError ?? "Unknown error"))
    }
}
