package ai.whisperio.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.temporal.IsoFields
import java.time.temporal.TemporalAdjusters
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * CONTRACT-1.2 F1: pure weekly-recap metrics (iOS `RecapView.swift`). One history row as the recap sees it.
 * [done] = `status == DONE`; [category] null = uncategorised ("None"). Rows hidden by a pending delete are filtered
 * out by the caller (by id) before they get here.
 */
data class RecapItem(
    val id: String,
    val createdAt: Long,
    val durationMs: Long,
    val transcript: String?,
    val done: Boolean,
    val provider: String,
    val category: String? = null,
)

data class ProviderMinutes(val provider: String, val minutes: Double)

data class CategoryCount(val category: String?, val notes: Int)

data class RecapStats(
    /** Monday of the week (in the zone the stats were built with). Sunday is `weekStart.plusDays(6)`. */
    val weekStart: LocalDate,
    /** ISO week number of [weekStart]. */
    val weekNumber: Int,
    val words: Int,
    val notes: Int,
    val minutesSpoken: Double,
    /** Words per minute, null ("—") when [minutesSpoken] <= 0.05. */
    val speakingWpm: Int?,
    val minutesSaved: Int,
    /** Words per day, Monday..Sunday (always 7 values). */
    val wordsPerDay: List<Int>,
    val streakCurrent: Int,
    val streakBest: Int,
    /** The week item with the most words (ties: newest), or null when the week is empty. */
    val noteOfWeek: RecapItem?,
    val noteOfWeekWords: Int,
    /** Notes per category, biggest first (ties: label order, uncategorised last). */
    val categories: List<CategoryCount>,
    /** Minutes spoken per provider, most used first. No prices (D1). */
    val providers: List<ProviderMinutes>,
) {
    /** F1: the History card and the screen are hidden/empty when the week has no item with text. */
    val isEmpty: Boolean get() = notes == 0

    /** The History card shows "about N min saved" only from 1 minute up; "about 0 minutes" reads as a failure. */
    val showsSaved: Boolean get() = minutesSaved >= 1
}

object Recap {
    /** iOS `typingWPM`. */
    const val TYPING_WPM = 38.0

    /** Minutes spoken at or below which the WPM is "—" (iOS `:60-62`). */
    const val MIN_MINUTES_FOR_WPM = 0.05

    /** Monday of the week containing [now] in [zone]. */
    fun weekStart(now: Long, zone: ZoneId): LocalDate =
        Instant.ofEpochMilli(now).atZone(zone).toLocalDate().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    /** Half-open week bounds `[Monday 00:00, next Monday 00:00)` in epoch ms; correct across DST changes. */
    fun weekBounds(weekStart: LocalDate, zone: ZoneId): LongRange {
        val start = weekStart.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = weekStart.plusDays(7).atStartOfDay(zone).toInstant().toEpochMilli()
        return start until end
    }

    fun compute(items: List<RecapItem>, now: Long, zone: ZoneId): RecapStats {
        val start = weekStart(now, zone)
        val bounds = weekBounds(start, zone)
        val week = items.filter { it.done && !it.transcript.isNullOrBlank() && it.createdAt in bounds }
        val wordsOf = week.associateWith { wordCount(it.transcript) }

        val words = wordsOf.values.sum()
        val minutes = week.sumOf { it.durationMs } / 60_000.0
        val wpm = if (minutes > MIN_MINUTES_FOR_WPM) (words / minutes).roundToInt() else null
        val saved = max(0, (words / TYPING_WPM - minutes).roundToInt())

        val perDay = IntArray(7)
        for ((item, w) in wordsOf) {
            val day = ChronoUnit.DAYS.between(start, dayOf(item.createdAt, zone)).toInt()
            if (day in 0..6) perDay[day] += w
        }

        val (current, best) = streaks(items.map { dayOf(it.createdAt, zone) }.toSet(), dayOf(now, zone))

        val note = week.maxWithOrNull(compareBy<RecapItem> { wordsOf.getValue(it) }.thenBy { it.createdAt })

        val cats = week.groupingBy { it.category }.eachCount().map { CategoryCount(it.key, it.value) }
            .sortedWith(compareByDescending<CategoryCount> { it.notes }.thenBy { it.category == null }.thenBy { it.category.orEmpty() })

        val providers = week.filter { it.durationMs > 0 && it.provider.isNotBlank() }
            .groupBy { it.provider }
            .map { (p, rows) -> ProviderMinutes(p, rows.sumOf { it.durationMs } / 60_000.0) }
            .sortedWith(compareByDescending<ProviderMinutes> { it.minutes }.thenBy { it.provider })

        return RecapStats(
            weekStart = start,
            weekNumber = start.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR),
            words = words,
            notes = week.size,
            minutesSpoken = minutes,
            speakingWpm = wpm,
            minutesSaved = saved,
            wordsPerDay = perDay.toList(),
            streakCurrent = current,
            streakBest = best,
            noteOfWeek = note,
            noteOfWeekWords = note?.let { wordsOf.getValue(it) } ?: 0,
            categories = cats,
            providers = providers,
        )
    }

    private fun dayOf(ms: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()

    /** All-time streaks over days that have any recording (iOS `:139-141`); current counts if the run ends today or yesterday. */
    internal fun streaks(days: Set<LocalDate>, today: LocalDate): Pair<Int, Int> {
        if (days.isEmpty()) return 0 to 0
        var best = 0
        for (day in days) {
            if (days.contains(day.minusDays(1))) continue // not the start of a run
            var length = 1
            var next = day.plusDays(1)
            while (days.contains(next)) { length++; next = next.plusDays(1) }
            best = max(best, length)
        }
        var probe = if (days.contains(today)) today else today.minusDays(1)
        var current = 0
        while (days.contains(probe)) { current++; probe = probe.minusDays(1) }
        return current to best
    }
}
