import Foundation
import SwiftData

/// SwiftData mirror of the `DailyDigest` value type, shaped to be CloudKit-safe — the same
/// shape rules as `RecordingEntity`: every attribute optional-or-defaulted, no `.unique`
/// constraint (CloudKit can't enforce uniqueness across devices; dedup happens at read time in
/// `DigestSyncStore` instead).
///
/// `DailyDigest.groups`/`recordingIDs` are arrays of structs/UUIDs, which CloudKit's private
/// schema can't hold as a native relationship without a lot of extra plumbing — so they're
/// JSON-encoded into `recordingIDsData`/`groupsData` and decoded back on the `digest` projection,
/// same trick a plain-Foundation Kit already leans on elsewhere for tolerant Codable payloads.
@available(iOS 17, macOS 14, *)
@Model
public final class DigestEntity {
    /// Stable identity shared with `DailyDigest.id` (the YYYY-MM-DD day key). Defaulted (never
    /// `.unique`) so CloudKit accepts it; dedup on this happens at read time.
    public var dayKey: String = ""
    public var date: Date = Date()
    /// JSON-encoded `[UUID]` (`DailyDigest.recordingIDs`). Decoded tolerantly on read.
    public var recordingIDsData: Data?
    /// JSON-encoded `[DigestGroup]` (`DailyDigest.groups`). Decoded tolerantly on read.
    public var groupsData: Data?
    public var summary: String?
    public var summaryGeneratedAt: Date?
    /// Last local mutation time — the comparison clock for the last-writer-wins merge in
    /// `DigestSyncStore.upsert` (a stale/out-of-order write with an older time is dropped) and
    /// the tie-breaker that resolves CloudKit-produced duplicates to the newest row on read.
    public var modifiedAt: Date = Date()

    public init(
        dayKey: String = "",
        date: Date = Date(),
        recordingIDsData: Data? = nil,
        groupsData: Data? = nil,
        summary: String? = nil,
        summaryGeneratedAt: Date? = nil,
        modifiedAt: Date = Date()
    ) {
        self.dayKey = dayKey
        self.date = date
        self.recordingIDsData = recordingIDsData
        self.groupsData = groupsData
        self.summary = summary
        self.summaryGeneratedAt = summaryGeneratedAt
        self.modifiedAt = modifiedAt
    }
}

@available(iOS 17, macOS 14, *)
public extension DigestEntity {
    /// Build an entity from a `DailyDigest` value. `modifiedAt` seeds to now unless supplied.
    convenience init(_ d: DailyDigest, modifiedAt: Date = Date()) {
        self.init(
            dayKey: d.id,
            date: d.date,
            recordingIDsData: try? JSONEncoder().encode(d.recordingIDs),
            groupsData: try? JSONEncoder().encode(d.groups),
            summary: d.summary,
            summaryGeneratedAt: d.summaryGeneratedAt,
            modifiedAt: modifiedAt
        )
    }

    /// Project back to the pure `DailyDigest` value type. Undecodable/missing JSON payloads
    /// tolerantly fall back to an empty array — mirroring the value type's own tolerant decode
    /// stance — rather than losing the whole row.
    var digest: DailyDigest {
        let recordingIDs = recordingIDsData.flatMap { try? JSONDecoder().decode([UUID].self, from: $0) } ?? []
        let groups = groupsData.flatMap { try? JSONDecoder().decode([DigestGroup].self, from: $0) } ?? []
        return DailyDigest(
            id: dayKey,
            date: date,
            recordingIDs: recordingIDs,
            groups: groups,
            summary: summary,
            summaryGeneratedAt: summaryGeneratedAt
        )
    }

    /// Overwrite mutable fields from a `DailyDigest` value, bumping `modifiedAt`. Identity
    /// (`dayKey`) is left untouched so this stays an in-place update of the same row.
    func apply(_ d: DailyDigest, modifiedAt: Date = Date()) {
        date = d.date
        recordingIDsData = try? JSONEncoder().encode(d.recordingIDs)
        groupsData = try? JSONEncoder().encode(d.groups)
        summary = d.summary
        summaryGeneratedAt = d.summaryGeneratedAt
        self.modifiedAt = modifiedAt
    }
}
