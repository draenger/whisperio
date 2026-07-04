import Testing
import Foundation
@testable import WhisperioKit

struct DigestTests {
    // A UTC calendar (fixed) so day boundaries are deterministic in tests regardless of the host.
    private func calendar(_ tzIdentifier: String) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tzIdentifier)!
        return cal
    }

    private func rec(_ ts: Date, category: String? = nil) -> Recording {
        Recording(filename: "clip.caf", timestamp: ts, duration: 1, status: .completed,
                  transcription: "hi", category: category)
    }

    // MARK: - Day bucketing across time zones / DST

    // The same instant lands on a different calendar day depending on the calendar's time zone.
    @Test func dayKeyDependsOnTimeZone() {
        // 2026-01-15 04:00 UTC — still 2026-01-14 in New York (UTC-5), already 15th in UTC.
        let instant = Date(timeIntervalSince1970: 1_768_449_600) // 2026-01-15T04:00:00Z
        #expect(DigestGrouping.dayKey(for: instant, calendar: calendar("UTC")) == "2026-01-15")
        #expect(DigestGrouping.dayKey(for: instant, calendar: calendar("America/New_York")) == "2026-01-14")
    }

    // Day key is always zero-padded YYYY-MM-DD and sorts lexically as a date.
    @Test func dayKeyIsZeroPadded() {
        // 2026-03-05T12:00:00Z
        let instant = Date(timeIntervalSince1970: 1_772_712_000)
        #expect(DigestGrouping.dayKey(for: instant, calendar: calendar("UTC")) == "2026-03-05")
    }

    // Across a US spring-forward DST transition, buckets still fall on the right local day.
    @Test func bucketByDayAcrossDST() {
        let cal = calendar("America/New_York")
        // US DST 2026 begins 2026-03-08 02:00 local. One note just before, one well after.
        // 2026-03-08T06:30:00Z == 01:30 EST (still the 8th, before the jump).
        let before = rec(Date(timeIntervalSince1970: 1_772_951_400))
        // 2026-03-09T15:00:00Z == 11:00 EDT on the 9th.
        let after = rec(Date(timeIntervalSince1970: 1_773_068_400))
        let buckets = DigestGrouping.bucketByDay([before, after], calendar: cal)
        #expect(buckets["2026-03-08"]?.count == 1)
        #expect(buckets["2026-03-09"]?.count == 1)
        #expect(buckets.count == 2)
    }

    @Test func bucketByDayGroupsSameDay() {
        let cal = calendar("UTC")
        let a = rec(Date(timeIntervalSince1970: 1_768_392_000)) // 2026-01-14T12:00Z
        let b = rec(Date(timeIntervalSince1970: 1_768_435_800)) // 2026-01-15T00:10Z
        let c = rec(Date(timeIntervalSince1970: 1_768_478_400)) // 2026-01-15T12:00Z
        let buckets = DigestGrouping.bucketByDay([a, b, c], calendar: cal)
        #expect(buckets["2026-01-14"]?.count == 1)
        #expect(buckets["2026-01-15"]?.count == 2)
    }

    // MARK: - Grouping preserves order, nil/unknown → uncategorized

    @Test func groupByCategoryPreservesOrder() {
        let now = Date(timeIntervalSince1970: 1_768_478_400)
        let recs = [
            rec(now, category: "ideas"),
            rec(now, category: "work"),
            rec(now, category: "work"),
        ]
        let groups = DigestGrouping.groupByCategory(recs, order: ["work", "personal", "ideas"])
        // Order follows the passed-in `order`, not encounter order; empty "personal" is dropped.
        #expect(groups.map(\.categoryID) == ["work", "ideas"])
        #expect(groups[0].recordingIDs.count == 2)
        #expect(groups[1].recordingIDs.count == 1)
    }

    @Test func groupByCategoryNilAndUnknownBecomeUncategorized() {
        let now = Date(timeIntervalSince1970: 1_768_478_400)
        let recs = [
            rec(now, category: "work"),
            rec(now, category: nil),
            rec(now, category: "does-not-exist"),
        ]
        let groups = DigestGrouping.groupByCategory(recs, order: ["work", "personal"])
        #expect(groups.map(\.categoryID) == ["work", "uncategorized"])
        // nil + unknown both fold into the trailing uncategorized group.
        #expect(groups.last?.recordingIDs.count == 2)
    }

    @Test func groupByCategoryOmitsUncategorizedWhenEmpty() {
        let now = Date(timeIntervalSince1970: 1_768_478_400)
        let groups = DigestGrouping.groupByCategory([rec(now, category: "work")], order: ["work"])
        #expect(groups.map(\.categoryID) == ["work"])
    }

    // MARK: - uncategorized selection

    @Test func uncategorizedSelectsOnlyNilCategory() {
        let now = Date(timeIntervalSince1970: 1_768_478_400)
        let recs = [
            rec(now, category: "work"),
            rec(now, category: nil),
            rec(now, category: "unknown-id"),
        ]
        // Raw selection: only the nil-category recording; an unknown-but-present id is not nil.
        let out = DigestGrouping.uncategorized(recs)
        #expect(out.count == 1)
        #expect(out.first?.category == nil)
    }

    // MARK: - Prompt builders produce stable expected substrings

    @Test func classificationPromptContainsIdsAndCategories() {
        let noteID = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let prompt = DigestPromptBuilder.classificationPrompt(
            notes: [(id: noteID, text: "  buy milk  ")],
            categories: [(id: "todo", label: "To-do")]
        )
        #expect(prompt.contains("todo — To-do"))
        #expect(prompt.contains("uncategorized — none of the above"))
        #expect(prompt.contains("6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8: buy milk"))
        #expect(prompt.contains("single JSON object"))
    }

    @Test func summaryPromptContainsDayGroupsAndLanguageInstruction() {
        // 2026-01-15T12:00:00Z
        let day = Date(timeIntervalSince1970: 1_768_478_400)
        let prompt = DigestPromptBuilder.summaryPrompt(
            day: day,
            groups: [(label: "Work", notes: ["shipped the build", "  reviewed PRs "])],
            locale: "en_US"
        )
        #expect(prompt.contains("2026-01-15"))
        #expect(prompt.contains("## Work"))
        #expect(prompt.contains("- shipped the build"))
        #expect(prompt.contains("- reviewed PRs"))
        #expect(prompt.contains("same language as the transcripts"))
        #expect(prompt.contains("en_US"))
    }

    // MARK: - DailyDigest Codable round-trip + legacy decode

    @Test func dailyDigestRoundtrips() throws {
        let id1 = UUID(); let id2 = UUID()
        let digest = DailyDigest(
            id: "2026-01-15",
            date: Date(timeIntervalSince1970: 1_768_478_400),
            recordingIDs: [id1, id2],
            groups: [DigestGroup(categoryID: "work", recordingIDs: [id1], blurb: "shipped things"),
                     DigestGroup(categoryID: "uncategorized", recordingIDs: [id2])],
            summary: "A productive day.",
            summaryGeneratedAt: Date(timeIntervalSince1970: 1_768_500_000)
        )
        let data = try JSONEncoder().encode(digest)
        let decoded = try JSONDecoder().decode(DailyDigest.self, from: data)
        #expect(decoded == digest)
    }

    // A legacy blob missing groups/summary/summaryGeneratedAt still decodes (tolerant Codable).
    @Test func dailyDigestLegacyDecode() throws {
        let legacy = """
        {
            "id": "2026-01-15",
            "date": 700000000,
            "recordingIDs": []
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(DailyDigest.self, from: legacy)
        #expect(decoded.id == "2026-01-15")
        #expect(decoded.groups.isEmpty)
        #expect(decoded.summary == nil)
        #expect(decoded.summaryGeneratedAt == nil)
    }

    // A DigestGroup missing blurb (and even categoryID) decodes tolerantly.
    @Test func digestGroupLegacyDecode() throws {
        let legacy = """
        { "recordingIDs": [] }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(DigestGroup.self, from: legacy)
        #expect(decoded.categoryID == "uncategorized")
        #expect(decoded.blurb == nil)
    }
}
