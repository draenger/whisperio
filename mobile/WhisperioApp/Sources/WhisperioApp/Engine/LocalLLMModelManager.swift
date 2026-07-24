import Foundation

/// Actor-agnostic disk/persistence logic for on-device LLM (GGUF) models — deliberately NOT
/// `@MainActor` and NOT an actor (only thread-safe `FileManager`), so it can be called
/// synchronously from anywhere: the `@MainActor` `LocalLLMModelManager` (UI/download), the
/// `LocalLLMEngineCache` actor (load), and `LocalLLMChatClient`'s synchronous `isConfigured`.
/// Nothing here ever reports a size or "downloaded" state that wasn't actually measured on disk.
enum LocalLLMModelStore {
    /// Where GGUFs live — Application Support, NOT Documents: these are large, re-downloadable blobs
    /// that must never sync to iCloud/iTunes backups (Documents would). Mirrors `LocalWhisperModelStore`.
    static let root: URL = {
        let support = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                    appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let dir = support.appendingPathComponent("LocalLLMModels", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var excluded = dir
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? excluded.setResourceValues(values)
        return dir
    }()

    /// The single-file location for a model id. Each model is one `.gguf` blob (no nesting), unlike
    /// WhisperKit's multi-file CoreML folders — so resolution is a direct path, no scan needed.
    static func fileURL(for id: String) -> URL {
        root.appendingPathComponent("\(id).gguf", isDirectory: false)
    }

    /// Real, synchronous on-disk check — the file exists AND is non-empty (a failed/partial download
    /// can leave a zero-byte file, which must not read as "downloaded").
    static func isDownloaded(_ id: String) -> Bool {
        (onDiskSizeBytes(id) ?? 0) > 0
    }

    /// Real on-disk size in bytes, or `nil` when the file is missing/empty. This is what the
    /// Manage-models row must show once installed, never the pre-download estimate on `LocalLLMModel`.
    static func onDiskSizeBytes(_ id: String) -> Int64? {
        let url = fileURL(for: id)
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (attrs[.size] as? NSNumber)?.int64Value, size > 0 else { return nil }
        return size
    }

    static func remove(_ id: String) throws {
        let url = fileURL(for: id)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }
}

/// UI-facing download state + orchestration for on-device LLM models: real progress, real on-disk
/// sizes, real failure states — no fabricated percentages. A not-downloaded model must fail the
/// chat chain honestly (see `LocalLLMChatClient.isConfigured`), never pretend to be ready.
///
/// Kept separate from actual inference (`LocalLLMEngineCache` in `LocalLLMChatClient.swift`) so
/// downloading/progress never blocks on the expensive GGUF load. All disk resolution defers to the
/// actor-agnostic `LocalLLMModelStore`, so the client's synchronous `isConfigured` stays consistent
/// with what this class shows in the UI.
@MainActor
final class LocalLLMModelManager: ObservableObject {
    static let shared = LocalLLMModelManager()

    enum DownloadState: Equatable {
        case notStarted
        case downloading(Double)
        case installed
        case failed(String)
    }

    @Published private(set) var state: [String: DownloadState] = [:]
    /// Set on a real download failure so the UI can surface an honest alert instead of silently
    /// reverting to "Get". Cleared by the UI after presenting it.
    @Published var lastError: String?

    /// Retains the per-download KVO progress observers for the life of each transfer.
    private var progressObservers: [String: NSKeyValueObservation] = [:]

    private init() {
        refreshFromDisk()
    }

    func isDownloaded(_ id: String) -> Bool { LocalLLMModelStore.isDownloaded(id) }

    /// The on-disk GGUF path, or `nil` when not downloaded — the client uses this to load the model.
    func localURL(_ id: String) -> URL? {
        LocalLLMModelStore.isDownloaded(id) ? LocalLLMModelStore.fileURL(for: id) : nil
    }

    func onDiskSizeBytes(_ id: String) -> Int64? { LocalLLMModelStore.onDiskSizeBytes(id) }

    /// Catalog filtered to models this device's physical RAM can actually load. `physicalMemory` is
    /// the installed RAM; a small headroom lets a nominally-"4GB" device (which reports slightly
    /// under) still qualify for a `minRAMGB == 4` model.
    var availableModels: [LocalLLMModel] {
        let bytesPerGB = 1_073_741_824.0
        let physicalGB = Double(ProcessInfo.processInfo.physicalMemory) / bytesPerGB
        let headroomGB = 0.35
        return LocalLLMCatalog.all.filter { physicalGB + headroomGB >= Double($0.minRAMGB) }
    }

    /// Re-scan disk state for every model not mid-download. Call on the models screen's `.onAppear`
    /// so a model removed via Files.app, or downloaded in a prior session, shows correctly.
    func refreshFromDisk() {
        for model in LocalLLMCatalog.all {
            if case .downloading = state[model.id] { continue }
            state[model.id] = LocalLLMModelStore.isDownloaded(model.id) ? .installed : .notStarted
        }
    }

    /// Download `model`'s GGUF with a real `URLSession` download task + live KVO progress — never
    /// simulated. Guards against a second overlapping download for the same model. The temp file is
    /// moved into place INSIDE the completion handler (the system deletes it the moment that handler
    /// returns), then verified non-empty before the row flips to installed.
    func download(_ model: LocalLLMModel) async throws {
        if case .downloading = state[model.id] { return }
        state[model.id] = .downloading(0)

        do {
            let destination: URL = try await withCheckedThrowingContinuation { continuation in
                let task = URLSession.shared.downloadTask(with: model.downloadURL) { tempURL, response, error in
                    if let error { return continuation.resume(throwing: error) }
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        return continuation.resume(throwing: localLLMError("Download failed (HTTP \(http.statusCode))."))
                    }
                    guard let tempURL else {
                        return continuation.resume(throwing: localLLMError("Download returned no file."))
                    }
                    let dest = LocalLLMModelStore.fileURL(for: model.id)
                    do {
                        try? FileManager.default.removeItem(at: dest)
                        try FileManager.default.createDirectory(
                            at: LocalLLMModelStore.root, withIntermediateDirectories: true)
                        try FileManager.default.moveItem(at: tempURL, to: dest)
                        continuation.resume(returning: dest)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
                let observer = task.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
                    let fraction = progress.fractionCompleted
                    Task { @MainActor in
                        guard let self else { return }
                        if case .downloading = self.state[model.id] {
                            self.state[model.id] = .downloading(fraction)
                        }
                    }
                }
                progressObservers[model.id] = observer
                task.resume()
            }
            _ = destination

            // Verify the moved file is real and non-empty before claiming it's installed.
            guard LocalLLMModelStore.isDownloaded(model.id) else {
                try? LocalLLMModelStore.remove(model.id)
                throw localLLMError("Downloaded model file was empty.")
            }
            progressObservers[model.id] = nil
            state[model.id] = .installed
        } catch {
            progressObservers[model.id] = nil
            try? LocalLLMModelStore.remove(model.id)
            state[model.id] = .failed(error.localizedDescription)
            lastError = error.localizedDescription
            throw error
        }
    }

    /// Delete a downloaded model's file, reset its row, and evict any cached in-memory `LLM` so a
    /// stale, deleted-on-disk model can't keep generating.
    func remove(_ id: String) throws {
        try LocalLLMModelStore.remove(id)
        state[id] = .notStarted
        Task { await LocalLLMEngineCache.shared.evict(id) }
    }
}
