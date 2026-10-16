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
        let m = ProviderError.userMessage(status: 400, body: String(repeating: "word ", count: 300))
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

    @Test func vendorKeyShapesAreRedacted() {
        let dg = String(repeating: "a1b2c3d4e5", count: 4)       // 40-hex style Deepgram key
        let aai = "0123456789abcdef0123456789abcdef"              // 32-hex AssemblyAI key
        for secret in [dg, aai] {
            let m = ProviderError.userMessage(status: 401, body: "Invalid credentials \(secret) rejected")
            #expect(!m.contains(secret))
        }
        #expect(!ProviderError.userMessage(status: 401, body: "Token abc123XYZ invalid").contains("abc123XYZ"))
        let j = ProviderError.userMessage(status: 401, body: #"{"detail":"bad","api_key":"shortkey1"}"#)
        #expect(!j.contains("shortkey1"))
        let h = ProviderError.userMessage(status: 401, body: "xi-api-key: hunter2hunter2 invalid")
        #expect(!h.contains("hunter2hunter2"))
    }
}
