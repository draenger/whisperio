import Foundation

/// Cross-process bridge between the main app and the Whisperio keyboard extension,
/// backed by a shared App Group `UserDefaults` suite.
///
/// The keyboard cannot record or transcribe itself (no mic / no full audio session in
/// an extension), so it uses a **bounce-to-app** flow: it opens the app via a custom URL
/// to dictate, the app writes the transcript here, and when the user swipes back to the
/// keyboard it reads the pending transcript and inserts it. Honest about iOS limits:
/// there is no silent background paste — the user physically returns to the keyboard.
public enum SharedStore {
    /// The App Group identifier. This MUST match the App Group capability added to both the
    /// app and keyboard targets in Xcode (Signing & Capabilities → App Groups).
    public static let appGroupID = "group.ai.whisperio.mobile"

    /// Custom URL the keyboard opens to start a bounce-to-app dictation.
    public static let dictateURL = URL(string: "whisperio://dictate?return=keyboard")!
    /// Custom URL the keyboard opens to start a rewrite hand-off.
    public static let rewriteURL = URL(string: "whisperio://rewrite?return=keyboard")!

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }

    private enum Key {
        static let pendingTranscript = "kbd.pendingTranscript"
        static let pendingCreatedAt  = "kbd.pendingTranscript.createdAt"
        static let lastInsertedTranscript = "kbd.lastInsertedTranscript"
        static let appHeartbeat      = "kbd.appHeartbeat"          // app writes; keyboard never needs it
        static let keyboardHeartbeat = "kbd.keyboardHeartbeat"     // keyboard writes; app reads to detect install
        static let swipeBackExplainerShown = "kbd.swipeBackExplainerShown"
        static let recordingActive   = "kbd.recordingActive"
        static let recordingStartedAt = "kbd.recordingStartedAt"
        static let rewriteSource     = "kbd.rewriteSource"
        static let rewritePresetID   = "kbd.rewritePresetID"
        static let rewriteResult     = "kbd.rewriteResult"
        static let rewriteResultAt   = "kbd.rewriteResultAt"
    }

    // MARK: - Transcript handoff (app → keyboard)

    /// How long a pending transcript is considered fresh. Past this it is treated as stale and
    /// eagerly cleared, so dictated text is never retained in the shared container indefinitely.
    public static let pendingTranscriptMaxAge: TimeInterval = 600

    /// Called by the app after a keyboard-initiated dictation finishes.
    public static func setPendingTranscript(_ text: String) {
        guard let d = defaults else { return }
        d.set(text, forKey: Key.pendingTranscript)
        d.set(Date().timeIntervalSince1970, forKey: Key.pendingCreatedAt)
    }

    /// Called by the keyboard when it reappears; returns the transcript once, then clears it.
    /// `maxAge` guards against inserting a stale transcript from a much earlier session.
    public static func consumePendingTranscript(maxAge: TimeInterval = pendingTranscriptMaxAge) -> String? {
        guard let d = defaults,
              let text = d.string(forKey: Key.pendingTranscript), !text.isEmpty else { return nil }
        let created = d.double(forKey: Key.pendingCreatedAt)
        defer { clearPendingTranscript() }
        if created > 0, Date().timeIntervalSince1970 - created > maxAge { return nil }
        return text
    }

    /// Unconditionally drop any pending transcript from the shared container.
    public static func clearPendingTranscript() {
        guard let d = defaults else { return }
        d.removeObject(forKey: Key.pendingTranscript)
        d.removeObject(forKey: Key.pendingCreatedAt)
    }

    public static func setLastInsertedTranscript(_ text: String) {
        defaults?.set(text, forKey: Key.lastInsertedTranscript)
    }

    public static var lastInsertedTranscript: String? {
        defaults?.string(forKey: Key.lastInsertedTranscript)
    }

    public static func clearLastInsertedTranscript() {
        defaults?.removeObject(forKey: Key.lastInsertedTranscript)
    }

    /// Eagerly remove a pending transcript once it is older than `maxAge` (or carries no
    /// timestamp). Safe to call on every app foreground/background — a *fresh* transcript that
    /// is still awaiting the user's swipe back to the keyboard is preserved. This is what
    /// bounds the on-disk lifetime instead of relying on a future `consume` that may never come.
    public static func purgeStalePendingTranscript(maxAge: TimeInterval = pendingTranscriptMaxAge) {
        guard let d = defaults, d.object(forKey: Key.pendingTranscript) != nil else { return }
        let created = d.double(forKey: Key.pendingCreatedAt)
        if created <= 0 || Date().timeIntervalSince1970 - created > maxAge {
            clearPendingTranscript()
        }
    }

    public static var hasPendingTranscript: Bool {
        guard let d = defaults,
              let text = d.string(forKey: Key.pendingTranscript), !text.isEmpty else { return false }
        let created = d.double(forKey: Key.pendingCreatedAt)
        if created <= 0 || Date().timeIntervalSince1970 - created > pendingTranscriptMaxAge {
            clearPendingTranscript()   // read-time TTL: a stale transcript is gone, not just hidden
            return false
        }
        return true
    }

    // MARK: - Heartbeats (install / full-access detection)

    /// The keyboard writes this whenever its view loads. The app reads `keyboardEverLoaded`
    /// to reliably detect that the keyboard has been added & opened at least once — something
    /// iOS otherwise gives no API for.
    public static func recordKeyboardHeartbeat() {
        defaults?.set(Date().timeIntervalSince1970, forKey: Key.keyboardHeartbeat)
    }

    public static var keyboardEverLoaded: Bool {
        (defaults?.double(forKey: Key.keyboardHeartbeat) ?? 0) > 0
    }

    public static var lastKeyboardHeartbeat: Date? {
        guard let ts = defaults?.double(forKey: Key.keyboardHeartbeat), ts > 0 else { return nil }
        return Date(timeIntervalSince1970: ts)
    }

    public static func recordAppHeartbeat() {
        defaults?.set(Date().timeIntervalSince1970, forKey: Key.appHeartbeat)
    }

    // MARK: - One-time swipe-back explainer

    public static var swipeBackExplainerShown: Bool {
        get { defaults?.bool(forKey: Key.swipeBackExplainerShown) ?? false }
        set { defaults?.set(newValue, forKey: Key.swipeBackExplainerShown) }
    }

    // MARK: - Recording state (app ↔ keyboard)

    /// The app marks this while a dictation session is live. The keyboard uses it to show a
    /// live "Listening" state instead of pretending the mic is idle after the app has been
    /// backgrounded.
    public static func setRecordingActive(_ active: Bool) {
        guard let d = defaults else { return }
        d.set(active, forKey: Key.recordingActive)
        if active {
            d.set(Date().timeIntervalSince1970, forKey: Key.recordingStartedAt)
        } else {
            d.removeObject(forKey: Key.recordingStartedAt)
        }
    }

    public static var recordingActive: Bool {
        defaults?.bool(forKey: Key.recordingActive) ?? false
    }

    public static var recordingStartedAt: Date? {
        guard let ts = defaults?.double(forKey: Key.recordingStartedAt), ts > 0 else { return nil }
        return Date(timeIntervalSince1970: ts)
    }

    // MARK: - Keyboard rewrite handoff

    /// The keyboard stores the most recent dictated text here, then opens the app to run one
    /// of the shipped rewrite prompts. The app consumes this, rewrites it, and writes the
    /// replacement back into `rewriteResult`.
    public static func setRewriteSource(_ text: String) {
        guard let d = defaults else { return }
        d.set(text, forKey: Key.rewriteSource)
        d.removeObject(forKey: Key.rewriteResult)
        d.removeObject(forKey: Key.rewriteResultAt)
    }

    public static func consumeRewriteSource() -> String? {
        guard let d = defaults,
              let text = d.string(forKey: Key.rewriteSource), !text.isEmpty else { return nil }
        d.removeObject(forKey: Key.rewriteSource)
        return text
    }

    public static func setRewritePresetID(_ id: String) {
        defaults?.set(id, forKey: Key.rewritePresetID)
    }

    public static func consumeRewritePresetID() -> String? {
        guard let d = defaults,
              let id = d.string(forKey: Key.rewritePresetID), !id.isEmpty else { return nil }
        d.removeObject(forKey: Key.rewritePresetID)
        return id
    }

    public static func setRewriteResult(_ text: String) {
        guard let d = defaults else { return }
        d.set(text, forKey: Key.rewriteResult)
        d.set(Date().timeIntervalSince1970, forKey: Key.rewriteResultAt)
    }

    public static func consumeRewriteResult(maxAge: TimeInterval = pendingTranscriptMaxAge) -> String? {
        guard let d = defaults,
              let text = d.string(forKey: Key.rewriteResult), !text.isEmpty else { return nil }
        let created = d.double(forKey: Key.rewriteResultAt)
        defer {
            d.removeObject(forKey: Key.rewriteResult)
            d.removeObject(forKey: Key.rewriteResultAt)
        }
        if created > 0, Date().timeIntervalSince1970 - created > maxAge { return nil }
        return text
    }
}
