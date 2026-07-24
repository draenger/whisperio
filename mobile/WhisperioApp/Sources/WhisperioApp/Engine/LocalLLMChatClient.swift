import Foundation
import WhisperioKit
import LLM

/// `ChatLLM` backed by an on-device downloadable GGUF (via LLM.swift / llama.cpp). Powers rewrite,
/// journaling and command-mode on devices without Apple Intelligence. Generation runs off the main
/// thread inside `LocalLLMEngineCache`; the loaded model is cached (loading a GGUF is very expensive)
/// and never reloaded per call.
final class LocalLLMChatClient: ChatLLM, @unchecked Sendable {
    let modelID: String

    init(modelID: String) {
        self.modelID = modelID
    }

    /// Real, synchronous disk truth (safe off any thread — `LocalLLMModelStore` is actor-agnostic),
    /// so a not-downloaded model fails the chat chain honestly instead of pretending to be ready.
    var isConfigured: Bool {
        LocalLLMModelStore.isDownloaded(modelID)
    }

    func complete(messages: [ChatMessage], model: String, temperature: Double) async throws -> String {
        guard let catalogModel = LocalLLMCatalog.model(id: modelID) else {
            throw localLLMError("Unknown on-device model \"\(modelID)\".")
        }
        // Resolve the path through the actor-agnostic store (not the @MainActor manager) so this stays
        // off the main thread and consistent with the synchronous `isConfigured` above.
        guard LocalLLMModelStore.isDownloaded(modelID) else {
            throw localLLMError("On-device model \"\(catalogModel.name)\" is not downloaded.")
        }
        let url = LocalLLMModelStore.fileURL(for: modelID)

        // LLM.getCompletion feeds its input VERBATIM to the model — unlike respond(to:), it does NOT
        // apply the template's preprocess or history — so we render the full chat prompt (system +
        // prior turns + final user turn) here, then hand the finished string over.
        let prompt = Self.renderPrompt(messages: messages, kind: catalogModel.template)

        let output = try await LocalLLMEngineCache.shared.generate(
            prompt: prompt,
            temperature: temperature,
            modelID: modelID,
            url: url,
            kind: catalogModel.template
        )
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Render `[ChatMessage]` into a single fully-formatted prompt string via the mapped template's
    /// `preprocess`. System messages (LLM.swift's `Role` has no `.system`) are folded into the
    /// template's system slot; the last user message is the `input`, everything before it is history.
    private static func renderPrompt(messages: [ChatMessage], kind: LocalLLMTemplateKind) -> String {
        func isRole(_ m: ChatMessage, _ role: String) -> Bool {
            m.role.lowercased() == role
        }

        let systemPrompt = messages
            .filter { isRole($0, "system") }
            .map(\.content)
            .joined(separator: "\n\n")

        let turns = messages.filter { !isRole($0, "system") }
        let lastUserIndex = turns.lastIndex { isRole($0, "user") }

        let input: String
        let historyTurns: [ChatMessage]
        if let lastUserIndex {
            input = turns[lastUserIndex].content
            historyTurns = Array(turns[..<lastUserIndex])
        } else {
            // No user turn (unusual) — feed the last available turn as input, no prior history.
            input = turns.last?.content ?? ""
            historyTurns = []
        }

        let history: [Chat] = historyTurns.map { turn in
            (role: isRole(turn, "assistant") ? Role.bot : Role.user, content: turn.content)
        }

        let template = kind.template(systemPrompt: systemPrompt.isEmpty ? nil : systemPrompt)
        return template.preprocess(input, history)
    }
}

/// Process-wide cache + serializer for on-device `LLM` instances. Loading a GGUF is very expensive
/// (hundreds of MB → llama.cpp model + context), so each model is loaded once and reused. Runs off
/// the main thread (this is a plain actor, not `@MainActor`). Generation is serialized because
/// LLM.getCompletion refuses concurrent use (its `isAvailable` guard would return a sentinel string);
/// a tail-task chain queues callers instead of tripping it. Internal (not `private`) only so the
/// manager can `evict` on delete — not part of the app's chat surface.
actor LocalLLMEngineCache {
    static let shared = LocalLLMEngineCache()

    private var engines: [String: LLM] = [:]
    private var loading: [String: Task<LLM, Error>] = [:]
    /// Tail of the serialized generation chain — every `generate` awaits the previous one before it
    /// starts, so overlapping callers queue rather than racing the single-use LLM.
    private var tail: Task<Void, Never> = Task {}

    /// Drop the cached model for `id` (called when its file is deleted) so it isn't reused from memory.
    func evict(_ id: String) {
        engines[id] = nil
        loading[id] = nil
    }

    /// Lazily load + cache the `LLM` for `id`, guarding against concurrent loads of the same model.
    /// The template loaded here only fixes the sampler's stop sequence (per-kind, constant); the
    /// per-call system prompt is applied when we render the prompt, not here.
    private func engine(modelID: String, url: URL, kind: LocalLLMTemplateKind) async throws -> LLM {
        if let cached = engines[modelID] { return cached }
        if let inFlight = loading[modelID] { return try await inFlight.value }

        let task = Task { () throws -> LLM in
            guard let llm = LLM(from: url, template: kind.template(systemPrompt: nil), maxTokenCount: 2048) else {
                throw localLLMError("Failed to load on-device model at \(url.lastPathComponent).")
            }
            return llm
        }
        loading[modelID] = task
        do {
            let llm = try await task.value
            engines[modelID] = llm
            loading[modelID] = nil
            return llm
        } catch {
            loading[modelID] = nil
            throw error
        }
    }

    func generate(prompt: String, temperature: Double, modelID: String, url: URL,
                  kind: LocalLLMTemplateKind) async throws -> String {
        // Chain onto the current tail atomically (no await before we reassign `tail`), so each caller
        // takes a distinct slot in the queue and only runs after the prior generation finishes.
        let previous = tail
        let work = Task { () throws -> String in
            _ = await previous.value
            let llm = try await self.engine(modelID: modelID, url: url, kind: kind)
            llm.temp = Float(temperature)
            return await llm.getCompletion(from: prompt)
        }
        tail = Task { _ = try? await work.value }
        return try await work.value
    }
}
