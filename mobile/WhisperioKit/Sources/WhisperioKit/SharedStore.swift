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

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }

    private enum Key {
        static let pendingTranscript = "kbd.pendingTranscript"
        static let pendingCreatedAt  = "kbd.pendingTranscript.createdAt"
        static let appHeartbeat      = "kbd.appHeartbeat"          // app writes; keyboard never needs it
        static let keyboardHeartbeat = "kbd.keyboardHeartbeat"     // keyboard writes; app reads to detect install
        static let swipeBackExplainerShown = "kbd.swipeBackExplainerShown"
    }

    // MARK: - Transcript handoff (app → keyboard)

    /// Called by the app after a keyboard-initiated dictation finishes.
    public static func setPendingTranscript(_ text: String) {
        guard let d = defaults else { return }
        d.set(text, forKey: Key.pendingTranscript)
        d.set(Date().timeIntervalSince1970, forKey: Key.pendingCreatedAt)
    }

    /// Called by the keyboard when it reappears; returns the transcript once, then clears it.
    /// `maxAge` guards against inserting a stale transcript from a much earlier session.
    public static func consumePendingTranscript(maxAge: TimeInterval = 600) -> String? {
        guard let d = defaults,
              let text = d.string(forKey: Key.pendingTranscript), !text.isEmpty else { return nil }
        let created = d.double(forKey: Key.pendingCreatedAt)
        defer {
            d.removeObject(forKey: Key.pendingTranscript)
            d.removeObject(forKey: Key.pendingCreatedAt)
        }
        if created > 0, Date().timeIntervalSince1970 - created > maxAge { return nil }
        return text
    }

    public static var hasPendingTranscript: Bool {
        (defaults?.string(forKey: Key.pendingTranscript)?.isEmpty == false)
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
}
