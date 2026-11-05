#if DEBUG
import Testing
import Foundation
import CoreData
import SwiftData
@testable import WhisperioKit

/// Guards against CloudKit schema drift. `CloudKitSchema.swift`'s hand-built
/// `NSEntityDescription`s exist because SwiftData gives no supported way to ask a
/// `ModelContainer` for the `NSPersistentCloudKitContainer` schema it generates under the hood —
/// so the CloudKit-safe shape of `RecordingEntity`/`DigestEntity` is duplicated by hand in
/// `WhisperioCloudKit`. Nothing enforces that the two stay in sync: add a field to the `@Model`
/// and forget the hand-built schema, and that field silently never reaches CloudKit (or vice
/// versa). These tests turn that drift into a red CI build.
///
/// The expected field sets below are transcribed directly from `RecordingEntity`/`DigestEntity`'s
/// stored properties (see RecordingEntity.swift / DigestEntity.swift) as a literal set, so a change
/// on *either* side (the `@Model` or the hand-built schema) without updating this test is exactly
/// the drift this guards against; `literalsMatchTheSwiftDataModels` additionally pins the literals
/// to the real `@Model`s through SwiftData's headless `Schema`, so the literal itself can't go stale.
// Nested in SwiftDataSerialTests: SwiftData suites must not run in parallel with each other.
extension SwiftDataSerialTests {
struct CloudKitSchemaParityTests {
    /// `RecordingEntity`'s stored properties, excluding nothing — CloudKit requires every one of
    /// them representable, so the hand-built schema must carry all of them and no more.
    private static let recordingEntityFields: Set<String> = [
        "id", "filename", "timestamp", "duration", "statusRaw", "providerRaw",
        "transcription", "error", "category", "render", "renderPresetID",
        "segmentsData", "speakerNamesData", "source", "modifiedAt"
    ]

    /// `DigestEntity`'s stored properties.
    private static let digestEntityFields: Set<String> = [
        "dayKey", "date", "recordingIDsData", "groupsData", "summary",
        "summaryGeneratedAt", "modifiedAt"
    ]

    /// The literal sets above are still hand-transcribed, and `source` (added to `RecordingEntity`
    /// 2026-07-19) slipped past both the literal AND the hand-built schema for three months — the
    /// drift this file exists to catch. SwiftData's `Schema` can be built headlessly (no store, no
    /// CloudKit), so this derives the stored-property names from the real `@Model`s and pins the
    /// literals to them: a new stored property now fails here until BOTH the literal and the
    /// hand-built schema (and the Production promotion, see CLOUDKIT_SCHEMA_PROMOTION.md) follow.
    @Test func literalsMatchTheSwiftDataModels() {
        let schema = Schema([RecordingEntity.self, DigestEntity.self])
        let byName = Dictionary(uniqueKeysWithValues: schema.entities.map { ($0.name, $0) })
        let recording = Set(byName["RecordingEntity"]?.properties.map(\.name) ?? [])
        let digest = Set(byName["DigestEntity"]?.properties.map(\.name) ?? [])
        #expect(recording == Self.recordingEntityFields, "RecordingEntity stored properties drifted from the literal: \(recording.symmetricDifference(Self.recordingEntityFields))")
        #expect(digest == Self.digestEntityFields, "DigestEntity stored properties drifted from the literal: \(digest.symmetricDifference(Self.digestEntityFields))")
    }

    @Test func recordingSchemaMatchesModelFields() {
        let entity = WhisperioCloudKit.recordingEntityDescription()
        let schemaFields = Set(entity.properties.map(\.name))
        #expect(schemaFields == Self.recordingEntityFields)
        #expect(entity.name == "CD_RecordingEntity")
    }

    @Test func digestSchemaMatchesModelFields() {
        let entity = WhisperioCloudKit.digestEntityDescription()
        let schemaFields = Set(entity.properties.map(\.name))
        #expect(schemaFields == Self.digestEntityFields)
        #expect(entity.name == "CD_DigestEntity")
    }

    // Every attribute must be optional (never `.unique`) — CloudKit's private-database schema
    // requires this; a non-optional or unique attribute would make the schema push fail (or,
    // worse, succeed against Development but reject a later record that leaves a field nil).
    @Test func recordingSchemaAttributesAreAllOptional() {
        let entity = WhisperioCloudKit.recordingEntityDescription()
        for property in entity.properties {
            guard let attribute = property as? NSAttributeDescription else {
                Issue.record("Unexpected non-attribute property: \(property.name)")
                continue
            }
            #expect(attribute.isOptional, "\(attribute.name) must be optional for CloudKit")
        }
    }

    @Test func digestSchemaAttributesAreAllOptional() {
        let entity = WhisperioCloudKit.digestEntityDescription()
        for property in entity.properties {
            guard let attribute = property as? NSAttributeDescription else {
                Issue.record("Unexpected non-attribute property: \(property.name)")
                continue
            }
            #expect(attribute.isOptional, "\(attribute.name) must be optional for CloudKit")
        }
    }

    // `cloudkit/whisperio.ckdb` is what `Scripts/cloudkit-schema.sh import-dev` adds to Development
    // (see CLOUDKIT_SCHEMA_RUNBOOK.md). It must declare every attribute of the hand-built schema as
    // `CD_<name>` with the type NSPersistentCloudKitContainer gives it, plus `CD_entityName`, or a
    // field added to the model would never be offered for promotion. Extra fields in the file are
    // allowed: fields deployed to Production can never be deleted, and the export keeps them.
    @Test func repoSchemaFileDeclaresEveryAttribute() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("cloudkit/whisperio.ckdb")
        let declared = Self.ckdbFields(try String(contentsOf: url, encoding: .utf8))
        for entity in [WhisperioCloudKit.recordingEntityDescription(), WhisperioCloudKit.digestEntityDescription()] {
            let name = entity.name ?? "?"
            let fields = declared[name] ?? [:]
            #expect(!fields.isEmpty, "whisperio.ckdb has no RECORD TYPE \(name)")
            #expect(fields["CD_entityName"] == "STRING", "\(name).CD_entityName")
            for case let attribute as NSAttributeDescription in entity.properties {
                #expect(fields["CD_" + attribute.name] == Self.cloudKitType(attribute.attributeType),
                        "whisperio.ckdb: \(name).CD_\(attribute.name) should be \(Self.cloudKitType(attribute.attributeType))")
            }
        }
    }

    @Test func ckdbParserReadsQuotedNamesFlagsAndCRLF() {
        let text = "DEFINE SCHEMA\r\n    RECORD TYPE CD_X (\r\n        \"___recordID\" REFERENCE QUERYABLE,\r\n"
            + "        CD_a    STRING QUERYABLE SORTABLE,\r\n        CD_b TIMESTAMP,\r\n        GRANT READ TO \"_world\"\r\n    );\r\n"
        #expect(Self.ckdbFields(text) == ["CD_X": ["___recordID": "REFERENCE", "CD_a": "STRING", "CD_b": "TIMESTAMP"]])
    }

    /// The CloudKit field type NSPersistentCloudKitContainer mirrors a Core Data attribute type to.
    static func cloudKitType(_ type: NSAttributeType) -> String {
        switch type {
        case .stringAttributeType, .UUIDAttributeType: return "STRING"
        case .dateAttributeType: return "TIMESTAMP"
        case .doubleAttributeType: return "DOUBLE"
        case .binaryDataAttributeType: return "BYTES"
        default: return "unmapped(\(type.rawValue))"
        }
    }

    /// Record type -> field -> type, from CloudKit schema language text (`cktool export-schema`).
    static func ckdbFields(_ text: String) -> [String: [String: String]] {
        var out: [String: [String: String]] = [:]
        var current: String?
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("RECORD TYPE ") {
                current = line.dropFirst("RECORD TYPE ".count)
                    .split(whereSeparator: { $0 == " " || $0 == "(" }).first.map(String.init)
                continue
            }
            if line.hasPrefix(");") { current = nil; continue }
            guard let recordType = current, !line.isEmpty, !line.hasPrefix("GRANT") else { continue }
            let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
            guard parts.count >= 2 else { continue }
            var type = String(parts[1])
            if type.hasSuffix(",") { type.removeLast() }
            out[recordType, default: [:]][parts[0].replacingOccurrences(of: "\"", with: "")] = type
        }
        return out
    }
}
}
#endif
