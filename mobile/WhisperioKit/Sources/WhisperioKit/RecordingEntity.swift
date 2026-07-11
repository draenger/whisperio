import Foundation
import SwiftData

/// SwiftData mirror of the `Recording` value type, shaped to be CloudKit-safe.
///
/// CloudKit's private-database schema requires every attribute to be optional or have a
/// default value, and forbids `.unique` constraints (uniqueness is not enforceable across
/// devices). So every stored property here is optional-or-defaulted and there is no unique
/// index — dedup happens at read time in `RecordingSyncStore` instead. `modifiedAt` is added
/// so a future last-writer-wins reconciliation has a timestamp to compare.
@available(iOS 17, macOS 14, *)
@Model
public final class RecordingEntity {
    /// Stable identity shared with the `Recording` value type. Defaulted (never `.unique`)
    /// so CloudKit accepts it; dedup on this happens at read time.
    public var id: UUID = UUID()
    public var filename: String = ""
    public var timestamp: Date = Date()
    public var duration: TimeInterval = 0
    /// Persisted as the raw string of `Recording.Status` — enums aren't first-class in a
    /// CloudKit schema, and a plain `String` tolerates unknown future cases on decode.
    public var statusRaw: String = Recording.Status.pending.rawValue
    /// Persisted as the raw string of `ProviderID`; nil means "no provider yet".
    public var providerRaw: String?
    public var transcription: String?
    public var error: String?
    public var category: String?
    public var render: String?
    public var renderPresetID: String?
    /// Last local mutation time — the comparison clock for the last-writer-wins merge in
    /// `RecordingSyncStore.upsert` (a stale/out-of-order write with an older time is dropped) and
    /// the tie-breaker that resolves CloudKit-produced duplicates to the newest row on read.
    public var modifiedAt: Date = Date()

    public init(
        id: UUID = UUID(),
        filename: String = "",
        timestamp: Date = Date(),
        duration: TimeInterval = 0,
        statusRaw: String = Recording.Status.pending.rawValue,
        providerRaw: String? = nil,
        transcription: String? = nil,
        error: String? = nil,
        category: String? = nil,
        render: String? = nil,
        renderPresetID: String? = nil,
        modifiedAt: Date = Date()
    ) {
        self.id = id
        self.filename = filename
        self.timestamp = timestamp
        self.duration = duration
        self.statusRaw = statusRaw
        self.providerRaw = providerRaw
        self.transcription = transcription
        self.error = error
        self.category = category
        self.render = render
        self.renderPresetID = renderPresetID
        self.modifiedAt = modifiedAt
    }
}

@available(iOS 17, macOS 14, *)
public extension RecordingEntity {
    /// Build an entity from a `Recording` value. `modifiedAt` seeds to the recording's own
    /// `lastWriteAt` (its `updatedAt` if set, else its `timestamp`) unless supplied — *not*
    /// wall-clock `Date()`. This keeps the `modifiedAt == timestamp` "never edited" convention
    /// that `recording` (below) relies on: a never-edited `Recording` has `updatedAt == nil`,
    /// so `lastWriteAt == timestamp`, so the projected entity's `modifiedAt` matches `timestamp`
    /// and round-trips back to `updatedAt == nil` again.
    convenience init(_ r: Recording, modifiedAt: Date? = nil) {
        self.init(
            id: r.id,
            filename: r.filename,
            timestamp: r.timestamp,
            duration: r.duration,
            statusRaw: r.status.rawValue,
            providerRaw: r.provider?.rawValue,
            transcription: r.transcription,
            error: r.error,
            category: r.category,
            render: r.render,
            renderPresetID: r.renderPresetID,
            modifiedAt: modifiedAt ?? r.lastWriteAt
        )
    }

    /// Project back to the pure `Recording` value type. Unknown raw strings decode
    /// tolerantly: an unrecognised status falls back to `.pending`, an unrecognised
    /// provider to nil — mirroring the value type's optional-or-default decode stance.
    ///
    /// `updatedAt` carries the LWW clock across the projection: when the row has actually
    /// been edited (`modifiedAt != timestamp`) we pass `modifiedAt` through so
    /// `Recording.lastWriteAt` reflects the true last-edit time, not the creation
    /// timestamp. A never-edited row passes `nil` so serialization/equality of freshly
    /// created records is unchanged.
    var recording: Recording {
        Recording(
            id: id,
            filename: filename,
            timestamp: timestamp,
            duration: duration,
            status: Recording.Status(rawValue: statusRaw) ?? .pending,
            provider: providerRaw.flatMap(ProviderID.init(rawValue:)),
            transcription: transcription,
            error: error,
            category: category,
            render: render,
            renderPresetID: renderPresetID,
            updatedAt: (modifiedAt == timestamp) ? nil : modifiedAt
        )
    }

    /// Overwrite mutable fields from a `Recording` value, bumping `modifiedAt`. Identity
    /// (`id`) is left untouched so this stays an in-place update of the same row.
    func apply(_ r: Recording, modifiedAt: Date = Date()) {
        filename = r.filename
        timestamp = r.timestamp
        duration = r.duration
        statusRaw = r.status.rawValue
        providerRaw = r.provider?.rawValue
        transcription = r.transcription
        error = r.error
        category = r.category
        render = r.render
        renderPresetID = r.renderPresetID
        self.modifiedAt = modifiedAt
    }
}
