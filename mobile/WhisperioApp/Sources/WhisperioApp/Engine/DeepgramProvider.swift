import Foundation
import WhisperioKit

// Cloud transcription via Deepgram's pre-recorded listen endpoint (BYO key). Nova models —
// unlike the OpenAI-compatible providers this is a raw-audio POST (no multipart), with the
// model/options in the query string and the transcript nested in the JSON response.
struct DeepgramProvider: TranscriptionProvider {
    let id: ProviderID = .deepgram
    let apiKey: String
    let model: String
    let language: String

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    // Settings persists the design's short model ids; map the one whose Deepgram API id differs.
    private var apiModel: String {
        switch model {
        case "": return "nova-3"
        case "whisper-cloud": return "whisper-large"
        default: return model
        }
    }

    func transcribe(_ clip: AudioClip) async throws -> String {
        var comps = URLComponents(string: "https://api.deepgram.com/v1/listen")
        var items = [URLQueryItem(name: "model", value: apiModel),
                     URLQueryItem(name: "smart_format", value: "true")]
        if language != "auto" && !language.isEmpty {
            items.append(URLQueryItem(name: "language", value: language))
        }
        comps?.queryItems = items
        guard let url = comps?.url else { throw Self.err("Invalid Deepgram URL.") }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.httpBody = clip.data

        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from Deepgram.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("Deepgram error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        struct R: Decodable {
            struct Results: Decodable { let channels: [Channel] }
            struct Channel: Decodable { let alternatives: [Alternative] }
            struct Alternative: Decodable { let transcript: String }
            let results: Results
        }
        let r = try JSONDecoder().decode(R.self, from: data)
        guard let text = r.results.channels.first?.alternatives.first?.transcript else {
            throw Self.err("Deepgram returned no transcript.")
        }
        return text
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.Deepgram", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
