import Foundation
import XCTest
@testable import WhisperioKit

final class KeyboardSessionTests: XCTestCase {
    func testTwoDictationsRequireAcknowledgement() {
        var phase: KeyboardSessionPhase = .sessionActive
        phase = KeyboardSessionStateMachine.next(phase, action: .startRecording)!
        XCTAssertEqual(phase, .recording)
        phase = KeyboardSessionStateMachine.next(phase, action: .stopRecording)!
        XCTAssertEqual(phase, .transcribing)
        XCTAssertNil(KeyboardSessionStateMachine.next(phase, action: .startRecording))
        phase = .done
        phase = KeyboardSessionStateMachine.next(phase, action: .ackResult)!
        XCTAssertEqual(KeyboardSessionStateMachine.next(phase, action: .startRecording), .recording)
        XCTAssertEqual(KeyboardSessionStateMachine.next(.recording, action: .endSession), .idle)
    }

    func testSnapshotRejectsStaleHeartbeatAndExpiry() {
        let now = Date(timeIntervalSince1970: 1_000)
        let snapshot = KeyboardSessionSnapshot(sessionID: UUID(), phase: .sessionActive,
            heartbeatAt: now, expiresAt: now.addingTimeInterval(300))
        XCTAssertTrue(snapshot.isLive(at: now.addingTimeInterval(9)))
        XCTAssertFalse(snapshot.isLive(at: now.addingTimeInterval(10)))
        XCTAssertFalse(snapshot.isLive(at: now.addingTimeInterval(300)))
    }

    func testMailboxPersistsCommandsAcrossMissedNotificationsAndDrainsOnce() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let mailbox = KeyboardSessionMailbox(directory: directory)
        let sessionID = UUID()
        let keyboardID = UUID()
        let first = KeyboardSessionCommand(sessionID: sessionID, requestID: UUID(),
            keyboardID: keyboardID, action: .startRecording,
            issuedAt: Date(timeIntervalSince1970: 1_000))
        let second = KeyboardSessionCommand(sessionID: sessionID, requestID: first.requestID,
            keyboardID: keyboardID, action: .stopRecording,
            issuedAt: Date(timeIntervalSince1970: 1_001))
        XCTAssertTrue(mailbox.send(second))
        XCTAssertTrue(mailbox.send(first))
        XCTAssertEqual(mailbox.drain().map(\.id), [first.id, second.id])
        XCTAssertTrue(mailbox.drain().isEmpty)
    }

    func testCorruptCommandIsIgnored() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("broken".utf8).write(to: directory.appendingPathComponent("command-corrupt.json"))
        XCTAssertTrue(KeyboardSessionMailbox(directory: directory).drain().isEmpty)
    }
}
