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

    @Test func httpOkForIntranetStyleHosts() {
        for s in ["http://nas:8080/v1", "http://whisper-box", "http://stt.lan", "http://box.home.arpa",
                  "http://svc.internal", "http://100.64.0.1", "http://100.127.255.1", "http://[fd12::1]:8080",
                  "http://[fe80::1]", "http://[fc00::2]"] {
            guard case .success = BaseURLPolicy.validate(s) else { Issue.record("expected ok: \(s)"); continue }
        }
        for s in ["http://100.63.0.1", "http://100.128.0.1", "http://[2001:db8::1]", "http://example.com.lan.evil.com"] {
            guard case .failure(.insecureHTTP) = BaseURLPolicy.validate(s) else { Issue.record("expected rejection: \(s)"); continue }
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

    /// "fc::1" is 00fc::1 and "fc0::1" is 0fc0::1: outside fc00::/7 although the text starts with fc.
    @Test func shortIPv6StartingWithFcIsNotUniqueLocal() {
        for h in ["fc::1", "fd::1", "fc0::1", "fd0::1", "fe8::1", "fe::1", "[fc::1]", "[fd::1]", "[fc0::1]"] {
            #expect(!BaseURLPolicy.isLocalHost(h), "\(h)")
        }
        for s in ["http://[fc::1]/v1", "http://[fd::1]/v1", "http://[fc0::1]/v1"] {
            guard case .failure(.insecureHTTP) = BaseURLPolicy.validate(s) else { Issue.record("expected rejection: \(s)"); continue }
        }
    }

    /// The whole fc00::/7 and fe80::/10 ranges count, by value of the first hextet.
    @Test func uniqueLocalAndLinkLocalRangesByValue() {
        for h in ["fc00::1", "fcff::1", "fd00::1", "fd12:3456::1", "fdff:ffff::1", "FD12::1", "fe80::1", "fe9a::1", "febf::1"] {
            #expect(BaseURLPolicy.isLocalHost(h), "\(h)")
        }
        for h in ["fe00::1", "fec0::1", "fb00::1", "ff02::1", "2001:db8::1", "::ffff:8.8.8.8", "fc000::1", "fz00::1"] {
            #expect(!BaseURLPolicy.isLocalHost(h), "\(h)")
        }
        guard case .success = BaseURLPolicy.validate("http://[fd12:3456::1]:8080/v1") else { Issue.record("expected ok"); return }
    }

    /// Dotless numeric hosts are IPv4 literals for the resolver (134744072 == 8.8.8.8), not intranet names.
    @Test func dotlessNumericIPv4LiteralIsNotLocal() {
        for h in ["134744072", "0x08080808", "2130706433"] {
            #expect(!BaseURLPolicy.isLocalHost(h), "\(h)")
        }
        for s in ["http://134744072/v1", "http://0x08080808/v1"] {
            guard case .failure(.insecureHTTP) = BaseURLPolicy.validate(s) else { Issue.record("expected rejection: \(s)"); continue }
        }
        #expect(BaseURLPolicy.isLocalHost("nas"))
        #expect(BaseURLPolicy.isLocalHost("box1"))
        #expect(!BaseURLPolicy.isLocalHost("0X08080808"))
    }

    /// Leading-zero parts are octal for the resolver (010.010.010.010 == 8.8.8.8): never private.
    @Test func leadingZeroIPv4PartsAreNotPrivate() {
        for h in ["010.010.010.010", "010.0.0.1", "10.010.0.1", "192.168.01.1", "127.0.0.01", "00.0.0.0"] {
            #expect(!BaseURLPolicy.isLocalHost(h), "\(h)")
        }
        guard case .failure(.insecureHTTP) = BaseURLPolicy.validate("http://010.010.010.010/v1") else { Issue.record("expected rejection"); return }
        for h in ["10.0.0.1", "192.168.0.10", "127.0.0.1", "172.20.0.100"] {
            #expect(BaseURLPolicy.isLocalHost(h), "\(h)")
        }
    }

    /// A dotless non-ASCII name may map to an IPv4 literal (fullwidth digits): not an intranet name.
    @Test func nonASCIIDotlessHostIsNotLocal() {
        #expect(!BaseURLPolicy.isLocalHost("\u{FF11}\u{FF13}\u{FF14}\u{FF17}\u{FF14}\u{FF14}\u{FF10}\u{FF17}\u{FF12}"))
        #expect(!BaseURLPolicy.isLocalHost("nä s"))
        #expect(BaseURLPolicy.isLocalHost("my-nas"))
    }

    /// Zone ids and uncompressed forms keep working.
    @Test func ipv6ZoneAndUncompressedForms() {
        #expect(BaseURLPolicy.isLocalHost("fe80::1%en0"))
        #expect(BaseURLPolicy.isLocalHost("fd00:0000:0000:0000:0000:0000:0000:0001"))
        #expect(!BaseURLPolicy.isLocalHost("2001:0db8:0000:0000:0000:0000:0000:0001"))
    }

    @Test func officialVsCustomHost() {
        #expect(BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://api.openai.com/v1")!))
        #expect(BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://API.OPENAI.COM/v1")!))
        #expect(!BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://my-proxy.example.com/v1")!))
        #expect(!BaseURLPolicy.isOfficialHost(provider: .openAI, url: URL(string: "https://api.openai.com.evil.test/v1")!))
        #expect(!BaseURLPolicy.isOfficialHost(provider: .selfHosted, url: URL(string: "https://api.openai.com/v1")!))
    }

    /// 0.0.0.0 (a server bound to every interface, reached locally) has its own branch.
    @Test func unspecifiedAddressCountsAsLocal() {
        #expect(BaseURLPolicy.isLocalHost("0.0.0.0"))
        guard case .success = BaseURLPolicy.validate("http://0.0.0.0:8080/v1") else { Issue.record("expected ok"); return }
        #expect(!BaseURLPolicy.isLocalHost("0.0.0.1"))
    }

    /// Pasted URLs often carry spaces or a newline; they are trimmed, not rejected or kept.
    @Test func surroundingWhitespaceIsTrimmed() {
        guard case .success(let u) = BaseURLPolicy.validate("  https://api.openai.com/v1\n") else { Issue.record("expected ok"); return }
        #expect(u.absoluteString == "https://api.openai.com/v1")
        guard case .failure(.insecureHTTP) = BaseURLPolicy.validate(" http://example.com ") else { Issue.record("expected rejection"); return }
    }

    /// The text the user sees: names the rejected host and the fix, and never says "error" alone.
    @Test func userFacingMessagesNameTheHostAndTheFix() {
        let insecure = BaseURLPolicy.Error.insecureHTTP(host: "example.com").errorDescription ?? ""
        #expect(insecure.contains("example.com"))
        #expect(insecure.contains("https://"))
        #expect((BaseURLPolicy.Error.unsupportedScheme("ftp").errorDescription ?? "").contains("\"ftp\""))
        #expect(BaseURLPolicy.Error.empty.errorDescription == "Enter a URL.")
        #expect((BaseURLPolicy.Error.invalid.errorDescription ?? "").contains("https://host[:port]/v1"))
    }
}
