import Foundation

// Durable home for kept dictation audio. Clips are recorded into the temp directory
// (AudioRecorder) and — when "Keep audio recordings" is on — moved here on save. tmp is
// purged by iOS at will (relaunch, low storage), which is why kept audio used to vanish
// and Detail showed "No audio saved" after a while. Lookup self-heals: a clip still
// sitting in tmp is adopted into the durable folder on first access.
enum AudioStore {
    static var folder: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("Audio", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Move a freshly recorded clip out of tmp into durable storage. Idempotent; a clip
    /// already adopted (or already gone) is left as-is.
    static func persist(_ filename: String) {
        guard !filename.isEmpty else { return }
        let src = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        let dst = folder.appendingPathComponent(filename)
        guard !FileManager.default.fileExists(atPath: dst.path),
              FileManager.default.fileExists(atPath: src.path) else { return }
        try? FileManager.default.moveItem(at: src, to: dst)
    }

    /// Durable-first lookup; adopts a tmp survivor into the durable folder on the way.
    static func url(for filename: String) -> URL? {
        guard !filename.isEmpty else { return nil }
        let dst = folder.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: dst.path) { return dst }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: tmp.path) {
            try? FileManager.default.moveItem(at: tmp, to: dst)
            return FileManager.default.fileExists(atPath: dst.path) ? dst : tmp
        }
        return nil
    }

    /// Remove a clip from both possible homes (durable + a not-yet-adopted tmp copy).
    static func delete(_ filename: String) {
        guard !filename.isEmpty else { return }
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(filename))
        try? FileManager.default.removeItem(
            at: FileManager.default.temporaryDirectory.appendingPathComponent(filename))
    }

    /// Every kept clip: the durable folder plus any whisperio tmp clips not yet adopted —
    /// the set Storage & data measures and deletes over.
    static func allFiles() -> [URL] {
        let durable = (try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        let tmp = ((try? FileManager.default.contentsOfDirectory(
            at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: [.fileSizeKey])) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("whisperio-") && $0.pathExtension == "m4a" }
        return durable + tmp
    }
}
