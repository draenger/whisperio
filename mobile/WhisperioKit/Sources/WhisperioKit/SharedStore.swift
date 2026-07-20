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
        static let widgetSnapshot    = "widget.snapshot.v1"
        static let engineOnDevice    = "engine.isOnDevice"         // app writes; keyboard reads for its privacy chip
    }

    // MARK: - Engine privacy flag (app → keyboard)

    /// The app records whether the PRIMARY transcription engine is on-device whenever settings
    /// are saved, so the keyboard extension's privacy chip can tell the truth instead of
    /// promising "on-device" unconditionally. Reads return nil when the flag has never been
    /// written (or the App Group container isn't available) — callers must treat nil as
    /// "unknown" and make no claim.
    public static func setEngineOnDevice(_ onDevice: Bool) {
        defaults?.set(onDevice, forKey: Key.engineOnDevice)
    }

    public static func engineOnDevice() -> Bool? {
        guard let d = defaults, d.object(forKey: Key.engineOnDevice) != nil else { return nil }
        return d.bool(forKey: Key.engineOnDevice)
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

    // MARK: - Widget snapshot (app → WidgetKit extension)

    /// One row of the "Recent" widget's list — a lightweight mirror of a real `Recording`, not a
    /// fabricated placeholder. `iconSystemName` is derived from real recording metadata
    /// (conversation vs. plain dictation), not a per-app source (Whisperio has no share-sheet
    /// "recorded from" concept to report).
    public struct WidgetRecentRecording: Codable, Sendable, Equatable, Identifiable {
        public var id: UUID
        public var title: String
        public var iconSystemName: String
        public var timestamp: Date

        public init(id: UUID, title: String, iconSystemName: String, timestamp: Date) {
            self.id = id
            self.title = title
            self.iconSystemName = iconSystemName
            self.timestamp = timestamp
        }
    }

    /// Everything the WidgetKit extension needs to render the CONCEPT widgets, written by the
    /// app whenever the underlying data changes. Every field mirrors something the app already
    /// computes for its own UI (RecapView's streak/word-count math, DigestStore's daily
    /// summaries) — the widget process just can't reach `RecordingsStore`/`DigestStore`
    /// directly, so this is the exported read-only snapshot. A missing/absent snapshot (fresh
    /// install, no App Group access yet) must render an empty state — never fall back to fake
    /// numbers.
    public struct WidgetSnapshot: Codable, Sendable, Equatable {
        /// Most recent recordings, newest first, capped by the writer (~5) for the "Recent" widget.
        public var recentRecordings: [WidgetRecentRecording]
        /// Total library size for the "Recent" widget's trailing "N notes" label. Optional so
        /// snapshots written before this field existed keep decoding — nil hides the label.
        public var totalRecordings: Int?
        /// Words spoken today (calendar day), for the "This week" widget's headline number.
        public var todayWordCount: Int
        /// Word counts for the trailing 7 days, oldest first (index 6 = today) — the bar chart.
        public var weeklyWordCounts: [Int]
        /// Current days-with-a-note streak (same definition as RecapView.streaks.current).
        public var currentStreak: Int
        /// Today's digest summary text, if one has been generated yet.
        public var digestText: String?
        /// Number of recordings folded into today's digest.
        public var digestNoteCount: Int
        /// Number of distinct categories represented in today's digest.
        public var digestCategoryCount: Int
        /// Whether today's digest summary was produced by a cloud model (AI woven) rather than
        /// assembled on-device (raw stack / manual authoring). Optional so snapshots written
        /// before this field existed keep decoding — nil means "unknown", and the widget makes
        /// no privacy claim for it.
        public var digestIsCloud: Bool?
        /// When this snapshot was written — lets a widget show a stale/last-updated hint if ever needed.
        public var updatedAt: Date

        public init(
            recentRecordings: [WidgetRecentRecording] = [],
            totalRecordings: Int? = nil,
            todayWordCount: Int = 0,
            weeklyWordCounts: [Int] = Array(repeating: 0, count: 7),
            currentStreak: Int = 0,
            digestText: String? = nil,
            digestNoteCount: Int = 0,
            digestCategoryCount: Int = 0,
            digestIsCloud: Bool? = nil,
            updatedAt: Date = Date()
        ) {
            self.recentRecordings = recentRecordings
            self.totalRecordings = totalRecordings
            self.todayWordCount = todayWordCount
            self.weeklyWordCounts = weeklyWordCounts
            self.currentStreak = currentStreak
            self.digestText = digestText
            self.digestNoteCount = digestNoteCount
            self.digestCategoryCount = digestCategoryCount
            self.digestIsCloud = digestIsCloud
            self.updatedAt = updatedAt
        }
    }

    /// The last snapshot written by the app, or `nil` if none has ever been written (fresh
    /// install / App Group unavailable) — callers must treat `nil` as "show an empty state",
    /// never substitute placeholder data.
    public static var widgetSnapshot: WidgetSnapshot? {
        guard let d = defaults, let data = d.data(forKey: Key.widgetSnapshot) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    /// Overwrite the whole snapshot. Prefer `updateWidgetSnapshot(_:)` from a call site that only
    /// owns part of the data (e.g. `RecordingsStore` shouldn't clobber the digest fields
    /// `DigestStore` last wrote, and vice versa).
    public static func setWidgetSnapshot(_ snapshot: WidgetSnapshot) {
        guard let d = defaults, let data = try? JSONEncoder().encode(snapshot) else { return }
        d.set(data, forKey: Key.widgetSnapshot)
    }

    /// Read-modify-write the snapshot: starts from the last written snapshot (or a fresh empty
    /// one on first write), applies `mutate`, stamps `updatedAt`, and persists. This is what lets
    /// `RecordingsStore` and `DigestStore` each update only the fields they own without racing
    /// each other's writes.
    public static func updateWidgetSnapshot(_ mutate: (inout WidgetSnapshot) -> Void) {
        var snapshot = widgetSnapshot ?? WidgetSnapshot()
        mutate(&snapshot)
        snapshot.updatedAt = Date()
        setWidgetSnapshot(snapshot)
    }
}
