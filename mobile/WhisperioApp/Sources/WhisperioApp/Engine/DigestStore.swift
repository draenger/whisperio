import Foundation
import Combine
import os
import WhisperioKit

// Persisted daily digests (the journal). Mirrors RecordingsStore: JSON in Documents with an atomic
// write and a corrupt-file backup so a truncated write / schema drift never erases the journal. The
// store owns orchestration only — grouping is the pure Kit logic, the network lives in the ChatLLM.
@MainActor
final class DigestStore: ObservableObject {
    @Published private(set) var digests: [DailyDigest] = []
    private let fileURL: URL

    // Once/day backfill guard — the day key we last ran auto-journaling for (so a foreground burst
    // doesn't re-run it). Stored in UserDefaults; nil means "never run".
    private static let backfillKey = "whisperio.digest.lastBackfillDay.v1"

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        fileURL = docs.appendingPathComponent("journal.json")
        load()
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
        model: String
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
            if let map = try? await client.classify(notes: notes, categories: labels, model: model) {
                for rec in uncategorized {
                    if let categoryID = map[rec.id] {
                        recordings.setCategory(categoryID, for: DemoRecording(rec))
                    }
                }
            }
        }

        // 2) Group the (now re-classified) day by category, preserving the passed-in order.
        let dayRecs = dayRecordings()
        let byID = Dictionary(uniqueKeysWithValues: dayRecs.map { ($0.id, $0) })
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
            day: day, groups: promptGroups, locale: Locale.current.identifier, model: model)
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
                                categories: categories, using: client, model: model)
        }
    }

    // MARK: - Persistence

    private func upsert(_ digest: DailyDigest) {
        if let idx = digests.firstIndex(where: { $0.id == digest.id }) {
            digests[idx] = digest
        } else {
            digests.append(digest)
        }
        digests.sort { $0.id > $1.id }   // newest day first
        save()
    }

    private static let log = Logger(subsystem: "ai.whisperio", category: "DigestStore")

    private func load() {
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

    private func save() {
        do {
            let data = try JSONEncoder().encode(digests)
            try data.write(to: fileURL, options: [.atomic])
        } catch {
            Self.log.error("Failed to save journal.json: \(error.localizedDescription)")
        }
    }
}
