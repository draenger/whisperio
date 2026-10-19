package ai.whisperio.android.ui.history

import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** CONTRACT-1.1 F1-F3 as pure functions (no Android): search, chips and day grouping over the Room list. */
data class HistoryFilters(
    val query: String = "",
    /** Empty = every source; otherwise a row must come from one of these. */
    val sources: Set<RecordingSource> = emptySet(),
    val failedOnly: Boolean = false,
    /** CONTRACT-1.2 F3: empty = every category; otherwise category ids, with [NO_CATEGORY] standing for "None". */
    val categories: Set<String> = emptySet(),
) {
    val active: Boolean get() = query.isNotBlank() || sources.isNotEmpty() || failedOnly || categories.isNotEmpty()

    companion object {
        /** Filter value for recordings without a category (real ids are never empty). */
        const val NO_CATEGORY = ""
    }
}

/**
 * Full Unicode lowercase on both sides (Ł/ł, Ż/ż fold; diacritics still matter). Blank [query] matches everything.
 * [categoryLabel] is the row's category as shown to the user (CONTRACT-1.2 F3: search matches it), null when none.
 */
fun matchesQuery(rec: Recording, query: String, categoryLabel: String? = null): Boolean {
    val q = query.trim().lowercase(Locale.ROOT)
    if (q.isEmpty()) return true
    return (rec.transcript?.lowercase(Locale.ROOT)?.contains(q) == true) ||
        rec.provider.lowercase(Locale.ROOT).contains(q) ||
        (categoryLabel?.lowercase(Locale.ROOT)?.contains(q) == true)
}

/**
 * Search AND chips AND category chips; keeps the incoming (newest first) order. [categoryLabelOf] maps a category id to
 * its display label (seed labels are localised, so the caller supplies them).
 */
fun applyFilters(
    items: List<Recording>,
    f: HistoryFilters,
    categoryLabelOf: (String) -> String? = { null },
): List<Recording> = items.filter {
    matchesQuery(it, f.query, it.category?.let(categoryLabelOf)) &&
        (f.sources.isEmpty() || it.source in f.sources) &&
        (!f.failedOnly || it.status == RecordingStatus.FAILED) &&
        (f.categories.isEmpty() || (it.category ?: HistoryFilters.NO_CATEGORY) in f.categories)
}

enum class DayKind { TODAY, YESTERDAY, DATE }

data class DayGroup(val kind: DayKind, val date: LocalDate, val items: List<Recording>)

/** Consecutive rows of the same local calendar day (device zone, injected) under one header. */
fun groupByDay(items: List<Recording>, nowMs: Long, zone: ZoneId): List<DayGroup> {
    val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
    val groups = mutableListOf<DayGroup>()
    for (rec in items) {
        val date = Instant.ofEpochMilli(rec.createdAt).atZone(zone).toLocalDate()
        val last = groups.lastOrNull()
        if (last != null && last.date == date) {
            groups[groups.lastIndex] = last.copy(items = last.items + rec)
        } else {
            val kind = when (date) {
                today -> DayKind.TODAY
                today.minusDays(1) -> DayKind.YESTERDAY
                else -> DayKind.DATE
            }
            groups += DayGroup(kind, date, listOf(rec))
        }
    }
    return groups
}
