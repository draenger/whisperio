import Foundation
import WhisperKit

/// Pure, actor-agnostic disk/persistence logic for on-device Whisper models — deliberately NOT
/// `@MainActor` and NOT an actor itself (only `FileManager`/`UserDefaults`, both thread-safe),
/// so it can be called synchronously from anywhere: the MainActor `LocalWhisperModelManager`
/// (UI/download orchestration), the `LocalWhisperInferenceCache` actor, and the plain `Sendable`
/// `LocalWhisperProvider` struct's synchronous `isConfigured` — none of which may touch each
/// other's actor-isolated state directly. No part of this ever fabricates a size or state that
/// wasn't actually measured on disk.
enum LocalWhisperModelStore {
    /// Where on-device Whisper models live — Application Support, NOT Documents: these are
    /// large, re-downloadable CoreML blobs, so they must never sync to iCloud/iTunes backups
    /// (Documents would). Each variant gets its OWN subfolder, passed to WhisperKit as that
    /// variant's `downloadBase` — this bounds where a given variant's files can possibly land,
    /// which is what makes `isDownloaded`/`onDiskSizeBytes`/the resolved-folder scan below safe
    /// without needing to reverse-engineer WhisperKit/Hub's exact internal nesting scheme.
    static let root: URL = {
        let support = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let dir = support.appendingPathComponent("WhisperKitModels", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var excluded = dir
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? excluded.setResourceValues(values)
        return dir
    }()

    /// The per-variant folder handed to WhisperKit as `downloadBase` — everything that variant's
    /// download ever writes lives somewhere under here.
    static func variantRoot(_ model: LocalWhisperModel) -> URL {
        root.appendingPathComponent(model.rawValue, isDirectory: true)
    }

    private static let resolvedPathsKey = "whisperio.localWhisperModelPaths.v1"
    private static var resolvedPaths: [String: String] {
        get { (UserDefaults.standard.dictionary(forKey: resolvedPathsKey) as? [String: String]) ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: resolvedPathsKey) }
    }

    static func persistResolvedPath(_ folder: URL, for model: LocalWhisperModel) {
        var paths = resolvedPaths
        paths[model.rawValue] = folder.path
        resolvedPaths = paths
    }

    static func clearResolvedPath(for model: LocalWhisperModel) {
        var paths = resolvedPaths
        paths.removeValue(forKey: model.rawValue)
        resolvedPaths = paths
    }

    /// The exact leaf folder WhisperKit needs for `WhisperKitConfig(modelFolder:)` to load this
    /// variant — the folder `WhisperKit.download(...)` itself returned, read back from the
    /// persisted map, or (if that entry is missing but files remain) a bounded scan for the one
    /// confirmed real naming fact: WhisperKit's HuggingFace repo folders are named exactly the
    /// variant's raw value (e.g. "openai_whisper-tiny"). `nil` when nothing resolves — never
    /// guessed.
    static func resolvedFolder(_ model: LocalWhisperModel) -> URL? {
        if let saved = resolvedPaths[model.rawValue] {
            let url = URL(fileURLWithPath: saved)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        return scanForLeafFolder(named: model.rawValue, under: variantRoot(model))
    }

    private static func scanForLeafFolder(named name: String, under root: URL) -> URL? {
        guard let enumerator = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }
        for case let url as URL in enumerator where url.lastPathComponent == name {
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
                return url
            }
        }
        return nil
    }

    /// Real, synchronous on-disk check — the resolved folder exists AND is non-empty (a
    /// failed/partial download can leave an empty or partial directory, which must not read as
    /// "downloaded").
    static func isDownloaded(_ model: LocalWhisperModel) -> Bool {
        guard let folder = resolvedFolder(model) else { return false }
        guard let items = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return false }
        return !items.isEmpty
    }

    /// Real on-disk size — a recursive sum over the resolved folder's files. `nil` when not
    /// downloaded. This is what ModelsView must show once installed, never the pre-download
    /// estimate on `LocalWhisperModel`.
    static func onDiskSizeBytes(_ model: LocalWhisperModel) -> Int64? {
        guard let folder = resolvedFolder(model) else { return nil }
        guard let enumerator = FileManager.default.enumerator(
            at: folder, includingPropertiesForKeys: [.fileSizeKey], options: []
        ) else { return nil }
        var total: Int64 = 0
        for case let url as URL in enumerator {
            if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                total += Int64(size)
            }
        }
        return total
    }

    /// Remove every file for `model` (both the persisted leaf folder and its whole variant
    /// container) and forget its resolved path.
    static func remove(_ model: LocalWhisperModel) throws {
        if let folder = resolvedFolder(model) {
            try FileManager.default.removeItem(at: folder)
        }
        try? FileManager.default.removeItem(at: variantRoot(model))
        clearResolvedPath(for: model)
    }
}

/// UI-facing download state + orchestration for on-device Whisper models: real progress, real
/// on-disk sizes, real failure states — no part of this ever fabricates a size or percentage
/// that wasn't actually measured/reported. A not-downloaded model must fail the transcription
/// chain honestly (see `LocalWhisperProvider.isConfigured`), never pretend to be ready.
///
/// Kept deliberately separate from actual CoreML inference (`LocalWhisperInferenceCache` in
/// `LocalWhisperProvider.swift`) so downloading/progress work never risks blocking the main
/// thread on model load/predict work. All actual disk resolution defers to the actor-agnostic
/// `LocalWhisperModelStore` above, so `LocalWhisperProvider`'s synchronous `isConfigured` (which
/// cannot touch this MainActor object without `await`) stays consistent with what this class
/// shows in the UI.
@MainActor
final class LocalWhisperModelManager: ObservableObject {
    static let shared = LocalWhisperModelManager()

    enum DownloadState: Equatable {
        case notStarted
        case downloading(Double)
        case installed
        case failed(String)
    }

    @Published private(set) var state: [LocalWhisperModel: DownloadState] = [:]
    /// Set on a real download failure so the UI can surface an honest alert instead of silently
    /// reverting to "Get". Cleared by the UI after presenting it.
    @Published var lastError: String?

    private init() {
        refreshFromDisk()
    }

    func isDownloaded(_ model: LocalWhisperModel) -> Bool { LocalWhisperModelStore.isDownloaded(model) }
    func onDiskSizeBytes(_ model: LocalWhisperModel) -> Int64? { LocalWhisperModelStore.onDiskSizeBytes(model) }

    /// Re-scan disk state for every variant not currently mid-download. Call on ModelsView's
    /// `.onAppear` so a model removed via Files.app, or downloaded in a prior session, shows
    /// correctly without relaunching.
    func refreshFromDisk() {
        for model in LocalWhisperModel.allCases {
            if case .downloading = state[model] { continue }
            state[model] = LocalWhisperModelStore.isDownloaded(model) ? .installed : .notStarted
        }
    }

    /// Download `model` via WhisperKit's real `download(variant:downloadBase:progressCallback:)`
    /// — a genuine network call with real, live progress, never simulated. Guards against
    /// starting a second overlapping download while one is already in flight for this variant.
    func download(_ model: LocalWhisperModel) async throws {
        if case .downloading = state[model] { return }
        state[model] = .downloading(0)
        let destination = LocalWhisperModelStore.variantRoot(model)
        try? FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)

        do {
            let folder = try await WhisperKit.download(
                variant: model.rawValue,
                downloadBase: destination,
                progressCallback: { [weak self] progress in
                    let fraction = progress.fractionCompleted
                    Task { @MainActor in self?.state[model] = .downloading(fraction) }
                }
            )
            LocalWhisperModelStore.persistResolvedPath(folder, for: model)
            state[model] = .installed
            refreshFromDisk()
        } catch {
            state[model] = .failed(error.localizedDescription)
            lastError = error.localizedDescription
            throw error
        }
    }

    /// Cancel an in-flight download for `model`, resetting its row back to "Get". WhisperKit's
    /// `download(variant:downloadBase:progressCallback:)` has no cancellation hook, so this is a
    /// UI-level cancel: it stops tracking the download as active and clears any partial files so
    /// a later "Get" starts clean, rather than pretending to abort the underlying network task.
    func cancel(_ model: LocalWhisperModel) {
        guard case .downloading = state[model] else { return }
        try? LocalWhisperModelStore.remove(model)
        state[model] = .notStarted
    }

    /// Delete a downloaded model's files, reset its state, and evict any cached in-memory
    /// `WhisperKit` instance so a stale, deleted-on-disk model can't keep transcribing.
    func delete(_ model: LocalWhisperModel) throws {
        try LocalWhisperModelStore.remove(model)
        state[model] = .notStarted
        Task { await LocalWhisperInferenceCache.shared.evict(model) }
    }
}
