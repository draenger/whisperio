import Foundation
import Combine
import os
import WhisperioKit

// Real, persisted recordings (replaces SampleData). Saved as JSON in Documents.
@MainActor
final class RecordingsStore: ObservableObject {
    @Published private(set) var items: [Recording] = []
    private let fileURL: URL

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        fileURL = docs.appendingPathComponent("recordings.json")
        load()
    }

    func add(_ r: Recording) { items.insert(r, at: 0); save() }
    func delete(_ r: Recording) { items.removeAll { $0.id == r.id }; save() }

    // MARK: - Categories

    /// The category id currently assigned to a display recording. The DemoRecording mapping
    /// already resolved the persisted value (or the default), so read it straight off.
    func categoryId(for demo: DemoRecording) -> String {
        demo.category
    }

    /// Reassign a recording's category — persisted on the backing Recording so it survives
    /// relaunches (reflected everywhere it's displayed). No-op for sample rows.
    func setCategory(_ id: String, for demo: DemoRecording) {
        guard let sourceId = demo.sourceId,
              let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
        items[idx].category = id
        save()
    }

    // MARK: - Render (AI rewrite)

    /// Persist an AI-rewritten render + the preset that produced it onto the backing Recording —
    /// mirrors setCategory: survives relaunches and reflects everywhere it's displayed. No-op for
    /// sample rows (no sourceId).
    func setRender(_ text: String, presetID: String, for demo: DemoRecording) {
        guard let sourceId = demo.sourceId,
              let idx = items.firstIndex(where: { $0.id == sourceId }) else { return }
        items[idx].render = text
        items[idx].renderPresetID = presetID
        save()
    }

    private static let log = Logger(subsystem: "ai.whisperio", category: "RecordingsStore")

    private func load() {
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

    private func save() {
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
