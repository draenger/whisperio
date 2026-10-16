import Testing
import Foundation
@testable import WhisperioKit

@Suite struct BaseURLPolicyTests {
    @Test func httpsAlwaysOk() {
        guard case .success(let u) = BaseURLPolicy.validate("https://api.openai.com/v1") else { Issue.record("expected ok"); return }
        #expect(u.host == "api.openai.com")
        guard case .success = BaseURLPolicy.validate("https://example.com:8443/v1") else { Issue.record("expected ok"); return }
    }

    @Test func httpOkForLoopbackAndPrivate() {
        for s in ["http://localhost:8080/v1", "http://127.0.0.1:9000", "http://127.5.5.5", "http://[::1]:8080/v1",
                  "http://10.1.2.3/v1", "http://172.16.0.1", "http://172.31.255.1", "http://192.168.1.20:8080/v1",
                  "http://mybox.local:8080/v1"] {
            guard case .success = BaseURLPolicy.validate(s) else { Issue.record("expected ok: \(s)"); continue }
        }
    }

    @Test func httpPublicRejected() {
        for s in ["http://api.openai.com/v1", "http://8.8.8.8", "http://172.32.0.1", "http://172.15.0.1",
                  "http://192.169.1.1", "http://11.0.0.1", "http://example.com"] {
            guard case .failure(.insecureHTTP) = BaseURLPolicy.validate(s) else { Issue.record("expected rejection: \(s)"); continue }
        }
    }

    @Test func invalidRejected() {
        #expect(BaseURLPolicy.validate("") == .failure(.empty))
        #expect(BaseURLPolicy.validate("   ") == .failure(.empty))
        #expect(BaseURLPolicy.validate("not a url") == .failure(.invalid))
        #expect(BaseURLPolicy.validate("localhost:8000") == .failure(.invalid))
        guard case .failure(.unsupportedScheme) = BaseURLPolicy.validate("ftp://example.com") else { Issue.record("expected scheme error"); return }
        guard case .failure(.invalid) = BaseURLPolicy.validate("https://") else { Issue.record("expected invalid"); return }
    }

    @Test func bareHostOnlyWhenAllowedAndStillChecked() {
        guard case .success(let u) = BaseURLPolicy.validate("192.168.1.5:5000", assumeHTTPForBareHost: true) else { Issue.record("expected ok"); return }
        #expect(u.scheme == "http")
        guard case .failure(.insecureHTTP) = BaseURLPolicy.validate("example.com", assumeHTTPForBareHost: true) else { Issue.record("expected rejection"); return }
    }

    @Test func officialVsCustomHost() {
        #expect(BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://api.openai.com/v1")!))
        #expect(BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://API.OPENAI.COM/v1")!))
        #expect(!BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://my-proxy.example.com/v1")!))
        #expect(!BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://api.openai.com.evil.test/v1")!))
        #expect(!BaseURLPolicy.isOfficialHost(provider: .selfHosted, url: URL(string: "https://api.openai.com/v1")!))
    }
}
