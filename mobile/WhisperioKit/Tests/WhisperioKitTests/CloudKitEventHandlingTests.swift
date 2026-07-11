import Testing
import Foundation
import CoreData
@testable import WhisperioKit

/// Unit tests for the pure `syncEffect(type:succeeded:endDate:error:)` reducers extracted from
/// `RecordingSyncStore`/`DigestSyncStore`'s `NSPersistentCloudKitContainer.eventChangedNotification`
/// observers. These run headlessly — no `ModelContainer`, no CloudKit account, no notification —
/// because the decision they exercise (event type × succeeded/failed → effect) is plain data in,
/// plain data out.
///
/// The case this guards against: before this change, the observer's `guard event.type == .import
/// || event.type == .export` silently dropped `.setup` events — the one-time CloudKit zone +
/// subscription bootstrap the iPad's push-driven import path depends on. A `.setup` failure (e.g.
/// the Production schema not existing yet — see CLOUDKIT_SCHEMA_PROMOTION.md) produced no error,
/// no log entry, nothing: sync would just never work, with no signal why.
struct CloudKitEventHandlingTests {
    private struct StubError: Error, LocalizedError {
        var errorDescription: String? { "stub failure" }
    }

    // MARK: - RecordingSyncStore.syncEffect

    @available(iOS 17, macOS 14, *)
    @Test func recordingSetupFailureProducesErrorEffect() {
        let effect = RecordingSyncStore.syncEffect(
            type: .setup,
            succeeded: false,
            endDate: Date(),
            error: StubError()
        )
        #expect(effect == .recordError(message: "CloudKit setup failed: stub failure"))
    }

    @available(iOS 17, macOS 14, *)
    @Test func recordingSetupSuccessIsLogOnlyNoReload() {
        let effect = RecordingSyncStore.syncEffect(
            type: .setup,
            succeeded: true,
            endDate: Date(),
            error: nil
        )
        // Logging itself happens unconditionally in the observer (outside this reducer); the
        // reducer's job is only the follow-up mutation, and `.setup` succeeding has none.
        #expect(effect == .none)
    }

    @available(iOS 17, macOS 14, *)
    @Test func recordingImportSuccessReloadsAndStampsLastImport() {
        let endDate = Date()
        let effect = RecordingSyncStore.syncEffect(
            type: .import,
            succeeded: true,
            endDate: endDate,
            error: nil
        )
        #expect(effect == .importSucceeded(endDate: endDate))
    }

    @available(iOS 17, macOS 14, *)
    @Test func recordingExportSuccessStampsLastExport() {
        let endDate = Date()
        let effect = RecordingSyncStore.syncEffect(
            type: .export,
            succeeded: true,
            endDate: endDate,
            error: nil
        )
        #expect(effect == .exportSucceeded(endDate: endDate))
    }

    @available(iOS 17, macOS 14, *)
    @Test func recordingImportFailureProducesErrorEffect() {
        let effect = RecordingSyncStore.syncEffect(
            type: .import,
            succeeded: false,
            endDate: Date(),
            error: StubError()
        )
        #expect(effect == .recordError(message: "CloudKit import failed: stub failure"))
    }

    @available(iOS 17, macOS 14, *)
    @Test func recordingExportFailureProducesErrorEffect() {
        let effect = RecordingSyncStore.syncEffect(
            type: .export,
            succeeded: false,
            endDate: Date(),
            error: StubError()
        )
        #expect(effect == .recordError(message: "CloudKit export failed: stub failure"))
    }

    // A failure with no attached error is logged by the observer but has nothing for the reducer
    // to surface — mirrors the pre-existing behavior (only `else if let error` recorded).
    @available(iOS 17, macOS 14, *)
    @Test func recordingFailureWithoutErrorIsNoEffect() {
        let effect = RecordingSyncStore.syncEffect(
            type: .import,
            succeeded: false,
            endDate: Date(),
            error: nil
        )
        #expect(effect == .none)
    }

    // An in-flight event (`endDate == nil`) never produces a follow-up effect, regardless of type.
    @available(iOS 17, macOS 14, *)
    @Test func recordingInFlightEventIsNoEffect() {
        #expect(RecordingSyncStore.syncEffect(type: .setup, succeeded: false, endDate: nil, error: StubError()) == .none)
        #expect(RecordingSyncStore.syncEffect(type: .import, succeeded: true, endDate: nil, error: nil) == .none)
        #expect(RecordingSyncStore.syncEffect(type: .export, succeeded: true, endDate: nil, error: nil) == .none)
    }

    @available(iOS 17, macOS 14, *)
    @Test func recordingKindLabelCoversAllThreeTypes() {
        #expect(RecordingSyncStore.kindLabel(for: .setup) == "setup")
        #expect(RecordingSyncStore.kindLabel(for: .import) == "import")
        #expect(RecordingSyncStore.kindLabel(for: .export) == "export")
    }

    // MARK: - DigestSyncStore.syncEffect

    @available(iOS 17, macOS 14, *)
    @Test func digestSetupFailureProducesErrorEffect() {
        let effect = DigestSyncStore.syncEffect(
            type: .setup,
            succeeded: false,
            endDate: Date(),
            error: StubError()
        )
        #expect(effect == .recordError(message: "CloudKit setup failed: stub failure"))
    }

    @available(iOS 17, macOS 14, *)
    @Test func digestSetupSuccessIsNoEffect() {
        let effect = DigestSyncStore.syncEffect(
            type: .setup,
            succeeded: true,
            endDate: Date(),
            error: nil
        )
        #expect(effect == .none)
    }

    @available(iOS 17, macOS 14, *)
    @Test func digestImportSuccessReloadsAndStampsLastImport() {
        let endDate = Date()
        let effect = DigestSyncStore.syncEffect(
            type: .import,
            succeeded: true,
            endDate: endDate,
            error: nil
        )
        #expect(effect == .importSucceeded(endDate: endDate))
    }

    @available(iOS 17, macOS 14, *)
    @Test func digestExportSuccessStampsLastExport() {
        let endDate = Date()
        let effect = DigestSyncStore.syncEffect(
            type: .export,
            succeeded: true,
            endDate: endDate,
            error: nil
        )
        #expect(effect == .exportSucceeded(endDate: endDate))
    }

    @available(iOS 17, macOS 14, *)
    @Test func digestImportFailureProducesErrorEffect() {
        let effect = DigestSyncStore.syncEffect(
            type: .import,
            succeeded: false,
            endDate: Date(),
            error: StubError()
        )
        #expect(effect == .recordError(message: "CloudKit import failed: stub failure"))
    }

    @available(iOS 17, macOS 14, *)
    @Test func digestInFlightEventIsNoEffect() {
        #expect(DigestSyncStore.syncEffect(type: .setup, succeeded: false, endDate: nil, error: StubError()) == .none)
        #expect(DigestSyncStore.syncEffect(type: .import, succeeded: true, endDate: nil, error: nil) == .none)
    }
}
