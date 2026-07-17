#if DEBUG
import Testing
import Foundation
import CoreData
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
/// stored properties (see RecordingEntity.swift / DigestEntity.swift) — deliberately as a literal
/// set, not derived via reflection, so a change on *either* side (the `@Model` or the hand-built
/// schema) without updating this test is exactly the drift this guards against.
struct CloudKitSchemaParityTests {
    /// `RecordingEntity`'s stored properties, excluding nothing — CloudKit requires every one of
    /// them representable, so the hand-built schema must carry all of them and no more.
    private static let recordingEntityFields: Set<String> = [
        "id", "filename", "timestamp", "duration", "statusRaw", "providerRaw",
        "transcription", "error", "category", "render", "renderPresetID",
        "segmentsData", "speakerNamesData", "modifiedAt"
    ]

    /// `DigestEntity`'s stored properties.
    private static let digestEntityFields: Set<String> = [
        "dayKey", "date", "recordingIDsData", "groupsData", "summary",
        "summaryGeneratedAt", "modifiedAt"
    ]

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
}
#endif
