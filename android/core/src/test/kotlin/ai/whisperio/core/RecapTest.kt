package ai.whisperio.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RecapTest {
    private val utc: ZoneId = ZoneOffset.UTC
    private val warsaw: ZoneId = ZoneId.of("Europe/Warsaw")

    private fun at(zone: ZoneId, y: Int, mo: Int, d: Int, h: Int = 12, mi: Int = 0, s: Int = 0, nano: Int = 0): Long =
        LocalDateTime.of(y, mo, d, h, mi, s, nano).atZone(zone).toInstant().toEpochMilli()

    private fun words(n: Int) = List(n) { "w" }.joinToString(" ")

    private fun item(
        id: String, createdAt: Long, nWords: Int = 3, durationMs: Long = 6_000, done: Boolean = true,
        provider: String = "openai", category: String? = null, text: String? = words(nWords),
    ) = RecapItem(id, createdAt, durationMs, text, done, provider, category)

    // 2026-10-21 is a Wednesday; its week is Mon 10-19 .. Sun 10-25.
    private val wed = at(utc, 2026, 10, 21)

    @Test fun weekStartIsMondayForEveryDayOfTheWeek() {
        for (d in 19..25) assertEquals(LocalDate.of(2026, 10, 19), Recap.weekStart(at(utc, 2026, 10, d), utc))
        assertEquals(LocalDate.of(2026, 10, 26), Recap.weekStart(at(utc, 2026, 10, 26, 0), utc))
    }

    @Test fun sundayLastMillisecondIsInTheWeekAndMondayMidnightIsNot_utc() {
        val sunLast = at(utc, 2026, 10, 25, 23, 59, 59, 999_000_000)
        val monFirst = at(utc, 2026, 10, 26, 0)
        val monBefore = at(utc, 2026, 10, 19, 0) - 1
        val monStart = at(utc, 2026, 10, 19, 0)
        val items = listOf(
            item("a", sunLast, 1), item("b", monFirst, 10), item("c", monBefore, 100), item("d", monStart, 1000),
        )
        val s = Recap.compute(items, wed, utc)
        assertEquals(1001, s.words)
        assertEquals(2, s.notes)
        assertEquals(1000, s.wordsPerDay[0])
        assertEquals(1, s.wordsPerDay[6])
    }

    @Test fun sundayVsMondayInWarsaw() {
        val now = at(warsaw, 2026, 10, 21)
        val sunLast = at(warsaw, 2026, 10, 25, 23, 59, 59, 999_000_000)
        val monFirst = at(warsaw, 2026, 10, 26, 0)
        val bounds = Recap.weekBounds(LocalDate.of(2026, 10, 19), warsaw)
        assertTrue(sunLast in bounds)
        assertTrue(monFirst !in bounds)
        assertEquals(monFirst, bounds.last + 1)
        val s = Recap.compute(listOf(item("a", sunLast, 5), item("b", monFirst, 7)), now, warsaw)
        assertEquals(5, s.words)
        assertEquals(5, s.wordsPerDay[6])
        // Warsaw Monday 00:00 is still Sunday 23:00 in UTC: the same instant lands on a different local day there.
        val utcView = Recap.compute(listOf(item("b", monFirst, 7)), at(utc, 2026, 10, 21), utc)
        assertEquals(7, utcView.words)
        assertEquals(7, utcView.wordsPerDay[6])
    }

    @Test fun springForwardWeekIs167Hours() {
        // Warsaw DST starts Sunday 2026-03-29 02:00 -> 03:00; the week Mon 03-23 .. Sun 03-29 is one hour short.
        val start = LocalDate.of(2026, 3, 23)
        val b = Recap.weekBounds(start, warsaw)
        assertEquals(167L * 3_600_000, b.last + 1 - b.first)
        val sunEvening = at(warsaw, 2026, 3, 29, 23, 30)
        val monMorning = at(warsaw, 2026, 3, 30, 0, 0)
        val s = Recap.compute(
            listOf(item("a", sunEvening, 4), item("b", monMorning, 9), item("c", at(warsaw, 2026, 3, 23, 0), 2)),
            at(warsaw, 2026, 3, 25), warsaw,
        )
        assertEquals(start, s.weekStart)
        assertEquals(6, s.words)
        assertEquals(2, s.wordsPerDay[0])
        assertEquals(4, s.wordsPerDay[6])
    }

    @Test fun fallBackWeekIs169Hours() {
        // Warsaw DST ends Sunday 2026-10-25 03:00 -> 02:00.
        val b = Recap.weekBounds(LocalDate.of(2026, 10, 19), warsaw)
        assertEquals(169L * 3_600_000, b.last + 1 - b.first)
        // Both the first and the second 02:30 on Sunday belong to Sunday.
        val local = LocalDateTime.of(2026, 10, 25, 2, 30).atZone(warsaw)
        val first = local.withEarlierOffsetAtOverlap().toInstant().toEpochMilli()
        val second = local.withLaterOffsetAtOverlap().toInstant().toEpochMilli()
        assertEquals(3_600_000L, second - first)
        val s = Recap.compute(listOf(item("a", first, 1), item("b", second, 2)), at(warsaw, 2026, 10, 22), warsaw)
        assertEquals(3, s.wordsPerDay[6])
    }

    @Test fun onlyDoneItemsWithTextCount() {
        val items = listOf(
            item("ok", wed, 4),
            item("failed", wed, 50, done = false, text = null),
            item("failedWithText", wed, 50, done = false),
            item("blank", wed, 50, text = "  \n"),
            item("null", wed, 50, text = null),
        )
        val s = Recap.compute(items, wed, utc)
        assertEquals(1, s.notes)
        assertEquals(4, s.words)
    }

    @Test fun emptyWeekIsEmpty() {
        val s = Recap.compute(emptyList(), wed, utc)
        assertTrue(s.isEmpty)
        assertEquals(0, s.words)
        assertNull(s.speakingWpm)
        assertEquals(0, s.minutesSaved)
        assertEquals(List(7) { 0 }, s.wordsPerDay)
        assertNull(s.noteOfWeek)
        assertEquals(0 to 0, s.streakCurrent to s.streakBest)
    }

    @Test fun wpmIsNullAtExactly005MinutesAndShownJustAbove() {
        val at3000 = Recap.compute(listOf(item("a", wed, 10, durationMs = 3_000)), wed, utc)
        assertNull(at3000.speakingWpm)
        val at3001 = Recap.compute(listOf(item("a", wed, 10, durationMs = 3_001)), wed, utc)
        assertEquals(Math.round(10 / (3_001 / 60_000.0)).toInt(), at3001.speakingWpm)
        val zero = Recap.compute(listOf(item("a", wed, 10, durationMs = 0)), wed, utc)
        assertNull(zero.speakingWpm)
    }

    @Test fun wpmRounds() {
        // 100 words in 1 minute = 100; 100 words in 90 s = 66.67 -> 67.
        assertEquals(100, Recap.compute(listOf(item("a", wed, 100, durationMs = 60_000)), wed, utc).speakingWpm)
        assertEquals(67, Recap.compute(listOf(item("a", wed, 100, durationMs = 90_000)), wed, utc).speakingWpm)
    }

    @Test fun minutesSavedRoundsToNearestAndNeverNegative() {
        // 380 words / 38 wpm = 10 min typing. Spoken 2.5 min -> 7.5 -> 8 (half up).
        assertEquals(8, Recap.compute(listOf(item("a", wed, 380, durationMs = 150_000)), wed, utc).minutesSaved)
        // Spoken 2.4 min -> 7.6 -> 8; spoken 2.6 min -> 7.4 -> 7.
        assertEquals(8, Recap.compute(listOf(item("a", wed, 380, durationMs = 144_000)), wed, utc).minutesSaved)
        assertEquals(7, Recap.compute(listOf(item("a", wed, 380, durationMs = 156_000)), wed, utc).minutesSaved)
        // Talking slower than typing: clamped to 0.
        assertEquals(0, Recap.compute(listOf(item("a", wed, 10, durationMs = 600_000)), wed, utc).minutesSaved)
    }

    @Test fun savedLineShowsFromOneMinuteUp() {
        fun stats(words: Int, ms: Long) = Recap.compute(listOf(item("a", wed, words, durationMs = ms)), wed, utc)
        // 10 words in 10 min: slower than typing -> clamped 0 -> hidden.
        assertEquals(0, stats(10, 600_000).minutesSaved)
        assertFalse(stats(10, 600_000).showsSaved)
        // 38 words = 1 min typing, spoken 0.6 min -> 0.4 -> 0 -> hidden.
        assertEquals(0, stats(38, 36_000).minutesSaved)
        assertFalse(stats(38, 36_000).showsSaved)
        // 76 words = 2 min typing, spoken 1 min -> 1 -> shown.
        assertEquals(1, stats(76, 60_000).minutesSaved)
        assertTrue(stats(76, 60_000).showsSaved)
        // 380 words = 10 min typing, spoken 5 min -> 5 -> shown.
        assertEquals(5, stats(380, 300_000).minutesSaved)
        assertTrue(stats(380, 300_000).showsSaved)
    }

    @Test fun noteOfTheWeekIsTheLongestAndTiesGoToTheNewest() {
        val items = listOf(
            item("short", at(utc, 2026, 10, 20), 3),
            item("long1", at(utc, 2026, 10, 21), 9),
            item("long2", at(utc, 2026, 10, 23), 9),
            item("lastWeek", at(utc, 2026, 10, 18), 99),
        )
        val s = Recap.compute(items, wed, utc)
        assertEquals("long2", s.noteOfWeek?.id)
        assertEquals(9, s.noteOfWeekWords)
        val single = Recap.compute(listOf(item("only", wed, 2)), wed, utc)
        assertEquals("only", single.noteOfWeek?.id)
    }

    @Test fun streakEndingTodayCountsToday() {
        val items = (19..21).map { item("d$it", at(utc, 2026, 10, it)) }
        val s = Recap.compute(items, wed, utc)
        assertEquals(3, s.streakCurrent)
        assertEquals(3, s.streakBest)
    }

    @Test fun streakEndingYesterdayIsStillCurrent() {
        val items = (19..20).map { item("d$it", at(utc, 2026, 10, it)) }
        val s = Recap.compute(items, wed, utc)
        assertEquals(2, s.streakCurrent)
    }

    @Test fun streakBrokenWhenLastDayWasTwoDaysAgo() {
        val items = (17..19).map { item("d$it", at(utc, 2026, 10, it)) }
        val s = Recap.compute(items, wed, utc)
        assertEquals(0, s.streakCurrent)
        assertEquals(3, s.streakBest)
    }

    @Test fun streakCountsFailedAndTextlessItemsAndMergesSameDay() {
        val items = listOf(
            item("a", at(utc, 2026, 10, 19, 8), done = false, text = null),
            item("a2", at(utc, 2026, 10, 19, 20)),
            item("b", at(utc, 2026, 10, 20), done = false, text = null),
            item("c", at(utc, 2026, 10, 21), done = false, text = null),
        )
        val s = Recap.compute(items, wed, utc)
        assertEquals(3, s.streakCurrent)
        assertEquals(3, s.streakBest)
        assertEquals(1, s.notes) // only the done item with text is a note
    }

    @Test fun bestStreakIsAllTimeAndIndependentOfTheCurrentOne() {
        val old = (1..5).map { item("o$it", at(utc, 2026, 9, it)) }
        val items = old + item("now", wed)
        val s = Recap.compute(items, wed, utc)
        assertEquals(1, s.streakCurrent)
        assertEquals(5, s.streakBest)
    }

    @Test fun streaksAcrossDstUseLocalDays() {
        val items = listOf(
            item("a", at(warsaw, 2026, 10, 24, 23, 30)),
            item("b", at(warsaw, 2026, 10, 25, 0, 10)),
            item("c", at(warsaw, 2026, 10, 26, 1, 0)),
        )
        val s = Recap.compute(items, at(warsaw, 2026, 10, 26, 9), warsaw)
        assertEquals(3, s.streakCurrent)
    }

    @Test fun categorySplitCountsNotesWithNoneForNull() {
        val items = listOf(
            item("1", wed, category = "work"), item("2", wed, category = "work"),
            item("3", wed, category = null), item("4", wed, category = "ideas"),
            item("5", wed, category = "ideas"), item("6", wed, category = null),
        )
        val c = Recap.compute(items, wed, utc).categories
        assertEquals(listOf<Pair<String?, Int>>("ideas" to 2, "work" to 2, null to 2), c.map { it.category to it.notes })
    }

    @Test fun providerMinutesAreSummedAndSortedWithoutPrices() {
        val items = listOf(
            item("1", wed, durationMs = 60_000, provider = "groq"),
            item("2", wed, durationMs = 120_000, provider = "openai"),
            item("3", wed, durationMs = 30_000, provider = "groq"),
            item("4", wed, durationMs = 0, provider = "mistral"),
        )
        val p = Recap.compute(items, wed, utc).providers
        assertEquals(listOf("openai", "groq"), p.map { it.provider })
        assertEquals(2.0, p[0].minutes, 1e-9)
        assertEquals(1.5, p[1].minutes, 1e-9)
    }

    @Test fun weekNumberIsIso() {
        assertEquals(43, Recap.compute(emptyList(), wed, utc).weekNumber)
    }
}
