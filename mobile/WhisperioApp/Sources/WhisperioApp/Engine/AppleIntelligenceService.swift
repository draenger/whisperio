import Foundation
import WhisperioKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// Real, honest wrapper around Apple's on-device FoundationModels framework (Apple
// Intelligence) — no fabricated states. The framework itself only ships in iOS/macOS 26+
// SDKs, and even when the SDK has it, a given device/user may still not have the model
// available (not eligible, not enabled, or still downloading). Every call site therefore
// needs BOTH `#if canImport(FoundationModels)` (compile-time: does this SDK build even know
// the framework exists) and `if #available(iOS 26.0, macOS 26.0, *)` (run-time: is the API
// actually callable on the OS this binary is running on) — the app's deployment target
// (iOS 17 / macOS 14) does not change.
enum AppleIntelligenceService {
    #if canImport(FoundationModels)
    /// Direct passthrough of `SystemLanguageModel.default.availability` — ModelsView's Apple
    /// Intelligence row switches on this, never a hardcoded "ready"/"active" state.
    @available(iOS 26.0, macOS 26.0, *)
    static var availability: SystemLanguageModel.Availability {
        SystemLanguageModel.default.availability
    }

    /// Whether the on-device model can actually serve a request right now.
    @available(iOS 26.0, macOS 26.0, *)
    static var isAvailable: Bool {
        if case .available = availability { return true }
        return false
    }
    #endif

    /// SDK/OS-agnostic convenience for callers (like `SettingsStore.makeChatClient()`) that just
    /// need a plain Bool and don't want to repeat the `#if`/`if #available` pair themselves.
    /// Always `false` on a pre-26 SDK build or a pre-26 OS at runtime — never guesses.
    static var isAvailableNow: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            return isAvailable
        }
        #endif
        return false
    }
}

#if canImport(FoundationModels)
/// `ChatLLM` conformance backed by Apple Intelligence's on-device `LanguageModelSession` —
/// serves rewrite (render presets), digest classification, and digest summarization entirely
/// on-device, with zero API key and zero network round-trip. See `ChatLLM.swift` for the seam
/// this fills alongside `OpenAIChatClient`.
@available(iOS 26.0, macOS 26.0, *)
struct AppleIntelligenceChatClient: ChatLLM {
    /// Configured exactly when the on-device model is actually available right now — mirrors
    /// `OpenAIChatClient.isConfigured`'s "can this really run" contract (no key to check here;
    /// the model's real availability state is the equivalent gate).
    var isConfigured: Bool { AppleIntelligenceService.isAvailable }

    /// `model`/`temperature` come from the same `ChatLLM` contract every other client honors:
    /// `model` is unused (Apple Intelligence has exactly one on-device model, no id to pick);
    /// `temperature` maps onto `GenerationOptions.temperature`. The last "system"-role message
    /// becomes the session's instructions (the model's persona/task framing); every remaining
    /// turn is joined into one prompt string — `LanguageModelSession` doesn't expose a raw
    /// multi-turn transcript API these single-shot classify/summarize/rewrite calls could use.
    func complete(messages: [ChatMessage], model: String, temperature: Double) async throws -> String {
        guard isConfigured else {
            throw Self.err("Apple Intelligence isn't available on this device right now.")
        }
        let instructions = messages.last { $0.role == "system" }?.content
        let prompt = messages
            .filter { $0.role != "system" }
            .map(\.content)
            .joined(separator: "\n\n")
        guard !prompt.isEmpty else {
            throw Self.err("Nothing to send to Apple Intelligence.")
        }
        let session = LanguageModelSession(instructions: instructions)
        let options = GenerationOptions(temperature: temperature)
        do {
            let response = try await session.respond(to: prompt, options: options)
            return response.content
        } catch {
            throw Self.err("Apple Intelligence couldn't complete that request: \(error.localizedDescription)")
        }
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.AppleIntelligence", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
#endif
