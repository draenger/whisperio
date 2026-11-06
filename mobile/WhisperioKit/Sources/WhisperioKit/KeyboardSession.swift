import Foundation
import CoreFoundation

public enum KeyboardSessionPhase: String, Codable, Sendable {
    case idle, sessionActive, recording, transcribing, done, error
}

public enum KeyboardSessionAction: String, Codable, Sendable {
    case startRecording, stopRecording, cancelRecording, endSession, ackResult
}

public struct KeyboardSessionCommand: Codable, Sendable, Equatable {
    public let version: Int
    public let id: UUID
    public let sessionID: UUID
    public let requestID: UUID
    public let keyboardID: UUID
    public let action: KeyboardSessionAction
    public let issuedAt: Date

    public init(sessionID: UUID, requestID: UUID, keyboardID: UUID,
                action: KeyboardSessionAction, id: UUID = UUID(), issuedAt: Date = Date()) {
        self.version = 1
        self.id = id
        self.sessionID = sessionID
        self.requestID = requestID
        self.keyboardID = keyboardID
        self.action = action
        self.issuedAt = issuedAt
    }
}

public struct KeyboardSessionSnapshot: Codable, Sendable, Equatable {
    public let version: Int
    public var sessionID: UUID
    public var phase: KeyboardSessionPhase
    public var requestID: UUID?
    public var heartbeatAt: Date
    public var expiresAt: Date
    public var error: String?

    public init(sessionID: UUID, phase: KeyboardSessionPhase, requestID: UUID? = nil,
                heartbeatAt: Date, expiresAt: Date, error: String? = nil) {
        self.version = 1
        self.sessionID = sessionID
        self.phase = phase
        self.requestID = requestID
        self.heartbeatAt = heartbeatAt
        self.expiresAt = expiresAt
        self.error = error
    }

    public func isLive(at date: Date) -> Bool {
        version == 1 && phase != .idle && date < expiresAt &&
        date.timeIntervalSince(heartbeatAt) >= 0 && date.timeIntervalSince(heartbeatAt) < 10
    }
}

public struct KeyboardSessionResult: Codable, Sendable, Equatable {
    public let version: Int
    public let sessionID: UUID
    public let requestID: UUID
    public let text: String
    public let provider: ProviderID
    public let createdAt: Date

    public init(sessionID: UUID, requestID: UUID, text: String, provider: ProviderID, createdAt: Date = Date()) {
        self.version = 1
        self.sessionID = sessionID
        self.requestID = requestID
        self.text = text
        self.provider = provider
        self.createdAt = createdAt
    }
}

/// Pure transition gate. The app owns audio and applies these transitions serially on MainActor.
public enum KeyboardSessionStateMachine {
    public static func next(_ phase: KeyboardSessionPhase, action: KeyboardSessionAction) -> KeyboardSessionPhase? {
        switch (phase, action) {
        case (.sessionActive, .startRecording), (.error, .startRecording): return .recording
        case (.recording, .stopRecording): return .transcribing
        case (.recording, .cancelRecording): return .sessionActive
        case (.done, .ackResult), (.error, .ackResult): return .sessionActive
        case (.sessionActive, .endSession), (.recording, .endSession),
             (.transcribing, .endSession), (.done, .endSession), (.error, .endSession): return .idle
        default: return nil
        }
    }
}

/// A notification is only a wake-up hint. All data is in atomically replaced App Group files.
public enum KeyboardSessionStore {
    public static let commandNotification = "ai.whisperio.mobile.keyboardSession.command.v1"
    public static let stateNotification = "ai.whisperio.mobile.keyboardSession.state.v1"
    public static let resultNotification = "ai.whisperio.mobile.keyboardSession.result.v1"
    private static let directoryName = "KeyboardSession-v1"

    private static var directory: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedStore.appGroupID)?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    private static func write<T: Encodable>(_ value: T, to url: URL) -> Bool {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(value).write(to: url, options: .atomic)
            return true
        } catch { return false }
    }

    private static func read<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    public static func publish(_ snapshot: KeyboardSessionSnapshot) -> Bool {
        guard let directory, write(snapshot, to: directory.appendingPathComponent("snapshot.json")) else { return false }
        post(stateNotification)
        return true
    }

    public static func snapshot() -> KeyboardSessionSnapshot? {
        guard let directory, let value: KeyboardSessionSnapshot = read(KeyboardSessionSnapshot.self, from: directory.appendingPathComponent("snapshot.json")), value.version == 1 else { return nil }
        return value
    }

    public static func send(_ command: KeyboardSessionCommand) -> Bool {
        guard let directory, KeyboardSessionMailbox(directory: directory).send(command) else { return false }
        post(commandNotification)
        return true
    }

    public static func drainCommands() -> [KeyboardSessionCommand] {
        guard let directory else { return [] }
        return KeyboardSessionMailbox(directory: directory).drain()
    }

    public static func publish(_ result: KeyboardSessionResult) -> Bool {
        guard let directory, write(result, to: directory.appendingPathComponent("result-\(result.requestID.uuidString).json")) else { return false }
        post(resultNotification)
        return true
    }

    public static func result(for requestID: UUID) -> KeyboardSessionResult? {
        guard let directory else { return nil }
        let url = directory.appendingPathComponent("result-\(requestID.uuidString).json")
        guard let value: KeyboardSessionResult = read(KeyboardSessionResult.self, from: url), value.version == 1 else { return nil }
        guard Date().timeIntervalSince(value.createdAt) < 600 else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return value
    }

    public static func purgeExpiredResults(at now: Date = Date()) {
        guard let directory,
              let urls = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for url in urls where url.lastPathComponent.hasPrefix("result-") && url.pathExtension == "json" {
            guard let result: KeyboardSessionResult = read(KeyboardSessionResult.self, from: url),
                  now.timeIntervalSince(result.createdAt) < 600 else {
                try? FileManager.default.removeItem(at: url)
                continue
            }
        }
    }

    public static func acknowledge(_ requestID: UUID) {
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("result-\(requestID.uuidString).json"))
    }

    public static var idleTimeoutMinutes: Int {
        get {
            let value = UserDefaults(suiteName: SharedStore.appGroupID)?.integer(forKey: "kbd.session.v1.idleTimeoutMinutes") ?? 0
            return value == 0 ? 5 : max(1, min(30, value))
        }
        set { UserDefaults(suiteName: SharedStore.appGroupID)?.set(max(1, min(30, newValue)), forKey: "kbd.session.v1.idleTimeoutMinutes") }
    }

    public static func post(_ name: String) {
        #if os(iOS) || os(macOS)
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
                                             CFNotificationName(rawValue: name as CFString), nil, nil, true)
        #endif
    }
}

/// File transport with an injectable directory for IPC tests outside an App Group.
public struct KeyboardSessionMailbox {
    public let directory: URL

    public init(directory: URL) { self.directory = directory }

    @discardableResult
    public func send(_ command: KeyboardSessionCommand) -> Bool {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("command-\(command.id.uuidString).json")
            try JSONEncoder().encode(command).write(to: url, options: .atomic)
            return true
        } catch { return false }
    }

    public func drain() -> [KeyboardSessionCommand] {
        guard let urls = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return [] }
        return urls.filter { $0.lastPathComponent.hasPrefix("command-") && $0.pathExtension == "json" }
            .compactMap { url in
                defer { try? FileManager.default.removeItem(at: url) }
                guard let data = try? Data(contentsOf: url),
                      let command = try? JSONDecoder().decode(KeyboardSessionCommand.self, from: data),
                      command.version == 1 else { return nil }
                return command
            }.sorted { $0.issuedAt == $1.issuedAt ? $0.id.uuidString < $1.id.uuidString : $0.issuedAt < $1.issuedAt }
    }
}

#if os(iOS) || os(macOS)
public final class KeyboardSessionObserver {
    private let names: [String]
    private let onChange: () -> Void

    public init(names: [String], onChange: @escaping () -> Void) {
        self.names = names
        self.onChange = onChange
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        for name in names {
            CFNotificationCenterAddObserver(center, Unmanaged.passUnretained(self).toOpaque(),
                { _, observer, _, _, _ in
                    guard let observer else { return }
                    Unmanaged<KeyboardSessionObserver>.fromOpaque(observer).takeUnretainedValue().onChange()
                }, name as CFString, nil, .deliverImmediately)
        }
    }

    deinit {
        CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(),
                                                Unmanaged.passUnretained(self).toOpaque())
    }
}
#else
public final class KeyboardSessionObserver {
    public init(names: [String], onChange: @escaping () -> Void) {}
}
#endif
