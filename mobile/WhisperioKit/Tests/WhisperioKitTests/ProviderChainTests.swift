import Testing
import Foundation
@testable import WhisperioKit

private struct MockError: Error {}

/// Configurable test double: succeeds with `text` or throws, and reports `isConfigured`.
private struct MockProvider: TranscriptionProvider {
    let id: ProviderID
    let isConfigured: Bool
    let outcome: Result<String, MockError>

    func transcribe(_ clip: AudioClip) async throws -> String {
        switch outcome {
        case .success(let text): return text
        case .failure(let err): throw err
        }
    }
}

private let clip = AudioClip(data: Data(), filename: "a.wav", duration: 1)

@Suite struct ProviderChainTests {
    @Test func primarySucceeds() async {
        let chain = ProviderChain(providers: [
            MockProvider(id: .onDevice, isConfigured: true, outcome: .success("hello"))
        ])
        let result = await chain.transcribe(clip)
        #expect(result == .success(Transcript(text: "hello", provider: .onDevice)))
    }

    @Test func fallsBackToNextOnFailure() async {
        let chain = ProviderChain(providers: [
            MockProvider(id: .onDevice, isConfigured: true, outcome: .failure(MockError())),
            MockProvider(id: .openAI, isConfigured: true, outcome: .success("cloud"))
        ])
        let result = await chain.transcribe(clip)
        #expect(result == .success(Transcript(text: "cloud", provider: .openAI)))
    }

    @Test func skipsUnconfiguredProviders() async {
        let chain = ProviderChain(providers: [
            MockProvider(id: .onDevice, isConfigured: false, outcome: .success("never")),
            MockProvider(id: .elevenLabs, isConfigured: true, outcome: .success("eleven"))
        ])
        let result = await chain.transcribe(clip)
        #expect(result == .success(Transcript(text: "eleven", provider: .elevenLabs)))
    }

    @Test func allFailSurfacesFirstError() async {
        let chain = ProviderChain(providers: [
            MockProvider(id: .onDevice, isConfigured: true, outcome: .failure(MockError())),
            MockProvider(id: .openAI, isConfigured: true, outcome: .failure(MockError()))
        ])
        let result = await chain.transcribe(clip)
        guard case .failure(.allProvidersFailed) = result else {
            Issue.record("expected allProvidersFailed, got \(result)")
            return
        }
    }

    @Test func noProvidersConfiguredTriesFirstAnyway() async {
        // None configured → keep the first so it can throw a real error (here it succeeds,
        // proving the first provider is still attempted rather than silently skipped).
        let chain = ProviderChain(providers: [
            MockProvider(id: .openAI, isConfigured: false, outcome: .success("forced"))
        ])
        let result = await chain.transcribe(clip)
        #expect(result == .success(Transcript(text: "forced", provider: .openAI)))
    }

    @Test func emptyChainReportsNoProviders() async {
        let chain = ProviderChain(providers: [])
        let result = await chain.transcribe(clip)
        #expect(result == .failure(.noProvidersConfigured))
    }

    @Test func fallbackCallbackFiresWithFailedAndNext() async {
        final class Box: @unchecked Sendable { var pairs: [(ProviderID, ProviderID)] = [] }
        let box = Box()
        let chain = ProviderChain(
            providers: [
                MockProvider(id: .onDevice, isConfigured: true, outcome: .failure(MockError())),
                MockProvider(id: .openAI, isConfigured: true, outcome: .success("ok"))
            ],
            onFallback: { failed, next in box.pairs.append((failed, next)) }
        )
        _ = await chain.transcribe(clip)
        #expect(box.pairs.count == 1)
        #expect(box.pairs.first?.0 == .onDevice)
        #expect(box.pairs.first?.1 == .openAI)
    }
}
