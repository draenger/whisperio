import Foundation
import LLM

/// Which chat template an on-device GGUF expects. Qwen2.5 ships ChatML; Llama-3.2 uses the
/// header-id turn format (which LLM.swift has no preset for — we build it literally below).
enum LocalLLMTemplateKind: Hashable, Sendable {
    case chatML
    case llama3

    /// Map to an LLM.swift `Template`, injecting `systemPrompt` into the slot the format supports.
    /// The `stopSequence` baked here is what LLM's loader hands to the sampler, so it must match the
    /// suffix tokens the rendered prompt uses (`<|im_end|>` / `<|eot_id|>`).
    func template(systemPrompt: String?) -> Template {
        switch self {
        case .chatML:
            return .chatML(systemPrompt)
        case .llama3:
            // LLM.swift only ships a Llama-2 `.llama` preset ([INST]/<<SYS>>); Llama-3.2 uses the
            // header-id turn format, so build it by hand. Deliberately NO literal `<|begin_of_text|>`
            // prefix: the GGUF tokenizer already adds BOS (add_bos_token=true) and LLM.swift's encode
            // parses special tokens, so a literal one here would double the BOS.
            return Template(
                system: ("<|start_header_id|>system<|end_header_id|>\n\n", "<|eot_id|>"),
                user: ("<|start_header_id|>user<|end_header_id|>\n\n", "<|eot_id|>"),
                bot: ("<|start_header_id|>assistant<|end_header_id|>\n\n", "<|eot_id|>"),
                stopSequence: "<|eot_id|>",
                systemPrompt: systemPrompt
            )
        }
    }
}

/// One downloadable on-device LLM ("Intelligence") offered to devices without Apple Intelligence.
/// `id` is the stable slug used everywhere — the on-disk filename (`<id>.gguf`), the `state`
/// dictionary key, and the value the app stores in `WhisperioSettings.chatModel` to pick this model.
struct LocalLLMModel: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let repo: String
    let file: String
    /// Pre-download size estimate in MB (published figure for the Manage-models row) — once on disk,
    /// the real size must come from `LocalLLMModelManager.onDiskSizeBytes(_:)`, never this constant.
    let sizeMB: Int
    /// Minimum physical RAM (GiB) this quant needs to load without being jetsammed; gates
    /// `LocalLLMModelManager.availableModels`.
    let minRAMGB: Int
    let template: LocalLLMTemplateKind
    let blurb: String

    /// HuggingFace direct-download URL for this model's GGUF file.
    var downloadURL: URL {
        URL(string: "https://huggingface.co/\(repo)/resolve/main/\(file)")!
    }

    /// Pre-download size estimate in bytes (see `sizeMB`). Never present this as the measured on-disk
    /// size — that comes from `LocalLLMModelManager.onDiskSizeBytes(_:)`.
    var approximateDownloadSizeBytes: Int64 { Int64(sizeMB) * 1_000_000 }
}

enum LocalLLMCatalog {
    static let all: [LocalLLMModel] = [
        LocalLLMModel(
            id: "qwen2.5-0.5b-instruct",
            name: "Qwen2.5 0.5B Instruct",
            repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
            file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            sizeMB: 400,
            minRAMGB: 3,
            template: .chatML,
            blurb: "Tiny · runs on any device"
        ),
        LocalLLMModel(
            id: "qwen2.5-1.5b-instruct",
            name: "Qwen2.5 1.5B Instruct",
            repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
            file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            sizeMB: 1050,
            minRAMGB: 4,
            template: .chatML,
            blurb: "Balanced · recommended"
        ),
        LocalLLMModel(
            id: "qwen2.5-3b-instruct",
            name: "Qwen2.5 3B Instruct",
            repo: "Qwen/Qwen2.5-3B-Instruct-GGUF",
            file: "qwen2.5-3b-instruct-q4_k_m.gguf",
            sizeMB: 2000,
            minRAMGB: 6,
            template: .chatML,
            blurb: "Best quality · newer devices"
        ),
        LocalLLMModel(
            id: "llama-3.2-1b-instruct",
            name: "Llama 3.2 1B Instruct",
            repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
            file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
            sizeMB: 800,
            minRAMGB: 3,
            template: .llama3,
            blurb: "Meta · compact"
        ),
    ]

    static func model(id: String) -> LocalLLMModel? {
        all.first { $0.id == id }
    }
}

/// Shared error factory for the on-device LLM feature. A free function (nonisolated) so both the
/// `@MainActor` manager's background download handler and the engine actor can build errors.
func localLLMError(_ message: String) -> NSError {
    NSError(domain: "Whisperio.LocalLLM", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
