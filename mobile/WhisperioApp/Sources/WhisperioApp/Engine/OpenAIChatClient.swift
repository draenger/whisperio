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
