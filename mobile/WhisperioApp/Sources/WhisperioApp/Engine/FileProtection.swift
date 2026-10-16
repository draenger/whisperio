import Foundation
import WhisperioKit
#if os(iOS)
import UIKit
#endif

// iOS Data Protection for user audio and transcript files. No-ops on macOS (the Mac app keeps its
// behaviour; `FileProtectionType` / the protection write options are iOS-family APIs).
//
//  - `.complete`: readable only while the device is unlocked. Only for files created AND read in
//    the foreground (kept audio clips, sync manifest).
//  - `.completeUnlessOpen`: a file can be CREATED while locked and stays usable while it is held
//    open, but once CLOSED it cannot be opened again until the device is unlocked. Use it only
//    for write-once files that are never reopened while locked (e.g. a Watch clip that is kept
//    and played back later while unlocked).
//  - `.completeUntilFirstUserAuthentication` (the iOS default, set explicitly): usable any time
//    after the first unlock since boot. Use it for everything that is closed and then re-read
//    possibly while locked: the live recording (read back on stop), temp copies re-opened by a
//    speech engine, Watch clips re-read in handle(), recordings.json.
//
// SwiftData / CloudKit store files are deliberately NOT touched here (SwiftData manages them).
enum FileProtection {
    /// `Data.write(to:options:)` option for the policy class of `kind` (empty off iOS).
    @MainActor static func writeOptions(_ kind: FileProtectionPolicy.Kind) -> Data.WritingOptions {
        writeOptionsNonisolated(kind, available: isProtectedDataAvailable)
    }

    static func writeOptionsNonisolated(_ kind: FileProtectionPolicy.Kind, available: Bool) -> Data.WritingOptions {
        #if os(iOS)
        switch FileProtectionPolicy.classFor(kind, protectedDataAvailable: available) {
        case .complete: return .completeFileProtection
        case .completeUnlessOpen: return .completeFileProtectionUnlessOpen
        default: return .completeFileProtectionUntilFirstUserAuthentication
        }
        #else
        return []
        #endif
    }

    /// True when protected data can currently be accessed (always true off iOS).
    @MainActor static var isProtectedDataAvailable: Bool {
        #if os(iOS)
        return UIApplication.shared.isProtectedDataAvailable
        #else
        return true
        #endif
    }

    /// Best-effort: failure keeps the previous class, never weaker than the platform default.
    static func apply(_ kind: FileProtectionPolicy.Kind, to url: URL, protectedDataAvailable: Bool = true) {
        #if os(iOS)
        let type = FileProtectionPolicy.classFor(kind, protectedDataAvailable: protectedDataAvailable)
        try? FileManager.default.setAttributes([.protectionKey: type], ofItemAtPath: url.path)
        #endif
    }
}
