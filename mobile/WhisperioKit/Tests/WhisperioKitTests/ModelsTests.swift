import Testing
import Foundation
@testable import WhisperioKit

struct ModelsTests {
    // Recordings persisted before the category field existed must keep decoding — the
    // field is optional, so a legacy blob simply yields nil (no migration required).
    @Test func legacyRecordingWithoutCategoryDecodes() throws {
        let legacy = """
        {
            "id": "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8",
            "filename": "clip.caf",
            "timestamp": 700000000,
            "duration": 4.2,
            "status": "completed",
            "provider": "ondevice",
            "transcription": "hello world"
        }
        """.data(using: .utf8)!
        let r = try JSONDecoder().decode(Recording.self, from: legacy)
        #expect(r.category == nil)
        #expect(r.transcription == "hello world")
    }

    // A set category survives an encode/decode roundtrip (i.e. it actually persists).
    @Test func categoryRoundtrips() throws {
        var rec = Recording(filename: "clip.caf", duration: 1, status: .completed,
                            provider: .onDevice, transcription: "hi")
        rec.category = "ideas"
        let data = try JSONEncoder().encode(rec)
        let decoded = try JSONDecoder().decode(Recording.self, from: data)
        #expect(decoded.category == "ideas")
        #expect(decoded == rec)
    }
}
