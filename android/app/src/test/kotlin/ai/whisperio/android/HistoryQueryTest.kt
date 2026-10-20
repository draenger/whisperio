package ai.whisperio.android

import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.ui.history.DayKind
import ai.whisperio.android.ui.history.HistoryFilters
import ai.whisperio.android.ui.history.applyFilters
import ai.whisperio.android.ui.history.groupByDay
import ai.whisperio.android.ui.history.matchesQuery
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryQueryTest {
    private val now = 1_792_230_060_000L // 2026-10-17 09:41 UTC

    private fun rec(
        id: String,
        at: Long = now,
        text: String? = "hello",
        provider: String = "openai",
        status: RecordingStatus = RecordingStatus.DONE,
        source: RecordingSource = RecordingSource.APP,
    ) = Recording(
        id = id, createdAt = at, durationMs = 1_000, status = status, provider = provider, model = "m",
        language = "auto", transcript = text, source = source,
    )

    @Test fun emptyAndBlankQueryMatchEverything() {
        assertTrue(matchesQuery(rec("a", text = null), ""))
        assertTrue(matchesQuery(rec("a"), "   "))
    }

    @Test fun caseFoldsAsciiAndPolishLetters() {
        assertTrue(matchesQuery(rec("a", text = "Zażółć gęślą jaźń"), "ZAŻÓŁĆ"))
        assertTrue(matchesQuery(rec("a", text = "łódź"), "Ł"))
        assertTrue(matchesQuery(rec("a", text = "ŁÓDŹ"), "łódź"))
        assertTrue(matchesQuery(rec("a", text = "Żaba"), "żABA"))
    }

    @Test fun diacriticsStillMatter() {
        assertFalse(matchesQuery(rec("a", text = "łódź"), "lodz"))
        assertFalse(matchesQuery(rec("a", text = "lodz"), "łódź"))
        assertFalse(matchesQuery(rec("a", text = "kolo"), "koło"))
    }

    @Test fun matchesProviderAsWellAsTranscript() {
        val r = rec("a", text = "nothing relevant", provider = "elevenlabs")
        assertTrue(matchesQuery(r, "Eleven"))
        assertFalse(matchesQuery(r, "groq"))
    }

    @Test fun nullTranscriptOnlyMatchesProvider() {
        val r = rec("a", text = null, provider = "groq")
        assertFalse(matchesQuery(r, "hello"))
        assertTrue(matchesQuery(r, "groq"))
    }

    @Test fun likeWildcardsAreLiteral() {
        assertFalse(matchesQuery(rec("a", text = "100 percent"), "%"))
        assertTrue(matchesQuery(rec("a", text = "100% sure"), "%"))
        assertFalse(matchesQuery(rec("a", text = "abc"), "a_c"))
    }

    @Test fun sourceChipsAreOrAndFailedChipIsAnd() {
        val items = listOf(
            rec("app"),
            rec("kb", source = RecordingSource.KEYBOARD),
            rec("kbFail", source = RecordingSource.KEYBOARD, status = RecordingStatus.FAILED, text = null),
            rec("widget", source = RecordingSource.WIDGET),
        )
        val two = applyFilters(items, HistoryFilters(sources = setOf(RecordingSource.KEYBOARD, RecordingSource.WIDGET)))
        assertEquals(listOf("kb", "kbFail", "widget"), two.map { it.id })
        val failed = applyFilters(items, HistoryFilters(failedOnly = true))
        assertEquals(listOf("kbFail"), failed.map { it.id })
        val both = applyFilters(items, HistoryFilters(sources = setOf(RecordingSource.APP), failedOnly = true))
        assertTrue(both.isEmpty())
    }

    @Test fun filtersAndSearchCombine() {
        val items = listOf(
            rec("a", text = "invoice for Anna"),
            rec("b", text = "invoice for Bob", source = RecordingSource.TILE),
            rec("c", text = "milk", source = RecordingSource.TILE),
        )
        val f = HistoryFilters(query = "invoice", sources = setOf(RecordingSource.TILE))
        assertEquals(listOf("b"), applyFilters(items, f).map { it.id })
        assertEquals(items.map { it.id }, applyFilters(items, HistoryFilters()).map { it.id })
        assertTrue(f.active)
        assertFalse(HistoryFilters(query = "  ").active)
    }

    @Test fun groupsTodayYesterdayAndDates() {
        val items = listOf(
            rec("t1", at = now),
            rec("t2", at = now - 3 * 3_600_000L),
            rec("y", at = now - 26 * 3_600_000L),
            rec("d", at = now - 5 * 86_400_000L),
        )
        val g = groupByDay(items, now, ZoneOffset.UTC)
        assertEquals(listOf(DayKind.TODAY, DayKind.YESTERDAY, DayKind.DATE), g.map { it.kind })
        assertEquals(listOf("t1", "t2"), g[0].items.map { it.id })
        assertEquals(LocalDate.of(2026, 10, 12), g[2].date)
    }

    @Test fun midnightBoundaryFollowsInjectedZone() {
        val at = 1_792_278_000_000L // 2026-10-17 23:00 UTC = 01:00 on the 18th in Warsaw
        val items = listOf(rec("x", at = at))
        val laterNow = at + 3_600_000L // 00:00 UTC on the 18th = 02:00 in Warsaw
        assertEquals(DayKind.YESTERDAY, groupByDay(items, laterNow, ZoneOffset.UTC).single().kind)
        assertEquals(DayKind.TODAY, groupByDay(items, laterNow, ZoneId.of("Europe/Warsaw")).single().kind)
    }

    @Test fun emptyListHasNoGroups() {
        assertTrue(groupByDay(emptyList(), now, ZoneOffset.UTC).isEmpty())
    }
}
