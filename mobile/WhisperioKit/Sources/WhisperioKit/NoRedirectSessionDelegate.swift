import Foundation

/// Session delegate that refuses every HTTP redirect.
///
/// `BaseURLPolicy` / the provider endpoints are validated once, on the configured URL. A 3xx from a
/// provider (or an on-path attacker on a LAN `http://` endpoint) would otherwise make URLSession
/// re-send the audio and `Authorization: Bearer <key>` to wherever `Location` points — including a
/// plaintext public host. Provider APIs never legitimately redirect, so (mirroring Android's
/// `followRedirects(false)`) we hand the 3xx response back to the caller, which already treats a
/// non-2xx status as an error.
public final class NoRedirectSessionDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    public static let shared = NoRedirectSessionDelegate()

    /// The whole policy, factored out so it can be unit-tested: a redirect is never followed.
    public static func redirectTarget(for proposed: URLRequest) -> URLRequest? { nil }

    public func urlSession(_ session: URLSession,
                           task: URLSessionTask,
                           willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest,
                           completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(Self.redirectTarget(for: request))
    }

    /// Build an ephemeral session with the given timeouts that never follows redirects.
    public static func makeSession(requestTimeout: TimeInterval, resourceTimeout: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = requestTimeout    // idle timeout between bytes
        config.timeoutIntervalForResource = resourceTimeout  // hard cap for the whole request+response
        return URLSession(configuration: config, delegate: shared, delegateQueue: nil)
    }
}
