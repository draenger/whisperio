import Testing
@testable import WhisperioKit

// Only the paths that never touch the network are covered here (this suite must stay offline):
// on-device engines short-circuit before any request is built, and `.selfHosted` validates a
// server URL locally (see R4) rather than calling a vendor API. The real cloud engines
// (OpenAI/ElevenLabs/Groq/Deepgram/AssemblyAI/Mistral/Replicate) all require a live authenticated
// HTTP round-trip and are intentionally left to manual/integration verification, same as before
// this file existed.
@Suite struct ProviderKeyValidatorTests {
    @Test func onDeviceAndLocalWhisperNeedNoKeyOrNetwork() async {
        let onDevice = await ProviderKeyValidator.validate(.onDevice, key: "")
        let local = await ProviderKeyValidator.validate(.localWhisper, key: "")
        guard case .success = onDevice else { Issue.record("expected success for .onDevice"); return }
        guard case .success = local else { Issue.record("expected success for .localWhisper"); return }
    }

    @Test func selfHostedRejectsAnEmptyURL() async {
        let result = await ProviderKeyValidator.validate(.selfHosted, key: "")
        guard case .failure = result else { Issue.record("expected failure for an empty URL"); return }
    }

    @Test func selfHostedRejectsAWhitespaceOnlyURL() async {
        let result = await ProviderKeyValidator.validate(.selfHosted, key: "   ")
        guard case .failure = result else { Issue.record("expected failure for a whitespace-only URL"); return }
    }

    @Test func selfHostedAcceptsAFullyQualifiedURL() async {
        let result = await ProviderKeyValidator.validate(.selfHosted, key: "http://192.168.1.5:5000")
        guard case .success = result else { Issue.record("expected success for a well-formed URL"); return }
    }

    @Test func selfHostedAcceptsABareHostDefaultingToHTTP() async {
        // Matches SelfHostedProvider's own tolerant parsing — "host:port" with no scheme.
        let result = await ProviderKeyValidator.validate(.selfHosted, key: "localhost:8000")
        guard case .success = result else { Issue.record("expected success for a bare host:port"); return }
    }
}
