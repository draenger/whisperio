import Foundation
import WhisperioKit

// Cloud text-LLM via OpenAI's chat/completions endpoint (BYO key). Ports the desktop
// post-processing shape (see desktop/src/main/transcribe.ts) — rewrite (render presets)
// and journaling both drive their prompts through this one client.
struct OpenAIChatClient: ChatLLM {
    let apiKey: String
    let baseURL: String

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    func complete(messages: [ChatMessage], model: String, temperature: Double) async throws -> String {
        let trimmedBase = baseURL.trimmingCharacters(in: .whitespaces)
        let base = trimmedBase.isEmpty ? "https://api.openai.com/v1" : trimmedBase
        guard let url = URL(string: base + "/chat/completions") else {
            throw Self.err("Invalid OpenAI base URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        struct Body: Encodable {
            let model: String
            let temperature: Double
            let messages: [ChatMessage]
        }
        req.httpBody = try JSONEncoder().encode(
            Body(model: model.isEmpty ? "gpt-4o-mini" : model,
                 temperature: temperature, messages: messages))

        let (data, resp) = try await Self.chatSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from OpenAI.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("OpenAI error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        struct R: Decodable {
            struct Choice: Decodable { struct Message: Decodable { let content: String }; let message: Message }
            let choices: [Choice]
        }
        guard let content = try JSONDecoder().decode(R.self, from: data).choices.first?.message.content else {
            throw Self.err("OpenAI returned no completion.")
        }
        return content
    }

    // Dedicated session for chat completions: mirror the desktop 45s timeout+abort guard so a
    // hung chat endpoint (slow proxy / custom baseUrl) can't leave a rewrite/journal call stuck.
    static let chatSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 45     // idle timeout between bytes
        config.timeoutIntervalForResource = 45    // hard cap for the whole request+response
        return URLSession(configuration: config)
    }()

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.OpenAIChat", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}

// MARK: - Journaling convenience (classify + summarize)
// Both flows batch a whole day into one round-trip through complete(...) + the Kit DigestPrompt
// builders, so they live on ChatLLM (any client from makeChatClient() drives the daily digest).
// Temperature is pinned to 0 for stable, deterministic output (same as Rewriter).
extension ChatLLM {
    /// Classify a day's notes into category ids in one batched call. Returns a map of note id →
    /// category id, keyed only by notes the model returned with a *known* category. On any parse
    /// failure (or an unknown/"uncategorized" value) the note is dropped from the map so callers
    /// leave it uncategorized rather than mis-filing it.
    func classify(
        notes: [(id: UUID, text: String)],
        categories: [(id: String, label: String)],
        model: String
    ) async throws -> [UUID: String] {
        guard !notes.isEmpty else { return [:] }
        let prompt = DigestPromptBuilder.classificationPrompt(notes: notes, categories: categories)
        let raw = try await complete(messages: [ChatMessage(role: "user", content: prompt)],
                                     model: model, temperature: 0)
        return DigestClassificationParser.parse(raw, allowed: Set(categories.map(\.id)))
    }

    /// Summarize a grouped day in one batched call. Returns the trimmed summary text.
    func summarize(
        day: Date,
        groups: [(label: String, notes: [String])],
        locale: String,
        model: String
    ) async throws -> String {
        let prompt = DigestPromptBuilder.summaryPrompt(day: day, groups: groups, locale: locale)
        let out = try await complete(messages: [ChatMessage(role: "user", content: prompt)],
                                     model: model, temperature: 0)
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// Strict parse of the classification reply. The model is asked for a single JSON object mapping
// note id → category id; anything we can't decode cleanly, a key that isn't a UUID we listed, or a
// value that isn't a known category (incl. "uncategorized") is dropped — so a note is only ever
// re-filed on an unambiguous match, never guessed into the wrong bucket.
enum DigestClassificationParser {
    static func parse(_ raw: String, allowed: Set<String>) -> [UUID: String] {
        guard let json = extractJSONObject(raw),
              let data = json.data(using: .utf8),
              let map = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        var out: [UUID: String] = [:]
        for (key, value) in map {
            guard let id = UUID(uuidString: key) else { continue }
            guard value != uncategorizedCategoryID, allowed.contains(value) else { continue }
            out[id] = value
        }
        return out
    }

    // The reply may be wrapped in prose or ```json fences; take the outermost {…} span.
    private static func extractJSONObject(_ s: String) -> String? {
        guard let start = s.firstIndex(of: "{"),
              let end = s.lastIndex(of: "}"),
              start < end else { return nil }
        return String(s[start...end])
    }
}
