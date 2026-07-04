import Foundation

/// One turn in a chat-completion exchange. `role` matches the OpenAI-style wire values
/// ("system", "user", "assistant") so the app's concrete impl can pass it straight through.
public struct ChatMessage: Codable, Sendable {
    public let role: String
    public let content: String

    public init(role: String, content: String) {
        self.role = role
        self.content = content
    }
}

/// The shared text-LLM contract used by rewrite (render presets) and journaling. The kit
/// stays Foundation-only and networking-free — the app target provides the concrete
/// URLSession-backed implementation (dedicated session, real timeouts, Bearer auth).
public protocol ChatLLM: Sendable {
    /// Whether the engine can run right now (key present, endpoint reachable-in-principle…).
    var isConfigured: Bool { get }
    /// Run a chat completion. Throw on any failure so callers can surface/fallback.
    func complete(messages: [ChatMessage], model: String, temperature: Double) async throws -> String
}
