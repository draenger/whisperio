import Foundation
import Combine
import os
import SwiftData
import WhisperioKit
import WidgetKit

// Real, persisted recordings. Prefers the SwiftData + CloudKit-backed RecordingSyncStore
// (WhisperioKit) so history follows the user across devices; falls back to the legacy JSON
// file in Documents when the CloudKit container can't be built (e.g. no iCloud account, or a
// pre-iOS-17 host). The class name + @MainActor ObservableObject surface are unchanged, so
// every @EnvironmentObject consumer stays untouched.
@MainActor
final class RecordingsStore: ObservableObject {
    struct SyncQueueItem: Identifiable, Equatable {
        enum Kind: String {
            case add = "Add"
            case delete = "Delete"
            case category = "Category"
            case render = "Rewrite"
            case speakers = "Speakers"
            case retranscribe = "Retranscribe"
            case migrate = "Migrate"
            case refresh = "Pull"
            case clearTranscripts = "Clear transcripts"
        }

        let id = UUID()
        let timestamp: Date
        let kind: Kind
        let title: String
        let detail: String
        let recordID: UUID?
    }

    // Every mutation path — add, delete, category/render/transcription edits, and remote
    // CloudKit arrivals mirrored by the syncStore sink — flows through this property, so the
    // widget snapshot refreshes here exactly once per change instead of being hand-wired into
    // individual mutators (which left the Recent/This-week widgets stale after deletes/sync).
    @Published private(set) var items: [Recording] = [] {
        didSet { refreshWidgetSnapshot() }
    }

    // True while the CloudKit-backed store is actively importing/exporting. Forwarded from the
    // synced store's own `isSyncing`; always false for the JSON backend.
    @Published private(set) var isSyncing = false

    // Whether the live library is iCloud-backed (SwiftData + CloudKit). Drives the UI's iCloud
    // badge. False for the JSON fallback.
    @Published private(set) var isCloudBacked = false

    // Last local CloudKit/SwiftData error reported by the live store. Nil for JSON fallback.
    @Published private(set) var lastErrorMessage: String?
    @Published private(set) var pendingSyncQueue: [SyncQueueItem] = []
    @Published private(set) var recentSyncEvents: [RecordingSyncStore.EventLogEntry] = []
    @Published private(set) var lastImportAt: Date?
    @Published private(set) var lastExportAt: Date?

    // True when the user's storage choice is iCloud but the live library isn't CloudKit-backed
    // — the device fell back to local-only (no account at launch, or container init failed) and
    // is pinned there for the process's lifetime (the ModelConfiguration is fixed at init; see
    // the NOTE on RecordingSyncStore.init). Read by the Settings banner to offer a one-tap
    // "Resume iCloud sync" instead of leaving this silent.
    @Published private(set) var iCloudResumeAvailable = false

    // Exactly one backend is live for the process. `.sync` delegates to the synced store and
    // mirrors its published items; `.json` keeps the original file-backed behaviour.
    private enum Backend {
        case sync(RecordingSyncStore)
        case json(URL)
    }
    private var backend: Backend

    // Keeps our published `items` in step with the synced store's own @Published items.
    private var syncCancellable: AnyCancellable?
    // Keeps our published `isSyncing` in step with the synced store's own @Published flag.
    private var syncStateCancellable: AnyCancellable?
    // Keeps our published `lastErrorMessage` in step with the synced store's own diagnostics.
    private var syncErrorCancellable: AnyCancellable?
    private var syncEventsCancellable: AnyCancellable?
    private var syncImportCancellable: AnyCancellable?
    private var syncExportCancellable: AnyCancellable?

    // Retained token for the iCloud account-availability observer (see `observeICloudAvailability`).
    // Kept for the store's lifetime, same as `RecordingSyncStore.cloudEventObserver`.
    private var ubiquityObserver: NSObjectProtocol?
    // Guards `attemptICloudResume()` against re-entrancy: the ubiquity notification can fire
    // more than once in quick succession, and a migration is already in flight the moment it's
    // kicked off (before `isCloudBacked` flips), so this is the only signal that stops a second
    // call from racing the first and double-migrating the library.
    private var resumeInFlight = false

    init() {
        // iOS 17+ (the app's deployment floor) with a reachable container → synced store, which
        // also runs the one-time recordings.json → SwiftData migration on init. Any init failure
        // (missing container, no iCloud) drops to the JSON fallback so history is never lost.
        if #available(iOS 17, macOS 14, *) {
            do {
                let store = try RecordingSyncStore()
                backend = .sync(store)
                attach(syncStore: store)
                observeICloudAvailability()
                return
            } catch {
                Self.log.error("RecordingSyncStore init failed, falling back to JSON: \(error.localizedDescription)")
            }
        }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = docs.appendingPathComponent("recordings.json")
        backend = .json(url)
        isCloudBacked = false
        loadJSON(from: url)
        updateICloudResumeAvailability()
        observeICloudAvailability()
    }

    deinit {
        if let ubiquityObserver {
            NotificationCenter.default.removeObserver(ubiquityObserver)
        }
    }

    /// The user's persisted storage choice, decoded straight from the same UserDefaults blob
    /// `RecordingSyncStore` reads (`RecordingSyncStore.settingsDefaultsKey`). Mirrors that
    /// store's own `persistedStorageMode()` (private there — WhisperioApp has no compile
    /// dependency on `SettingsStore`, so it decodes the blob itself rather than reaching across
    /// the module boundary).
    private static func persistedStorageMode() -> StorageMode {
        guard let data = UserDefaults.standard.data(forKey: RecordingSyncStore.settingsDefaultsKey),
              let s = try? JSONDecoder().decode(WhisperioSettings.self, from: data) else {
            return .iCloud
        }
        return s.storageMode
    }

    private func updateICloudResumeAvailability() {
        iCloudResumeAvailable = RecordingSync.iCloudResumeMismatch(
            storageMode: Self.persistedStorageMode(),
            isCloudBacked: isCloudBacked
        )
    }

    /// Watches for the iCloud account identity changing — in particular, becoming available
    /// again after being absent, which is exactly the moment a device that fell back to
    /// local-only at launch can resume syncing without waiting for the user to stumble onto the
    /// manual "Move library to iCloud" toggle. When the account returns, the user's choice is
    /// still `.iCloud`, and this device is still non-cloud-backed, proactively migrate the
    /// current library into a fresh CloudKit-backed store. `resumeInFlight` guards against a
    /// second notification racing the first; `iCloudResumeAvailable` itself is recomputed after
    /// the attempt so the Settings banner still offers a manual retry if the migration failed
    /// (e.g. the account flickered again before the migration completed).
    private func observeICloudAvailability() {
        // The observer delivers on the main queue, so — mirroring
        // `RecordingSyncStore.observeCloudKitEvents` — we hop to the MainActor via
        // `assumeIsolated` rather than a `Task` hop.
        ubiquityObserver = NotificationCenter.default.addObserver(
            forName: .NSUbiquityIdentityDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.attemptICloudResumeIfNeeded()
            }
        }
    }

    @MainActor
    private func attemptICloudResumeIfNeeded() {
        updateICloudResumeAvailability()
        guard iCloudResumeAvailable, !resumeInFlight else { return }
        guard FileManager.default.ubiquityIdentityToken != nil else { return }
        resumeInFlight = true
        defer { resumeInFlight = false }
        do {
            try migrateCurrentLibraryToCloud()
        } catch {
            Self.log.error("Auto-resume iCloud sync failed: \(error.localizedDescription)")
        }
        updateICloudResumeAvailability()
    }

    /// Promote the current library into the iCloud-backed SwiftData store and switch the live
    /// backend over immediately. Callers typically pair this with `settings.storageMode = .iCloud`.
    /// The caller chooses whether to surface the success/failure to the user.
    @MainActor
    func migrateCurrentLibraryToCloud() throws {
        guard #available(iOS 17, macOS 14, *) else { return }
        // Same on-disk file the convenience init opens (`RecordingSync.storeURL()`), not the
        // unnamed-config default — otherwise this migration would collide with
        // `DigestSyncStore`'s cache file on the shared `default.store` path.
        let cloudConfig = ModelConfiguration(
            url: try RecordingSync.storeURL(),
            cloudKitDatabase: .private(RecordingSyncStore.cloudKitContainerID)
        )
        let cloudStore = try RecordingSyncStore(configuration: cloudConfig, isCloudBacked: true)
        queueSync(.migrate, title: "Library migration",
                  detail: "Moving local library to CloudKit", recordID: nil)
        cloudStore.add(items)
        backend = .sync(cloudStore)
        attach(syncStore: cloudStore)
    }

    private func attach(syncStore: RecordingSyncStore) {
        syncCancellable = nil
        syncStateCancellable = nil
        syncErrorCancellable = nil
        syncEventsCancellable = nil
        syncImportCancellable = nil
        syncExportCancellable = nil
        isCloudBacked = syncStore.isCloudBacked
        items = syncStore.items
        isSyncing = syncStore.isSyncing
        lastErrorMessage = syncStore.lastErrorMessage
        recentSyncEvents = syncStore.recentEvents
        lastImportAt = syncStore.lastImportAt
        lastExportAt = syncStore.lastExportAt
        syncCancellable = syncStore.$items.sink { [weak self] in self?.items = $0 }
        syncStateCancellable = syncStore.$isSyncing.sink { [weak self] in self?.isSyncing = $0 }
        syncErrorCancellable = syncStore.$lastErrorMessage.sink { [weak self] in self?.lastErrorMessage = $0 }
        syncEventsCancellable = syncStore.$recentEvents.sink { [weak self] in self?.recentSyncEvents = $0 }
        syncImportCancellable = syncStore.$lastImportAt.sink { [weak self] in
            self?.lastImportAt = $0
            self?.flushPendingQueue()
        }
        syncExportCancellable = syncStore.$lastExportAt.sink { [weak self] in
            self?.lastExportAt = $0
            self?.flushPendingQueue()
        }
        updateICloudResumeAvailability()
    }

    func add(_ r: Recording) {
        switch backend {
        case .sync(let store):
            queueSync(.add, title: r.transcription ?? "Recording", detail: r.id.uuidString, recordID: r.id)
            store.add(r)
        case .json(let url):
            upsertJSON(r)
            saveJSON(to: url)
        }
    }

    // MARK: - Widget snapshot (recordings-owned fields)

    /// Exports the recordings-owned slice of the WidgetKit snapshot (recent list, today's word
    /// count, 7-day word counts, streak) — real numbers straight off `items`, the same math
    /// `RecapView` already does for its own UI. Leaves the digest fields `DigestStore` owns
    /// untouched. Runs from `items.didSet`, so every mutation and sync arrival refreshes it.
    private func refreshWidgetSnapshot() {
        var calendar = Calendar.current
        calendar.firstWeekday = 2   // Mon…Sun, matching RecapView

        func wordCount(_ r: Recording) -> Int {
            (r.transcription ?? "").split { $0.isWhitespace || $0.isNewline }.count
        }

        let today = calendar.startOfDay(for: Date())
        let recentRecordings = items
            .filter { $0.status == .completed && !($0.transcription ?? "").isEmpty }
            .sorted { $0.timestamp > $1.timestamp }
            .prefix(5)
            .map {
                SharedStore.WidgetRecentRecording(
                    id: $0.id,
                    title: $0.transcription ?? "",
                    iconSystemName: $0.isConversation ? "person.2.fill" : "mic.fill",
                    timestamp: $0.timestamp
                )
            }

        // Trailing 7 days, oldest first (index 6 = today) — the "This week" widget's bar chart.
        var weeklyWordCounts = [Int](repeating: 0, count: 7)
        for r in items {
            let day = calendar.startOfDay(for: r.timestamp)
            guard let offset = calendar.dateComponents([.day], from: day, to: today).day,
                  (0..<7).contains(offset) else { continue }
            weeklyWordCounts[6 - offset] += wordCount(r)
        }
        let todayWordCount = weeklyWordCounts.last ?? 0

        // All-time "days with a note" streak, ending today/yesterday — same definition as
        // RecapView.streaks.current.
        let daysWithNotes = Set(items.map { calendar.startOfDay(for: $0.timestamp) })
        var currentStreak = 0
        if !daysWithNotes.isEmpty {
            var probe = today
            if !daysWithNotes.contains(probe) {
                probe = calendar.date(byAdding: .day, value: -1, to: probe) ?? probe
            }
            while daysWithNotes.contains(probe) {
                currentStreak += 1
                guard let prev = calendar.date(byAdding: .day, value: -1, to: probe) else { break }
                probe = prev
            }
        }

        SharedStore.updateWidgetSnapshot { snapshot in
            snapshot.recentRecordings = Array(recentRecordings)
            snapshot.totalRecordings = items.count
            snapshot.todayWordCount = todayWordCount
            snapshot.weeklyWordCounts = weeklyWordCounts
            snapshot.currentStreak = currentStreak
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Insert-or-update the local `items` last-writer-wins. A new id is inserted newest-first;
    /// an existing id is overwritten only when the incoming record is at least as new
    /// (`lastWriteAt`), so a stale/out-of-order write can't clobber newer data and duplicate ids
    /// never accumulate.
    private func upsertJSON(_ r: Recording) {
        if let idx = items.firstIndex(where: { $0.id == r.id }) {
            guard r.lastWriteAt >= items[idx].lastWriteAt else { return }
            items[idx] = r
        } else {
            items.insert(r, at: 0)
        }
    }

    func delete(_ r: Recording) {
        switch backend {
        case .sync(let store):
            queueSync(.delete, title: r.transcription ?? "Recording", detail: r.id.uuidString, recordID: r.id)
            store.delete(r)
        case .json(let url):
            items.removeAll { $0.id == r.id }
            saveJSON(to: url)
        }
    }

    // MARK: - Categories

    /// The category id currently assigned to a display recording. The DemoRecording mapping
    /// already resolved the persisted value (or the default), so read it straight off.
    func categoryId(for demo: DemoRecording) -> String {
        demo.category
    }

    /// Reassign a recording's category — persisted on the backing Recording so it survives
    /// relaunches (reflected everywhere it's displayed). No-op for sample rows (no sourceId).
    func setCategory(_ id: String, for demo: DemoRecording) {
        guard let sourceId = demo.sourceId else { return }
        switch backend {
        case .sync(let store):
            queueSync(.category, title: demo.title, detail: "Category -> \(id)", recordID: sourceId)
            store.setCategory(id, for: sourceId)
        case .json(let url):
            guard let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
            items[idx].category = id
            items[idx].updatedAt = Date()   // bump LWW clock so this edit wins over stale copies
            saveJSON(to: url)
        }
    }

    // MARK: - Render (AI rewrite)

    /// Persist an AI-rewritten render + the preset that produced it onto the backing Recording —
    /// mirrors setCategory: survives relaunches and reflects everywhere it's displayed. No-op for
    /// sample rows (no sourceId).
    func setRender(_ text: String, presetID: String, for demo: DemoRecording) {
        guard let sourceId = demo.sourceId else { return }
        switch backend {
        case .sync(let store):
            queueSync(.render, title: demo.title, detail: presetID, recordID: sourceId)
            store.setRender(text, presetID: presetID, for: sourceId)
        case .json(let url):
            guard let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
            items[idx].render = text
            items[idx].renderPresetID = presetID
            items[idx].updatedAt = Date()   // bump LWW clock so this edit wins over stale copies
            saveJSON(to: url)
        }
    }

    /// Replace the transcript after retranscribing the saved audio with another engine.
    /// The new engine's segments replace the old ones — nil clears stale diarization (a
    /// non-diarizing engine produced plain text, so speaker rows would no longer match).
    func setTranscription(_ text: String, provider: ProviderID,
                          segments: [SpeakerSegment]?, for demo: DemoRecording) {
        guard let sourceId = demo.sourceId else { return }
        switch backend {
        case .sync(let store):
            queueSync(.retranscribe, title: demo.title, detail: provider.rawValue, recordID: sourceId)
            store.setTranscription(text, provider: provider, segments: segments, for: sourceId)
        case .json(let url):
            guard let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
            items[idx].transcription = text
            items[idx].provider = provider
            items[idx].segments = segments
            items[idx].updatedAt = Date()   // bump LWW clock so this edit wins over stale copies
            saveJSON(to: url)
        }
    }

    // MARK: - Speakers (Conversation mode)

    /// Persist speaker display names (raw speaker id → name) onto the backing Recording —
    /// same shape as setRender: survives relaunches, reflects everywhere. No-op for sample
    /// rows (no sourceId).
    func setSpeakerNames(_ names: [String: String], for demo: DemoRecording) {
        guard let sourceId = demo.sourceId else { return }
        switch backend {
        case .sync(let store):
            queueSync(.speakers, title: demo.title, detail: "\(names.count) named", recordID: sourceId)
            store.setSpeakerNames(names, for: sourceId)
        case .json(let url):
            guard let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
            items[idx].speakerNames = names.isEmpty ? nil : names
            items[idx].updatedAt = Date()   // bump LWW clock so this edit wins over stale copies
            saveJSON(to: url)
        }
    }

    // MARK: - Storage cleanup

    /// Clear every recording's text-only fields (transcript, render, its preset, and any
    /// diarization segments) while leaving audio files and everything else untouched — backs
    /// the "Delete transcripts" storage cleanup row (see StorageView). Returns the real freed
    /// byte count (raw UTF-8 size of the cleared transcript + render strings), the same
    /// real-accounting stance `deleteAllAudio`/`deleteAllSummaries` already take — never an
    /// estimate. No-op (returns 0) when nothing has a transcript or render to clear.
    func clearAllTranscripts() -> Int64 {
        let targets = items.indices.filter { items[$0].transcription != nil || items[$0].render != nil }
        guard !targets.isEmpty else { return 0 }
        var freed: Int64 = 0
        for idx in targets {
            freed += Int64((items[idx].transcription ?? "").utf8.count)
            freed += Int64((items[idx].render ?? "").utf8.count)
        }
        switch backend {
        case .sync(let store):
            let ids = targets.map { items[$0].id }
            queueSync(.clearTranscripts, title: "Delete transcripts",
                      detail: "\(ids.count) recording\(ids.count == 1 ? "" : "s")", recordID: nil)
            for id in ids { store.clearTranscript(for: id) }
        case .json(let url):
            for idx in targets {
                items[idx].transcription = nil
                items[idx].render = nil
                items[idx].renderPresetID = nil
                items[idx].segments = nil
                items[idx].updatedAt = Date()   // bump LWW clock so this edit wins over stale copies
            }
            saveJSON(to: url)
        }
        return freed
    }

    func requestCloudRefresh() {
        switch backend {
        case .sync(let store):
            store.requestRefresh()
        case .json:
            break
        }
    }

    private func queueSync(_ kind: SyncQueueItem.Kind, title: String, detail: String, recordID: UUID?) {
        guard isCloudBacked || kind == .migrate else { return }
        pendingSyncQueue.insert(.init(timestamp: Date(), kind: kind, title: title, detail: detail, recordID: recordID), at: 0)
        if pendingSyncQueue.count > 20 {
            pendingSyncQueue = Array(pendingSyncQueue.prefix(20))
        }
    }

    private func flushPendingQueue() {
        guard let exportAt = lastExportAt else { return }
        pendingSyncQueue.removeAll { $0.timestamp <= exportAt }
    }

    // MARK: - JSON fallback

    private static let log = Logger(subsystem: "ai.whisperio", category: "RecordingsStore")

    private func loadJSON(from fileURL: URL) {
        // Missing file is the normal first-run path — nothing to report.
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        let data: Data
        do {
            data = try Data(contentsOf: fileURL)
        } catch {
            Self.log.error("Failed to read recordings.json: \(error.localizedDescription)")
            return
        }
        do {
            items = try JSONDecoder().decode([Recording].self, from: data)
        } catch {
            // Don't let a truncated write or schema drift silently erase history: park the
            // corrupt file aside so the next save() doesn't clobber the only copy.
            Self.log.error("Failed to decode recordings.json: \(error.localizedDescription) — backing up corrupt file")
            let backup = fileURL.appendingPathExtension("bak")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.copyItem(at: fileURL, to: backup)
        }
    }

    private func saveJSON(to fileURL: URL) {
        do {
            let data = try JSONEncoder().encode(items)
            try data.write(to: fileURL, options: [.atomic])
        } catch {
            Self.log.error("Failed to save recordings.json: \(error.localizedDescription)")
        }
    }
}

// Maps a real Recording onto the display model the screens already use.
extension DemoRecording {
    init(_ r: Recording) {
        var hash = 0
        withUnsafeBytes(of: r.id.uuid) { buf in
            for b in buf.prefix(8) { hash = (hash << 8) | Int(b) }
        }
        let title: String
        switch r.status {
        case .completed: title = r.transcription ?? ""
        case .failed:    title = r.error.map { "Failed: \($0)" } ?? "Transcription failed"
        case .pending:   title = "Transcribing…"
        }
        let demoId = abs(hash % 1_000_000_000)
        self.init(
            id: demoId,
            title: title,
            src: r.source ?? "app",
            app: "Whisperio",
            dur: DemoRecording.formatDuration(r.duration),
            when: DemoRecording.relativeWhen(r.timestamp),
            words: (r.transcription ?? "").split(whereSeparator: { $0 == " " || $0 == "\n" }).count,
            engine: r.provider == .onDevice ? "on-device" : "cloud",
            category: r.category ?? WZCategories.work.id,
            sourceId: r.id,
            render: r.render,
            renderPresetID: r.renderPresetID
        )
    }

    static func formatDuration(_ t: TimeInterval) -> String {
        let s = Int(t.rounded())
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    static func relativeWhen(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: date, relativeTo: Date())
    }
}
