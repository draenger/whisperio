import Testing
import Foundation
@testable import WhisperioKit

@Suite struct NoRedirectSessionDelegateTests {
    @Test func redirectTargetIsAlwaysNil() {
        let downgrade = URLRequest(url: URL(string: "http://evil.example.com/v1/audio")!)
        #expect(NoRedirectSessionDelegate.redirectTarget(for: downgrade) == nil)
        let sameHost = URLRequest(url: URL(string: "https://api.example.com/other")!)
        #expect(NoRedirectSessionDelegate.redirectTarget(for: sameHost) == nil)
    }

    @Test func delegateRefusesRedirect() {
        let session = NoRedirectSessionDelegate.makeSession(requestTimeout: 5, resourceTimeout: 5)
        let original = URL(string: "https://api.example.com/v1/audio")!
        let task = session.dataTask(with: original)   // never resumed
        let response = HTTPURLResponse(url: original, statusCode: 302, httpVersion: nil,
                                       headerFields: ["Location": "http://evil.example.com/x"])!
        let next = URLRequest(url: URL(string: "http://evil.example.com/x")!)
        var called = false
        var forwarded: URLRequest? = URLRequest(url: original)
        NoRedirectSessionDelegate.shared.urlSession(session, task: task,
                                                    willPerformHTTPRedirection: response,
                                                    newRequest: next) { r in
            called = true
            forwarded = r
        }
        #expect(called)
        #expect(forwarded == nil)
        session.invalidateAndCancel()
    }

    @Test func sessionKeepsTimeoutsAndDelegate() {
        let session = NoRedirectSessionDelegate.makeSession(requestTimeout: 12, resourceTimeout: 34)
        #expect(session.configuration.timeoutIntervalForRequest == 12)
        #expect(session.configuration.timeoutIntervalForResource == 34)
        #expect(session.delegate === NoRedirectSessionDelegate.shared)
        session.invalidateAndCancel()
    }
}
