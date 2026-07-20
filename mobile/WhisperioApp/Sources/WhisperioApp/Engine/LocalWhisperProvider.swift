import Foundation
import WhisperKit
import WhisperioKit

/// Caches loaded `WhisperKit` (CoreML) instances per variant so a dictation never pays the
/// multi-hundred-MB model load/compile cost on every single transcription. Deliberately an
/// `actor` (NOT `@MainActor`) — WhisperKit's own class is not yet Sendable as of the pinned
/// 0.18.x line, so isolating it off the UI actor keeps CoreML load/predict work from ever
/// contending with SwiftUI, and avoids smuggling a non-Sendable type across actor boundaries.
actor LocalWhisperInferenceCache {
    static let shared = LocalWhisperInferenceCache()

    private var cache: [LocalWhisperModel: WhisperKit] = [:]

    /// Returns the cached instance for `model`, or loads a fresh one from `folder` (the exact,
    /// already-resolved on-disk folder — see `LocalWhisperModelStore.resolvedFolder(_:)`).
    /// `download: false` guarantees this can never silently trigger a network fetch mid-
    /// transcription — that only ever happens from the explicit Get action in Manage models.
    /// Kept `private`: the instance itself never leaves the actor (see `transcribe(model:folder:
    /// audioPath:)` below) since `WhisperKit` isn't yet `Sendable` — letting a caller hold the
    /// reference outside the actor would defeat the whole point of isolating it here.
    private func whisperKit(for model: LocalWhisperModel, folder: URL) async throws -> WhisperKit {
        if let cached = cache[model] { return cached }
        let config = WhisperKitConfig(
            model: model.rawValue,
            modelFolder: folder.path,
            verbose: false,
            prewarm: false,
            load: true,
            download: false
        )
        let pipe = try await WhisperKit(config)
        cache[model] = pipe
        return pipe
    }

    /// Transcribes entirely inside the actor so the non-Sendable `WhisperKit` instance never
    /// crosses an actor boundary — only plain, Sendable values (a file path in; `TranscriptionResult`
    /// — itself `@unchecked Sendable` — out) do. This also gives concurrent calls for the same
    /// cached model real mutual exclusion via the actor, instead of racing the same instance.
    func transcribe(model: LocalWhisperModel, folder: URL, audioPath: String) async throws -> [TranscriptionResult] {
        let pipe = try await whisperKit(for: model, folder: folder)
        return try await pipe.transcribe(audioPath: audioPath)
    }

    /// Drop a cached instance — called when its backing model folder is deleted, so an in-flight
    /// or later transcription can't keep succeeding against files that no longer exist on disk.
    func evict(_ model: LocalWhisperModel) {
        cache[model] = nil
    }
}

/// On-device transcription via WhisperKit (CoreML) — a second, opt-in offline engine alongside
/// Apple Speech. Mirrors `AppleSpeechProvider`'s shape and error style exactly.
struct LocalWhisperProvider: TranscriptionProvider {
    let id: ProviderID = .localWhisper
    let model: LocalWhisperModel

    init(modelRawValue: String) {
        model = LocalWhisperModel(rawValue: modelRawValue) ?? .base
    }

    /// Real, synchronous on-disk check — exactly parallel to `AppleSpeechProvider.isConfigured`'s
    /// real `SFSpeechRecognizer` availability check. No mocking: a model that hasn't been
    /// downloaded yet reports `false`, not a fabricated "ready". Reads the same actor-agnostic
    /// `LocalWhisperModelStore` the MainActor `LocalWhisperModelManager` uses, so this synchronous,
    /// nonisolated property never needs to hop actors to stay consistent with the UI.
    var isConfigured: Bool {
        LocalWhisperModelStore.isDownloaded(model)
    }

    func transcribe(_ clip: AudioClip) async throws -> String {
        guard LocalWhisperModelStore.isDownloaded(model),
              let folder = LocalWhisperModelStore.resolvedFolder(model) else {
            throw Self.err("\(model.displayName) isn't downloaded yet. Go to Settings ▸ Manage models to download it.")
        }

        let ext = (clip.filename as NSString).pathExtension
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(ext.isEmpty ? "m4a" : ext)
        try clip.data.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let results = try await LocalWhisperInferenceCache.shared.transcribe(
            model: model, folder: folder, audioPath: url.path
        )
        return results.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.LocalWhisper", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
