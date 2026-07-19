import Foundation
import Combine
import os
import SwiftData
import WhisperioKit

// Persisted daily digests (the journal). Prefers the SwiftData + CloudKit-backed
// DigestSyncStore (WhisperioKit) so the journal follows the user across devices; falls back to
// the legacy journal.json file in Documents when the CloudKit container can't be built (e.g. no
// iCloud account, or a pre-iOS-17 host). Mirrors RecordingsStore's sync-or-JSON wrapper shape.
// The class name + @MainActor ObservableObject surface are unchanged, so every
// @EnvironmentObject consumer (AppShell, JournalView, DigestDayView, GitHubSyncView) stays
// untouched. The store owns orchestration only — grouping is the pure Kit logic, the network
// lives in the ChatLLM.
@MainActor
final class DigestStore: ObservableObject {
    @Published private(set) var digests: [DailyDigest] = []

    // True while the CloudKit-backed store is actively importing/exporting. Forwarded from the
    // synced store's own `isSyncing`; always false for the JSON backend.
    @Published private(set) var isSyncing = false

    // Whether the live journal is iCloud-backed (SwiftData + CloudKit). False for the JSON
    // fallback.
    @Published private(set) var isCloudBacked = false

    // Last local CloudKit/SwiftData error reported by the live store. Nil for JSON fallback.
    @Published private(set) var lastErrorMessage: String?
    @Published private(set) var lastImportAt: Date?
    @Published private(set) var lastExportAt: Date?

    // True when the user's storage choice is iCloud but the live journal isn't CloudKit-backed
    // — the device fell back to local-only (no account at launch, or container init failed) and
    // is pinned there for the process's lifetime (the ModelConfiguration is fixed at init; see
    // the NOTE on DigestSyncStore.init). Mirrors RecordingsStore.iCloudResumeAvailable so the
    // Settings banner can offer the same one-tap "Resume iCloud sync" for the journal.
    @Published private(set) var iCloudResumeAvailable = false

    // Exactly one backend is live for the process. `.sync` delegates to the synced store and
    // mirrors its published digests; `.json` keeps the original file-backed behaviour.
    private enum Backend {
        case sync(DigestSyncStore)
        case json(URL)
    }
    private var backend: Backend

    // Keeps our published properties in step with the synced store's own @Published values.
    private var syncCancellable: AnyCancellable?
    private var syncStateCancellable: AnyCancellable?
    private var syncErrorCancellable: AnyCancellable?
    private var syncImportCancellable: AnyCancellable?
    private var syncExportCancellable: AnyCancellable?

    // Retained token for the iCloud account-availability observer (see `observeICloudAvailability`).
    // Kept for the store's lifetime, same as `RecordingsStore.ubiquityObserver`.
    private var ubiquityObserver: NSObjectProtocol?
    // Guards `attemptICloudResumeIfNeeded()` against re-entrancy: the ubiquity notification can
    // fire more than once in quick succession, and a migration is already in flight the moment
    // it's kicked off (before `isCloudBacked` flips), so this is the only signal that stops a
    // second call from racing the first and double-migrating the journal.
    private var resumeInFlight = false

    // Once/day backfill guard — the day key we last ran auto-journaling for (so a foreground burst
    // doesn't re-run it). Stored in UserDefaults; nil means "never run".
    private static let backfillKey = "whisperio.digest.lastBackfillDay.v1"

    init() {
        // iOS 17+ (the app's deployment floor) with a reachable container → synced store, which
        // also runs the one-time journal.json → SwiftData migration on init. Any init failure
        // (missing container, no iCloud) drops to the JSON fallback so the journal is never lost.
        if #available(iOS 17, macOS 14, *) {
            do {
                let store = try DigestSyncStore()
                backend = .sync(store)
                attach(syncStore: store)
                observeICloudAvailability()
                return
            } catch {
                Self.log.error("DigestSyncStore init failed, falling back to JSON: \(error.localizedDescription)")
            }
        }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = docs.appendingPathComponent("journal.json")
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
    /// `RecordingSyncStore` reads (`RecordingSyncStore.settingsDefaultsKey`). Mirrors
    /// `RecordingsStore.persistedStorageMode()` — WhisperioApp has no compile dependency on
    /// `SettingsStore`, so it decodes the blob itself rather than reaching across the module
    /// boundary.
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
    /// manual "Move library to iCloud" toggle. Mirrors `RecordingsStore.observeICloudAvailability`.
    private func observeICloudAvailability() {
        // The observer delivers on the main queue, so — mirroring
        // `RecordingsStore.observeICloudAvailability` — we hop to the MainActor via
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

    /// Promote the current journal into the iCloud-backed SwiftData store and switch the live
    /// backend over immediately. Callers typically pair this with `settings.storageMode = .iCloud`
    /// (and, for the Home library, `RecordingsStore.migrateCurrentLibraryToCloud()` alongside it).
    /// The caller chooses whether to surface success/failure to the user.
    @MainActor
    func migrateCurrentLibraryToCloud() throws {
        guard #available(iOS 17, macOS 14, *) else { return }
        // Same on-disk file the convenience init opens (`DigestSync.storeURL()`), not the
        // unnamed-config default — otherwise this migration would collide with
        // `RecordingSyncStore`'s cache file on the shared `default.store` path.
        let cloudConfig = ModelConfiguration(
            url: try DigestSync.storeURL(),
            cloudKitDatabase: .private(RecordingSyncStore.cloudKitContainerID)
        )
        let cloudStore = try DigestSyncStore(configuration: cloudConfig, isCloudBacked: true)
        // Carry each digest's real last-write time (not "now") into the upsert — `upsert`
        // defaults `modifiedAt` to the current instant, which would stamp every migrated digest
        // as freshly written and let a week-old local entry win last-writer-wins over a genuinely
        // newer copy already synced down from another device (e.g. an iPad that summarized today
        // while this device was offline). `DigestSync.lastWriteAt` is the same real-timestamp
        // source `DigestSyncStore.migrateLegacyJSONIfNeeded` already uses for the JSON migration.
        for digest in digests {
            cloudStore.upsert(digest, modifiedAt: DigestSync.lastWriteAt(for: digest))
        }
        backend = .sync(cloudStore)
        attach(syncStore: cloudStore)
    }

    @available(iOS 17, macOS 14, *)
    private func attach(syncStore: DigestSyncStore) {
        syncCancellable = nil
        syncStateCancellable = nil
        syncErrorCancellable = nil
        syncImportCancellable = nil
        syncExportCancellable = nil
        isCloudBacked = syncStore.isCloudBacked
        digests = syncStore.digests
        isSyncing = syncStore.isSyncing
        lastErrorMessage = syncStore.lastErrorMessage
        lastImportAt = syncStore.lastImportAt
        lastExportAt = syncStore.lastExportAt
        syncCancellable = syncStore.$digests.sink { [weak self] in self?.digests = $0 }
        syncStateCancellable = syncStore.$isSyncing.sink { [weak self] in self?.isSyncing = $0 }
        syncErrorCancellable = syncStore.$lastErrorMessage.sink { [weak self] in self?.lastErrorMessage = $0 }
        syncImportCancellable = syncStore.$lastImportAt.sink { [weak self] in self?.lastImportAt = $0 }
        syncExportCancellable = syncStore.$lastExportAt.sink { [weak self] in self?.lastExportAt = $0 }
        updateICloudResumeAvailability()
    }

    /// Re-read the local CloudKit-backed snapshot (does not force a network pull — see
    /// `DigestSyncStore.requestRefresh()`). No-op for the JSON fallback, which has no cloud peer
    /// to refresh from. Mirrors `RecordingsStore.requestCloudRefresh()`.
    func requestCloudRefresh() {
        switch backend {
        case .sync(let store):
            store.requestRefresh()
        case .json:
            break
        }
    }

    /// The cached digest for a day key (YYYY-MM-DD), if one has been generated.
    func digest(for dayKey: String) -> DailyDigest? {
        digests.first { $0.id == dayKey }
    }

    // MARK: - Generation

    /// Generate (or regenerate) the digest for `day`. Orchestration: bucket the day's recordings,
    /// classify the still-uncategorized ones through the chat client and write each match back via
    /// RecordingsStore.setCategory (so the user can still correct it), group by category, then build
    /// the summary. Classification is best-effort (a failed/parsed-empty reply just leaves notes
    /// uncategorized — never mis-filed); the grouped digest is cached before the summary call so a
    /// summary failure still persists the day's structure. Throws only on the summary call so the
    /// caller can surface it. Assumes `client.isConfigured` — callers gate on cloud consent + key.
    func generate(
        for day: Date,
        recordings: RecordingsStore,
        categories: [WZCategory],
        using client: ChatLLM,
        model: String,
        promptConfig: DigestPromptConfig = .default
    ) async throws {
        let calendar = Calendar.current
        let dayKey = DigestGrouping.dayKey(for: day, calendar: calendar)
        let order = categories.map(\.id)

        // Only completed recordings with real text take part in the digest.
        func dayRecordings() -> [Recording] {
            recordings.items.filter {
                $0.status == .completed
                    && !($0.transcription ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && DigestGrouping.dayKey(for: $0.timestamp, calendar: calendar) == dayKey
            }
        }

        // 1) Classify the day's uncategorized notes and persist each confident match back through
        // the store. Best-effort: a thrown/empty classification leaves them uncategorized.
        let uncategorized = DigestGrouping.uncategorized(dayRecordings())
        if !uncategorized.isEmpty {
            let notes = uncategorized.map { (id: $0.id, text: $0.transcription ?? "") }
            let labels = categories.map { (id: $0.id, label: $0.label) }
            if let map = try? await client.classify(notes: notes, categories: labels,
                                                     model: model, promptConfig: promptConfig) {
                for rec in uncategorized {
                    if let categoryID = map[rec.id] {
                        recordings.setCategory(categoryID, for: DemoRecording(rec))
                    }
                }
            }
        }

        // 2) Group the (now re-classified) day by category, preserving the passed-in order.
        let dayRecs = dayRecordings()
        let byID = Dictionary(dayRecs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let groups = DigestGrouping.groupByCategory(dayRecs, order: order)

        // 3) Cache the grouped digest (keeping any prior summary until the new one lands) so the
        // day's structure + category writes survive even if the summary call fails below.
        let priorSummary = digest(for: dayKey)?.summary
        upsert(DailyDigest(id: dayKey, date: day,
                           recordingIDs: dayRecs.map(\.id), groups: groups,
                           summary: priorSummary,
                           summaryGeneratedAt: digest(for: dayKey)?.summaryGeneratedAt))
        guard !groups.isEmpty else { return }

        // 4) Build + cache the summary (one batched call). Notes keep their source language.
        let promptGroups: [(label: String, notes: [String])] = groups.map { group in
            let label = categories.first { $0.id == group.categoryID }?.label ?? "Uncategorized"
            let notes = group.recordingIDs.compactMap { byID[$0]?.transcription }
            return (label: label, notes: notes)
        }
        let summary = try await client.summarize(
            day: day, groups: promptGroups, locale: Locale.current.identifier,
            model: model, promptConfig: promptConfig)
        upsert(DailyDigest(id: dayKey, date: day,
                           recordingIDs: dayRecs.map(\.id), groups: groups,
                           summary: summary, summaryGeneratedAt: Date()))
    }

    /// Auto-journaling backfill: once per calendar day, summarize the last `window` prior days that
    /// have notes but no summary yet. No-op when the client isn't configured. Best-effort — a failed
    /// day is skipped and retried on the next day's run.
    func backfillIfNeeded(
        recordings: RecordingsStore,
        categories: [WZCategory],
        using client: ChatLLM,
        model: String,
        promptConfig: DigestPromptConfig = .default,
        window: Int = 7
    ) async {
        guard client.isConfigured else { return }
        let calendar = Calendar.current
        let todayKey = DigestGrouping.dayKey(for: Date(), calendar: calendar)
        // Once/day: bail if we already ran today.
        if UserDefaults.standard.string(forKey: Self.backfillKey) == todayKey { return }
        UserDefaults.standard.set(todayKey, forKey: Self.backfillKey)

        for back in 1...window {
            guard let day = calendar.date(byAdding: .day, value: -back, to: Date()) else { continue }
            let dayKey = DigestGrouping.dayKey(for: day, calendar: calendar)
            // Skip days already summarized.
            if digest(for: dayKey)?.summary != nil { continue }
            // Skip empty days — nothing to journal.
            let hasNotes = recordings.items.contains {
                $0.status == .completed
                    && DigestGrouping.dayKey(for: $0.timestamp, calendar: calendar) == dayKey
            }
            guard hasNotes else { continue }
            try? await generate(for: day, recordings: recordings,
                                categories: categories, using: client, model: model,
                                promptConfig: promptConfig)
        }
    }

    /// Erase every daily summary (both backends). Used by Storage & data → Erase all data.
    func eraseAll() {
        switch backend {
        case .sync(let store):
            for digest in digests { store.delete(digest) }
        case .json(let url):
            digests = []
            saveJSON(to: url)
        }
    }

    // MARK: - Upsert (routes to whichever backend is live)

    private func upsert(_ digest: DailyDigest) {
        switch backend {
        case .sync(let store):
            store.upsert(digest)
        case .json(let url):
            upsertJSON(digest)
            saveJSON(to: url)
        }
    }

    /// Insert-or-update the local `digests` last-writer-wins on day key. A new day is inserted
    /// then the list re-sorted; an existing day is overwritten in place. Mirrors
    /// `RecordingsStore.upsertJSON` — the JSON fallback has no cross-device peer to race against,
    /// so (unlike the sync backend) every local write always wins.
    private func upsertJSON(_ digest: DailyDigest) {
        if let idx = digests.firstIndex(where: { $0.id == digest.id }) {
            digests[idx] = digest
        } else {
            digests.append(digest)
        }
        digests.sort { $0.id > $1.id }   // newest day first
    }

    // MARK: - JSON fallback

    private static let log = Logger(subsystem: "ai.whisperio", category: "DigestStore")

    private func loadJSON(from fileURL: URL) {
        // Missing file is the normal first-run path — nothing to report.
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        let data: Data
        do {
            data = try Data(contentsOf: fileURL)
        } catch {
            Self.log.error("Failed to read journal.json: \(error.localizedDescription)")
            return
        }
        do {
            digests = try JSONDecoder().decode([DailyDigest].self, from: data)
        } catch {
            // Don't let a truncated write or schema drift silently erase the journal: park the
            // corrupt file aside so the next save() doesn't clobber the only copy.
            Self.log.error("Failed to decode journal.json: \(error.localizedDescription) — backing up corrupt file")
            let backup = fileURL.appendingPathExtension("bak")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.copyItem(at: fileURL, to: backup)
        }
    }

    private func saveJSON(to fileURL: URL) {
        do {
            let data = try JSONEncoder().encode(digests)
            try data.write(to: fileURL, options: [.atomic])
        } catch {
            Self.log.error("Failed to save journal.json: \(error.localizedDescription)")
        }
    }
}
