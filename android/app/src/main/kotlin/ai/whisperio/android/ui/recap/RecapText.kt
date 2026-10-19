package ai.whisperio.android.ui.recap

import ai.whisperio.android.R
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.core.RecapItem
import ai.whisperio.core.RecapStats
import android.content.res.Resources
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Rows as the pure recap sees them. The caller hides rows with a pending delete (by id) before calling. */
fun List<Recording>.toRecapItems(): List<RecapItem> = map {
    RecapItem(
        id = it.id,
        createdAt = it.createdAt,
        durationMs = it.durationMs,
        transcript = it.transcript,
        done = it.status == RecordingStatus.DONE,
        provider = it.provider,
        category = null,
    )
}

/**
 * Every recap string in one place (screen, History card, share text and the share bitmap), so the numbers and the
 * EN/PL plural forms are formatted the same way everywhere. Numbers use the device locale.
 */
class RecapText(private val res: Resources, private val locale: Locale = Locale.getDefault()) {
    private val ints = NumberFormat.getIntegerInstance(locale)
    private val oneDecimal = NumberFormat.getNumberInstance(locale).apply {
        maximumFractionDigits = 1
        minimumFractionDigits = 0
    }

    fun num(n: Int): String = ints.format(n)

    private fun quantity(id: Int, n: Int): String = res.getQuantityString(id, n, num(n))

    fun words(n: Int) = quantity(R.plurals.recap_n_words, n)
    fun notes(n: Int) = quantity(R.plurals.recap_n_notes, n)
    fun days(n: Int) = quantity(R.plurals.recap_n_days, n)
    fun minutes(n: Int) = quantity(R.plurals.recap_n_minutes, n)
    fun savedCaption(n: Int): String = res.getQuantityString(R.plurals.recap_saved_caption, n)

    fun minutesShort(minutes: Double): String = res.getString(R.string.recap_minutes_short, oneDecimal.format(minutes))

    /** "—" when the speaking pace is not meaningful (<= 0.05 minutes spoken). */
    fun wpm(stats: RecapStats): String = stats.speakingWpm?.let(::num) ?: res.getString(R.string.recap_wpm_none)

    fun weekLabel(stats: RecapStats): String {
        val f = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
        val range = res.getString(R.string.recap_range, f.format(stats.weekStart), f.format(stats.weekStart.plusDays(6)))
        return res.getString(R.string.recap_week, stats.weekNumber, range)
    }

    /** Share-sheet text: words, notes, minutes saved, streak (iOS `shareText`). Numbers only. */
    fun shareText(stats: RecapStats): String = res.getString(
        R.string.recap_share_text,
        words(stats.words), notes(stats.notes), minutes(stats.minutesSaved), days(stats.streakCurrent),
    )
}
