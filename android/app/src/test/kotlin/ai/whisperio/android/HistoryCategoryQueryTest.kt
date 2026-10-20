package ai.whisperio.android

import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.ui.history.HistoryFilters
import ai.whisperio.android.ui.history.applyFilters
import ai.whisperio.android.ui.history.matchesQuery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** CONTRACT-1.2 F3: category chips and the category label in search, AND-combined with the 1.1 filters. */
class HistoryCategoryQueryTest {
    private fun rec(
        id: String,
        category: String? = null,
        text: String? = "hello",
        source: RecordingSource = RecordingSource.APP,
        status: RecordingStatus = RecordingStatus.DONE,
    ) = Recording(
        id = id, createdAt = 1_000, durationMs = 1_000, status = status, provider = "openai", model = "m",
        language = "auto", transcript = text, source = source, category = category,
    )

    private val labels = mapOf("work" to "Praca", "ideas" to "Pomysły", "c_1" to "Siłownia")
    private fun ids(items: List<Recording>, f: HistoryFilters) = applyFilters(items, f) { labels[it] }.map { it.id }

    private val items = listOf(
        rec("w", "work"), rec("i", "ideas"), rec("c", "c_1"), rec("n", null),
        rec("wk", "work", source = RecordingSource.KEYBOARD),
        rec("wf", "work", status = RecordingStatus.FAILED, text = null),
    )

    @Test fun noCategoryFilterKeepsEverything() {
        assertEquals(items.map { it.id }, ids(items, HistoryFilters()))
        assertFalse(HistoryFilters().active)
    }

    @Test fun categoryChipSelectsThatCategoryOnly() {
        assertEquals(listOf("w", "wk", "wf"), ids(items, HistoryFilters(categories = setOf("work"))))
        assertTrue(HistoryFilters(categories = setOf("work")).active)
    }

    @Test fun severalChipsAreOr() {
        assertEquals(listOf("w", "i", "wk", "wf"), ids(items, HistoryFilters(categories = setOf("work", "ideas"))))
    }

    @Test fun noneChipSelectsUncategorised() {
        assertEquals(listOf("n"), ids(items, HistoryFilters(categories = setOf(HistoryFilters.NO_CATEGORY))))
        assertEquals(
            listOf("i", "n"),
            ids(items, HistoryFilters(categories = setOf(HistoryFilters.NO_CATEGORY, "ideas"))),
        )
    }

    @Test fun categoryAndSourceChipsAreAnded() {
        val f = HistoryFilters(sources = setOf(RecordingSource.KEYBOARD), categories = setOf("work"))
        assertEquals(listOf("wk"), ids(items, f))
    }

    @Test fun categoryAndFailedChipAreAnded() {
        assertEquals(listOf("wf"), ids(items, HistoryFilters(failedOnly = true, categories = setOf("work"))))
    }

    @Test fun searchMatchesTheCategoryLabelCaseAndPolishLetterFolded() {
        assertEquals(listOf("w", "wk", "wf"), ids(items, HistoryFilters(query = "PRACA")))
        assertEquals(listOf("i"), ids(items, HistoryFilters(query = "pomysły")))
        assertEquals(listOf("c"), ids(items, HistoryFilters(query = "siłow"))) // custom name
        assertEquals(emptyList<String>(), ids(items, HistoryFilters(query = "silow"))) // diacritics still matter
    }

    @Test fun searchAndCategoryChipAreAnded() {
        assertEquals(listOf("w", "wk", "wf"), ids(items, HistoryFilters(query = "prac", categories = setOf("work"))))
        assertEquals(emptyList<String>(), ids(items, HistoryFilters(query = "prac", categories = setOf("ideas"))))
    }

    @Test fun searchStillMatchesTranscriptAndProvider() {
        assertEquals(listOf("w", "i", "c", "n", "wk"), ids(items, HistoryFilters(query = "hello")))
        assertTrue(matchesQuery(rec("x", "work"), "openai", "Praca"))
    }

    @Test fun missingLabelFallsBackToTranscriptOnly() {
        assertFalse(matchesQuery(rec("x", "gone"), "gone", null))
        assertTrue(matchesQuery(rec("x", "work"), "praca", "Praca"))
    }
}
