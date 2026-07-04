import Foundation

// Daily digest — the persisted result of grouping a day's recordings by category and asking
// the LLM for a per-group blurb + an overall summary. The kit stays Foundation-only and pure:
// grouping lives in DigestGrouping, the prompt text in DigestPrompt, and the app target owns the
// networking (dedicated URLSession, real timeouts, Bearer auth) and persistence. These are just
// the value types those pieces exchange, with tolerant Codable so an older/partial blob decodes.

/// One category's slice of a day's digest: the recordings that fell into `categoryID` (the
/// "uncategorized" bucket uses id "uncategorized") plus an optional AI-written blurb for them.
public struct DigestGroup: Codable, Sendable, Equatable {
    public var categoryID: String
    public var recordingIDs: [UUID]
    public var blurb: String?

    public init(categoryID: String, recordingIDs: [UUID], blurb: String? = nil) {
        self.categoryID = categoryID
        self.recordingIDs = recordingIDs
        self.blurb = blurb
    }

    // Tolerant decoding — a legacy/partial blob missing any field falls back to a default
    // instead of throwing, so a stored digest is never lost.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        categoryID = try c.decodeIfPresent(String.self, forKey: .categoryID) ?? "uncategorized"
        recordingIDs = try c.decodeIfPresent([UUID].self, forKey: .recordingIDs) ?? []
        blurb = try c.decodeIfPresent(String.self, forKey: .blurb)
    }
}

/// A single day's digest, identified by its `dayKey` (YYYY-MM-DD). Holds the flat list of that
/// day's recordings, the per-category groups, and the optional overall summary + when it was made.
public struct DailyDigest: Codable, Sendable, Identifiable, Equatable {
    /// The day key (YYYY-MM-DD) — also the stable identity for lists/persistence.
    public var id: String
    public var date: Date
    public var recordingIDs: [UUID]
    public var groups: [DigestGroup]
    public var summary: String?
    public var summaryGeneratedAt: Date?

    public init(
        id: String,
        date: Date,
        recordingIDs: [UUID] = [],
        groups: [DigestGroup] = [],
        summary: String? = nil,
        summaryGeneratedAt: Date? = nil
    ) {
        self.id = id
        self.date = date
        self.recordingIDs = recordingIDs
        self.groups = groups
        self.summary = summary
        self.summaryGeneratedAt = summaryGeneratedAt
    }

    // Tolerant decoding — a legacy blob (e.g. persisted before `summary`/`summaryGeneratedAt`
    // existed) decodes to sensible empties instead of throwing. `id` and `date` are required.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        date = try c.decode(Date.self, forKey: .date)
        recordingIDs = try c.decodeIfPresent([UUID].self, forKey: .recordingIDs) ?? []
        groups = try c.decodeIfPresent([DigestGroup].self, forKey: .groups) ?? []
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        summaryGeneratedAt = try c.decodeIfPresent(Date.self, forKey: .summaryGeneratedAt)
    }
}
