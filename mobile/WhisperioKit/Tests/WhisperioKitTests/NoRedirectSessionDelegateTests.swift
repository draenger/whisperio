import Testing
import Foundation
@testable import WhisperioKit

@Suite(.serialized) struct NoRedirectSessionDelegateTests {
    @Test func redirectTargetIsAlwaysNil() {
        let downgrade = URLRequest(url: URL(string: "http://evil.example.com/v1/audio")!)
        #expect(NoRedirectSessionDelegate.redirectTarget(for: downgrade) == nil)
        let sameHost = URLRequest(url: URL(string: "https://api.example.com/other")!)
        #expect(NoRedirectSessionDelegate.redirectTarget(for: sameHost) == nil)
    }

    @Test func delegateRefusesRedirect() async {
        let session = NoRedirectSessionDelegate.makeSession(requestTimeout: 5, resourceTimeout: 5)
        let original = URL(string: "https://api.example.com/v1/audio")!
        let task = session.dataTask(with: original)   // never resumed
        let response = HTTPURLResponse(url: original, statusCode: 302, httpVersion: nil,
                                       headerFields: ["Location": "http://evil.example.com/x"])!
        let next = URLRequest(url: URL(string: "http://evil.example.com/x")!)
        let forwarded = await NoRedirectSessionDelegate.shared.urlSession(
            session, task: task, willPerformHTTPRedirection: response, newRequest: next)
        #expect(forwarded == nil)
        session.invalidateAndCancel()
    }

    /// End to end: a 302 from host A must come back as the response, and host B is never requested.
    @Test func sessionReturns302AndNeverRequestsRedirectTarget() async throws {
        RedirectStubProtocol.log.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RedirectStubProtocol.self]
        let session = NoRedirectSessionDelegate.makeSession(configuration: config,
                                                            requestTimeout: 5, resourceTimeout: 5)
        defer { session.invalidateAndCancel() }
        let (_, resp) = try await session.data(for: URLRequest(url: URL(string: "https://a.example.com/start")!))
        let http = try #require(resp as? HTTPURLResponse)
        #expect(http.statusCode == 302)
        let hosts = RedirectStubProtocol.log.hosts
        #expect(hosts.contains("a.example.com"))
        #expect(!hosts.contains("b.example.com"))
    }

    @Test func sessionKeepsTimeoutsAndDelegate() {
        let session = NoRedirectSessionDelegate.makeSession(requestTimeout: 12, resourceTimeout: 34)
        #expect(session.configuration.timeoutIntervalForRequest == 12)
        #expect(session.configuration.timeoutIntervalForResource == 34)
        #expect(session.delegate === NoRedirectSessionDelegate.shared)
        session.invalidateAndCancel()
    }
}

final class HostLog: @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [String] = []
    func record(_ host: String) { lock.lock(); seen.append(host); lock.unlock() }
    func reset() { lock.lock(); seen = []; lock.unlock() }
    var hosts: [String] { lock.lock(); defer { lock.unlock() }; return seen }
}

/// Host A answers with a 302 -> host B (also announced to the client as a redirect); host B would
/// answer 200. Records every host actually loaded.
final class RedirectStubProtocol: URLProtocol, @unchecked Sendable {
    static let log = HostLog()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let host = url.host else { return }
        Self.log.record(host)
        if host == "a.example.com" {
            let target = URL(string: "https://b.example.com/landed")!
            let redirect = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil,
                                           headerFields: ["Location": target.absoluteString])!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: target), redirectResponse: redirect)
            client?.urlProtocol(self, didReceive: redirect, cacheStoragePolicy: .notAllowed)
        } else {
            let ok = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: ok, cacheStoragePolicy: .notAllowed)
        }
        client?.urlProtocol(self, didLoad: Data())
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
