import Foundation
import Combine
import WhisperioKit

// Real, persisted recordings (replaces SampleData). Saved as JSON in Documents.
@MainActor
final class RecordingsStore: ObservableObject {
    @Published private(set) var items: [Recording] = []
    // Live, session-level category assignments keyed by the display id (DemoRecording.id).
    // Categories are demo metadata over the recordings, so they live here rather than in the
    // persisted WhisperioKit Recording — reassigning one in Detail updates Home immediately.
    @Published private var categoryOverrides: [Int: String] = [:]
    private let fileURL: URL

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        fileURL = docs.appendingPathComponent("recordings.json")
        load()
    }

    func add(_ r: Recording) { items.insert(r, at: 0); save() }
    func delete(_ r: Recording) { items.removeAll { $0.id == r.id }; save() }

    // MARK: - Categories (session state)

    /// The category id currently assigned to a display recording — an explicit override if the
    /// user reassigned it this session, otherwise the recording's own default.
    func categoryId(for demo: DemoRecording) -> String {
        categoryOverrides[demo.id] ?? demo.category
    }

    /// Reassign a recording's category live (reflected everywhere it's displayed).
    func setCategory(_ id: String, for demo: DemoRecording) {
        categoryOverrides[demo.id] = id
    }

    private func load() {
        if let data = try? Data(contentsOf: fileURL),
           let arr = try? JSONDecoder().decode([Recording].self, from: data) { items = arr }
    }
    private func save() {
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: fileURL) }
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
            category: WZCategories.default(for: demoId)
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
