import Foundation
import Combine
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
        self.init(
            id: abs(hash % 1_000_000_000),
            title: title,
            src: "app",
            app: "Whisperio",
            dur: DemoRecording.formatDuration(r.duration),
            when: DemoRecording.relativeWhen(r.timestamp),
            words: (r.transcription ?? "").split(whereSeparator: { $0 == " " || $0 == "\n" }).count,
            engine: r.provider == .onDevice ? "on-device" : "cloud"
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
