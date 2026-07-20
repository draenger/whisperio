import Foundation

/// The on-device Whisper (WhisperKit/CoreML) model variants Whisperio offers — small/base/tiny,
/// matching the design's three-tier Manage-models rows. Raw values are the exact folder names
/// WhisperKit's own `argmaxinc/whisperkit-coreml` HuggingFace repo publishes under, handed
/// straight to `WhisperKit.download(variant:)`/`WhisperKitConfig(model:)`. Lives in the app (not
/// WhisperioKit) because it names a WhisperKit implementation detail that only WhisperKit-linked
/// targets (App, Mac) should know about — the Kit itself only knows the opaque `localWhisperModel`
/// string (see `WhisperioSettings`).
enum LocalWhisperModel: String, CaseIterable, Sendable {
    case tiny = "openai_whisper-tiny"
    case base = "openai_whisper-base"
    case small = "openai_whisper-small"

    var displayName: String {
        switch self {
        case .tiny: return "Whisper tiny"
        case .base: return "Whisper base"
        case .small: return "Whisper small"
        }
    }

    /// Matches mob-core.jsx's M_MODELS copy exactly.
    var subtitle: String {
        switch self {
        case .tiny: return "Fastest · English"
        case .base: return "Balanced · multilingual"
        case .small: return "Higher accuracy · 99 languages"
        }
    }

    /// A PRE-DOWNLOAD size estimate only (matches the design mock's published figures). Once a
    /// model is actually on disk, its real size must come from
    /// `LocalWhisperModelManager.onDiskSizeBytes(_:)` — a real `FileManager` sum — never this
    /// constant. Never present this number as if it were the measured on-disk size.
    var approximateDownloadSizeBytes: Int64 {
        switch self {
        case .tiny: return 75_000_000
        case .base: return 142_000_000
        case .small: return 466_000_000
        }
    }
}
