import Foundation

// iOS Data Protection for user audio and transcript files. No-ops on macOS (the Mac app keeps its
// behaviour; `FileProtectionType` / the protection write options are iOS-family APIs).
//
//  - `.complete`: readable only while the device is unlocked. For files only touched in the
//    foreground (kept audio clips, sync manifest).
//  - `.completeUnlessOpen`: a file can be CREATED while locked and stays readable/writable once
//    opened. For anything written while the phone may be locked: the live recording (background
//    audio mode keeps the session alive past the lock) and Watch-delivered clips/transcripts
//    that arrive in the background.
//
// SwiftData / CloudKit store files are deliberately NOT touched here (SwiftData manages them).
enum FileProtection {
    /// `Data.write(to:options:)` option for files written while the device may be locked.
    static var unlessOpenWriteOption: Data.WritingOptions {
        #if os(iOS)
        return .completeFileProtectionUnlessOpen
        #else
        return []
        #endif
    }

    /// `Data.write(to:options:)` option for files only written while unlocked.
    static var completeWriteOption: Data.WritingOptions {
        #if os(iOS)
        return .completeFileProtection
        #else
        return []
        #endif
    }

    /// Best-effort: failure (e.g. the device is locked and the file is already protected) keeps
    /// the previous class, which is still never weaker than the platform default.
    static func complete(_ url: URL) { apply(.complete, to: url) }
    static func completeUnlessOpen(_ url: URL) { apply(.unlessOpen, to: url) }

    private enum Level { case complete, unlessOpen }

    private static func apply(_ level: Level, to url: URL) {
        #if os(iOS)
        let type: FileProtectionType = level == .complete ? .complete : .completeUnlessOpen
        try? FileManager.default.setAttributes([.protectionKey: type], ofItemAtPath: url.path)
        #endif
    }
}
