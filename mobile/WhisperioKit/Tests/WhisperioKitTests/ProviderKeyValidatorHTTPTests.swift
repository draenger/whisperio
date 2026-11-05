import Testing
import Foundation
@testable import WhisperioKit

/// The HTTP half of `ProviderKeyValidator`, offline: a stub `URLProtocol` answers every request, so
/// these pin what each provider is asked (URL, method, auth header shape) and how its answer maps to
/// the result shown in onboarding/Settings: 2xx valid, 401/403 bad key, anything else (429 rate
/// limit, 5xx) "unexpected <status>", a request that never completes (timeout, offline) "network".
private let testKey = "sk-test-key-1234567890"

@Suite(.serialized) struct ProviderKeyValidatorHTTPTests {
    static let key = testKey

    @Test(arguments: [
        RequestCase(.openAI, "https://api.openai.com/v1/models", "Authorization", "Bearer \(testKey)"),
        RequestCase(.elevenLabs, "https://api.elevenlabs.io/v1/user", "xi-api-key", testKey),
        RequestCase(.deepgram, "https://api.deepgram.com/v1/projects", "Authorization", "Token \(testKey)"),
        RequestCase(.groq, "https://api.groq.com/openai/v1/models", "Authorization", "Bearer \(testKey)"),
        RequestCase(.assemblyAI, "https://api.assemblyai.com/v2/transcript?limit=1", "Authorization", testKey),
        RequestCase(.mistral, "https://api.mistral.ai/v1/models", "Authorization", "Bearer \(testKey)"),
        RequestCase(.replicate, "https://api.replicate.com/v1/account", "Authorization", "Bearer \(testKey)")
    ])
    func eachProviderIsAskedWithItsOwnURLAndAuthHeader(_ c: RequestCase) async {
        KeyValidatorStub.reply(status: 200)
        let result = await ProviderKeyValidator.validate(c.id, key: Self.key, session: KeyValidatorStub.session())
        #expect(Self.failure(result) == nil, "\(c.id) 200 should validate")
        let seen = KeyValidatorStub.requests()
        #expect(seen.count == 1)
        #expect(seen.first?.url?.absoluteString == c.url)
        #expect(seen.first?.httpMethod == "GET")
        #expect(seen.first?.value(forHTTPHeaderField: c.header) == c.value)
    }

    @Test(arguments: [401, 403])
    func authFailuresMeanAnInvalidKey(_ status: Int) async {
        KeyValidatorStub.reply(status: status)
        let result = await ProviderKeyValidator.validate(.openAI, key: Self.key, session: KeyValidatorStub.session())
        #expect(Self.failure(result) == .invalidKey)
    }

    // 429 is not reported as a bad key: the key may be fine and only rate limited or out of quota.
    @Test(arguments: [429, 500, 503])
    func otherStatusesAreUnexpectedWithTheirCode(_ status: Int) async {
        KeyValidatorStub.reply(status: status)
        let result = await ProviderKeyValidator.validate(.deepgram, key: Self.key, session: KeyValidatorStub.session())
        #expect(Self.failure(result) == .unexpected(status))
    }

    @Test(arguments: [URLError.Code.timedOut, .notConnectedToInternet, .cannotFindHost, .secureConnectionFailed])
    func aRequestThatNeverCompletesIsANetworkErrorWithoutTheKey(_ code: URLError.Code) async {
        KeyValidatorStub.reply(error: code)
        let result = await ProviderKeyValidator.validate(.elevenLabs, key: Self.key, session: KeyValidatorStub.session())
        guard case .network(let message)? = Self.failure(result) else {
            Issue.record("expected .network for \(code), got \(String(describing: Self.failure(result)))")
            return
        }
        #expect(!message.isEmpty)
        #expect(!message.contains(Self.key))
    }

    @Test func onDeviceLocalWhisperAndSelfHostedSendNoRequest() async {
        KeyValidatorStub.reply(status: 500)
        let session = KeyValidatorStub.session()
        _ = await ProviderKeyValidator.validate(.onDevice, key: "", session: session)
        _ = await ProviderKeyValidator.validate(.localWhisper, key: "", session: session)
        _ = await ProviderKeyValidator.validate(.selfHosted, key: "http://192.168.1.5:5000", session: session)
        #expect(KeyValidatorStub.requests().isEmpty)
    }

    static func failure(_ r: Result<Void, ProviderKeyValidationError>) -> ProviderKeyValidationError? {
        if case .failure(let e) = r { return e }
        return nil
    }
}

struct RequestCase: Sendable, CustomTestStringConvertible {
    let id: ProviderID
    let url: String
    let header: String
    let value: String
    init(_ id: ProviderID, _ url: String, _ header: String, _ value: String) {
        self.id = id; self.url = url; self.header = header; self.value = value
    }
    var testDescription: String { id.rawValue }
}

/// Answers every request with the configured status or `URLError`, and records what was asked.
final class KeyValidatorStub: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var status = 200
    nonisolated(unsafe) private static var errorCode: URLError.Code?
    nonisolated(unsafe) private static var seen: [URLRequest] = []

    static func reply(status: Int = 200, error: URLError.Code? = nil) {
        lock.lock(); defer { lock.unlock() }
        self.status = status; errorCode = error; seen = []
    }

    static func requests() -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return seen
    }

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [KeyValidatorStub.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.seen.append(request)
        let status = Self.status, code = Self.errorCode
        Self.lock.unlock()
        if let code {
            client?.urlProtocol(self, didFailWithError: URLError(code))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
