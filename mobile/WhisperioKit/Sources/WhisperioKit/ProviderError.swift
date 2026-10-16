import Foundation

/// Turns a provider's HTTP error response into a short, safe, user-visible string. Never echoes
/// request headers or keys — only the (sanitised) response body is considered.
public enum ProviderError {
    public static let defaultLimit = 200

    /// "<status>" plus the response's `error.message` (JSON) or first non-empty line (text/HTML
    /// tags stripped, whitespace collapsed), truncated to `limit` characters with "…".
    public static func userMessage(status: Int, body: String, limit: Int = defaultLimit) -> String {
        let detail = extractDetail(body)
        let full = detail.isEmpty ? "HTTP \(status)" : "HTTP \(status): \(detail)"
        return truncate(full, limit: limit)
    }

    public static func userMessage(status: Int, body: Data, limit: Int = defaultLimit) -> String {
        userMessage(status: status, body: String(data: body, encoding: .utf8) ?? "", limit: limit)
    }

    static func extractDetail(_ body: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if let data = trimmed.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) {
            if let msg = jsonMessage(obj), !msg.isEmpty { return clean(msg) }
        }
        return clean(trimmed)
    }

    private static func jsonMessage(_ obj: Any) -> String? {
        guard let dict = obj as? [String: Any] else { return nil }
        if let err = dict["error"] as? [String: Any], let m = err["message"] as? String { return m }
        if let m = dict["error"] as? String { return m }
        if let m = dict["message"] as? String { return m }
        if let m = dict["detail"] as? String { return m }
        return nil
    }

    /// Drops script/style blocks and tags, decodes nothing fancy, keeps the first non-empty line.
    private static func clean(_ s: String) -> String {
        var t = s
        t = t.replacingOccurrences(of: "(?is)<(script|style)[^>]*>.*?</\\1>", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?i)<br\\s*/?>|</(p|div|h[1-6]|li|tr)>", with: "\n", options: .regularExpression)
        t = t.replacingOccurrences(of: "<[^>]*>", with: " ", options: .regularExpression)
        let firstLine = t.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first(where: { !$0.isEmpty }) ?? ""
        var out = firstLine.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        // Never let a credential echoed back by a server reach the UI.
        out = out.replacingOccurrences(of: "(?i)bearer\\s+\\S+", with: "Bearer ***", options: .regularExpression)
        out = out.replacingOccurrences(of: "\\b(sk|gsk|xi|r8|aai)[-_][A-Za-z0-9_\\-]{8,}", with: "***", options: .regularExpression)
        return out
    }

    private static func truncate(_ s: String, limit: Int) -> String {
        guard limit > 0, s.count > limit else { return s }
        return String(s.prefix(max(limit - 1, 0))) + "…"
    }
}
