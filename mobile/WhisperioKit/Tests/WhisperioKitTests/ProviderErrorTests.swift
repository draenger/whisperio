import Testing
import Foundation
@testable import WhisperioKit

@Suite struct ProviderErrorTests {
    @Test func jsonErrorMessageWins() {
        let body = #"{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}"#
        #expect(ProviderError.userMessage(status: 401, body: body) == "HTTP 401: Incorrect API key provided")
    }

    @Test func htmlIsStrippedToFirstLine() {
        let body = "<html><head><style>x{}</style></head><body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>"
        #expect(ProviderError.userMessage(status: 502, body: body) == "HTTP 502: 502 Bad Gateway")
    }

    @Test func onlyFirstLineKept() {
        #expect(ProviderError.userMessage(status: 500, body: "boom\n  stack line 1\nstack line 2") == "HTTP 500: boom")
    }

    @Test func truncatesTo200WithEllipsis() {
        let m = ProviderError.userMessage(status: 400, body: String(repeating: "a", count: 1000))
        #expect(m.count == 200)
        #expect(m.hasSuffix("…"))
    }

    @Test func emptyBodyFallsBackToStatus() {
        #expect(ProviderError.userMessage(status: 503, body: "  \n ") == "HTTP 503")
    }

    @Test func dataOverload() {
        #expect(ProviderError.userMessage(status: 429, body: Data(#"{"error":"slow down"}"#.utf8)) == "HTTP 429: slow down")
    }

    @Test func credentialsEchoedByServerAreRedacted() {
        let m = ProviderError.userMessage(status: 401, body: "Bad key sk-abcdef1234567890 / Bearer abc.def")
        #expect(!m.contains("abcdef1234567890"))
        #expect(!m.contains("abc.def"))
    }
}
