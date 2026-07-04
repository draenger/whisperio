import Foundation

/// One recording flattened into the shape the GitHub sync engine mirrors: the transcript,
/// its optional AI render, and the metadata that lands in the Markdown frontmatter. Built by
/// the app from a `Recording` + its resolved category; the sync engine stays UI/store-free.
public struct SyncItem: Sendable, Equatable {
    public let id: UUID
    /// Stable machine id of the category (drives the repo folder + frontmatter `category`).
    public let categoryId: String
    /// Human-facing category name (kept alongside the id for future frontmatter/UI needs).
    public let categoryLabel: String
    public let timestamp: Date
    /// Engine that produced the transcript, or nil when never transcribed / unknown.
    public let provider: ProviderID?
    public let transcript: String
    /// The AI-rewritten output, or nil when the recording was never rendered — `render.md`
    /// is only emitted when this is present.
    public let aiRender: String?
    public let duration: TimeInterval

    public init(
        id: UUID,
        categoryId: String,
        categoryLabel: String,
        timestamp: Date,
        provider: ProviderID?,
        transcript: String,
        aiRender: String?,
        duration: TimeInterval
    ) {
        self.id = id
        self.categoryId = categoryId
        self.categoryLabel = categoryLabel
        self.timestamp = timestamp
        self.provider = provider
        self.transcript = transcript
        self.aiRender = aiRender
        self.duration = duration
    }
}

/// A day's synthesized summary, mirrored to the repo as `<prefix>/YYYY-MM-DD-summary.md`.
/// `sourceIds` links back to the recordings that fed the summary.
public struct DailySynthesis: Sendable, Equatable {
    public let date: Date
    public let body: String
    public let sourceIds: [UUID]

    public init(date: Date, body: String, sourceIds: [UUID]) {
        self.date = date
        self.body = body
        self.sourceIds = sourceIds
    }
}
