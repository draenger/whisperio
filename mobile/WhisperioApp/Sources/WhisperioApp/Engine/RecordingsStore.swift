import Foundation
import Combine
import os
import WhisperioKit

// Real, persisted recordings. Prefers the SwiftData + CloudKit-backed RecordingSyncStore
// (WhisperioKit) so history follows the user across devices; falls back to the legacy JSON
// file in Documents when the CloudKit container can't be built (e.g. no iCloud account, or a
// pre-iOS-17 host). The class name + @MainActor ObservableObject surface are unchanged, so
// every @EnvironmentObject consumer stays untouched.
@MainActor
final class RecordingsStore: ObservableObject {
    @Published private(set) var items: [Recording] = []

    // Exactly one backend is live for the process. `.sync` delegates to the synced store and
    // mirrors its published items; `.json` keeps the original file-backed behaviour.
    private enum Backend {
        case sync(RecordingSyncStore)
        case json(URL)
    }
    private let backend: Backend

    // Keeps our published `items` in step with the synced store's own @Published items.
    private var syncCancellable: AnyCancellable?

    init() {
        // iOS 17+ (the app's deployment floor) with a reachable container → synced store, which
        // also runs the one-time recordings.json → SwiftData migration on init. Any init failure
        // (missing container, no iCloud) drops to the JSON fallback so history is never lost.
        if #available(iOS 17, macOS 14, *) {
            do {
                let store = try RecordingSyncStore()
                backend = .sync(store)
                items = store.items
                syncCancellable = store.$items.sink { [weak self] in self?.items = $0 }
                return
            } catch {
                Self.log.error("RecordingSyncStore init failed, falling back to JSON: \(error.localizedDescription)")
            }
        }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = docs.appendingPathComponent("recordings.json")
        backend = .json(url)
        loadJSON(from: url)
    }

    func add(_ r: Recording) {
        switch backend {
        case .sync(let store):
            store.add(r)
        case .json(let url):
            items.insert(r, at: 0)
            saveJSON(to: url)
        }
    }

    func delete(_ r: Recording) {
        switch backend {
        case .sync(let store):
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
            store.setCategory(id, for: sourceId)
        case .json(let url):
            guard let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
            items[idx].category = id
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
            store.setRender(text, presetID: presetID, for: sourceId)
        case .json(let url):
            guard let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
            items[idx].render = text
            items[idx].renderPresetID = presetID
            saveJSON(to: url)
        }
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
            src: "app",
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
