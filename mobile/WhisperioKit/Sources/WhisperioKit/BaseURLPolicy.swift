import Foundation

/// Connection-security rule for user-editable provider base URLs (`openAIBaseURL`,
/// `selfHostedURL`). Mirrors the desktop rule in `desktop/src/main/llm/provider.ts`
/// (`assertSecureBaseUrl` / `isLocalHost`): `https://` is always accepted; plain `http://` only
/// for loopback / private hosts (localhost, 127.0.0.0/8, ::1, 10/8, 172.16/12, 192.168/16,
/// `*.local`) — what self-hosted whisper servers on a LAN use. Anything else is rejected with a
/// readable error; nothing is silently rewritten.
public enum BaseURLPolicy {
    public enum Error: Swift.Error, Equatable, Sendable, LocalizedError {
        case empty
        case invalid
        case unsupportedScheme(String)
        case insecureHTTP(host: String)

        public var errorDescription: String? {
            switch self {
            case .empty: return "Enter a URL."
            case .invalid: return "Not a valid URL. Use the form https://host[:port]/v1."
            case .unsupportedScheme(let s):
                return "Unsupported URL scheme \"\(s)\". Use https://."
            case .insecureHTTP(let host):
                return "Plain http:// is only allowed for localhost and private-network hosts. "
                    + "\(host) is a public host — use https://."
            }
        }
    }

    /// Validates `raw` (trimmed). `assumeHTTPForBareHost` lets a scheme-less "192.168.1.5:5000"
    /// be read as `http://…` (the self-hosted field's historical shorthand); the result is still
    /// subject to the same rule, so a bare *public* host is rejected rather than rewritten.
    public static func validate(_ raw: String, assumeHTTPForBareHost: Bool = false) -> Result<URL, Error> {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return .failure(.empty) }
        if !s.contains("://") {
            guard assumeHTTPForBareHost else { return .failure(.invalid) }
            s = "http://" + s
        }
        guard let url = URL(string: s), let host = url.host, !host.isEmpty,
              let scheme = url.scheme?.lowercased() else {
            return .failure(.invalid)
        }
        switch scheme {
        case "https": return .success(url)
        case "http":
            return isLocalHost(host) ? .success(url) : .failure(.insecureHTTP(host: host))
        default: return .failure(.unsupportedScheme(scheme))
        }
    }

    /// Loopback / private-network host check (same semantics as desktop `isLocalHost`).
    public static func isLocalHost(_ hostname: String) -> Bool {
        var host = hostname.trimmingCharacters(in: .whitespaces).lowercased()
        if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host == "localhost" || host == "::1" || host == "0.0.0.0" { return true }
        for suffix in [".local", ".lan", ".home.arpa", ".internal"] where host.hasSuffix(suffix) { return true }
        // Dotless intranet names ("nas", "whisper-box") never resolve on the public internet, except
        // numeric IPv4 literals: Foundation keeps "134744072" / "0x08080808" as the host and the
        // resolver reads them as 8.8.8.8.
        // Non-ASCII names are not trusted either: IDN mapping can turn fullwidth digits into an IPv4 literal.
        if !host.contains(".") && !host.contains(":") {
            return host.allSatisfy(\.isASCII) && !isNumericIPv4Literal(host)
        }
        // IPv6 unique-local (fc00::/7) and link-local (fe80::/10), judged on the numeric first
        // hextet: a text prefix wrongly accepted "fc::1" (= 00fc::1) and "fc0::1" (= 0fc0::1).
        if host.contains(":") {
            guard let first = firstHextet(host) else { return false }
            return (first & 0xFE00) == 0xFC00 || (first & 0xFFC0) == 0xFE80
        }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        // A part with a leading zero ("010") is octal for an inet_aton-style resolver (010.010.010.010
        // = 8.8.8.8) but decimal for Int(): never classify such a host as private.
        if parts.contains(where: { $0.count > 1 && $0.hasPrefix("0") }) { return false }
        if parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.count <= 3 && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }) {
            let o = parts.compactMap { Int($0) }
            guard o.count == 4, o.allSatisfy({ $0 <= 255 }) else { return false }
            if o[0] == 127 || o[0] == 10 { return true }
            if o[0] == 192 && o[1] == 168 { return true }
            if o[0] == 172 && (16...31).contains(o[1]) { return true }
            if o[0] == 100 && (64...127).contains(o[1]) { return true }   // Tailscale / CGNAT 100.64.0.0/10
        }
        return false
    }

    /// First 16-bit group of an IPv6 literal, or nil when it is empty ("::…") or not 1-4 hex digits.
    static func firstHextet(_ host: String) -> Int? {
        let group = host.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        guard (1...4).contains(group.count), group.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { return nil }
        return Int(group, radix: 16)
    }

    /// "134744072", "0x08080808": a dotless host that the resolver reads as an IPv4 address.
    static func isNumericIPv4Literal(_ host: String) -> Bool {
        if !host.isEmpty && host.allSatisfy({ $0.isASCII && $0.isNumber }) { return true }
        if host.hasPrefix("0x") && host.count > 2 && host.dropFirst(2).allSatisfy({ $0.isASCII && $0.isHexDigit }) { return true }
        return false
    }

    /// The provider's official API host. Only providers with a user-editable base URL need one;
    /// self-hosted has no official host by definition.
    public static func officialHost(for provider: ProviderID) -> String? {
        switch provider {
        case .openAI: return "api.openai.com"
        default: return nil
        }
    }

    /// True when `url`'s host is the provider's official one.
    public static func isOfficialHost(provider: ProviderID, url: URL) -> Bool {
        guard let official = officialHost(for: provider), let host = url.host?.lowercased() else { return false }
        return host == official
    }
}
