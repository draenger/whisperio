import Foundation

/// Which iOS Data Protection class each kind of user file gets. Pure so the decision (which
/// previously risked data loss) is unit-tested. `.completeUnlessOpen` files can be created while
/// locked but, once closed, cannot be reopened until unlock — so it is only right for write-once
/// files that are never reopened while locked.
public enum FileProtectionPolicy {
    public enum Kind: Sendable, CaseIterable {
        /// Live mic recording (background audio): closed and re-read on stop, possibly locked.
        case liveRecording
        /// Watch clip copied to tmp, re-read in handle() / by the player, possibly locked.
        case watchClip
        /// Watch clip written once into the kept-audio folder, only reopened while unlocked.
        case watchKeptClipWrite
        /// Kept clip moved into Documents/Audio, only read in the foreground.
        case keptClip
        /// recordings.json fallback store: written/re-read while the phone may be locked.
        case jsonFallback
        /// Temp copy re-opened by a speech engine.
        case tempCopy
    }

    public static func classFor(_ kind: Kind, protectedDataAvailable: Bool = true) -> FileProtectionType {
        switch kind {
        case .liveRecording, .watchClip, .jsonFallback, .tempCopy:
            return .completeUntilFirstUserAuthentication
        case .watchKeptClipWrite:
            return .completeUnlessOpen
        case .keptClip:
            // `.complete` can only be applied while unlocked; otherwise keep the default class.
            return protectedDataAvailable ? .complete : .completeUntilFirstUserAuthentication
        }
    }
}

/// Guards recordings.json against clobbering: if reading the file failed (e.g. device locked),
/// `items` is empty while the file still holds history, so saves must wait for a successful load.
public struct JSONFallbackGuard: Sendable, Equatable {
    public private(set) var loadFailed = false
    public init() {}
    public var saveAllowed: Bool { !loadFailed }
    public mutating func markLoadFailed() { loadFailed = true }
    public mutating func markLoaded() { loadFailed = false }
}
