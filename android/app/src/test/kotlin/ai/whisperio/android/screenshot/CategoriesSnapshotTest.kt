package ai.whisperio.android.screenshot

import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.settings.CustomCategory
import ai.whisperio.android.ui.history.HistoryDetailActions
import ai.whisperio.android.ui.history.HistoryDetailScreen
import ai.whisperio.android.ui.history.HistoryFilters
import ai.whisperio.android.ui.history.HistoryListScreen
import ai.whisperio.android.ui.settings.CategoriesActions
import ai.whisperio.android.ui.settings.CategoriesScreen
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import java.time.ZoneOffset
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

private const val PHONE = ScreenshotConfig.PHONE

/** CONTRACT-1.2 F3 snapshots (baselines are recorded by the batch gate, never by hand). */
private object CatFx {
    val customs get() = listOf(
        CustomCategory("c_1", Loc.t("Reading", "Czytanie"), 0),
        CustomCategory("c_2", Loc.t("Gym", "Siłownia"), 1),
    )

    val work get() = Fx.done.copy(category = "work")
    val ideas get() = Fx.doneTile.copy(category = "ideas")
    val custom get() = Fx.notInserted.copy(category = "c_2")
    val failedTagged get() = Fx.failed.copy(category = "todo")
    val tagged: List<Recording> get() = listOf(work, ideas, failedTagged, custom)
    val mixed: List<Recording> get() = listOf(work, Fx.doneTile, failedTagged, custom)
}

@Composable
private fun CategoryHistory(
    items: List<Recording> = CatFx.mixed,
    initial: HistoryFilters = HistoryFilters(),
) = HistoryListScreen(
    items, onOpen = {}, now = Fx.NOW, zone = ZoneOffset.UTC, initial = initial, customCategories = CatFx.customs,
)

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class CategoriesSnapshotTest {
    @get:Rule val rule = createComposeRule()
    private val noop = object : CategoriesActions {}

    @Test @Config(qualifiers = PHONE)
    fun historyTags() = rule.snapshot("categories_history_tags") { CategoryHistory() }

    @Test @Config(qualifiers = PHONE)
    fun historyTagsDark() = rule.snapshot("categories_history_tags", dark = true) { CategoryHistory() }

    @Test @Config(qualifiers = PHONE)
    fun historyChipSelected() = rule.snapshot("categories_history_chip") {
        CategoryHistory(initial = HistoryFilters(categories = setOf("work", "c_2")))
    }

    @Test @Config(qualifiers = PHONE)
    fun historyChipNone() = rule.snapshot("categories_history_chip_none") {
        CategoryHistory(initial = HistoryFilters(categories = setOf(HistoryFilters.NO_CATEGORY)))
    }

    @Test @Config(qualifiers = PHONE)
    fun historySearchByCategoryLabel() = rule.snapshot("categories_history_search") {
        CategoryHistory(initial = HistoryFilters(query = Loc.t("gym", "siłownia")))
    }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun historyTablet() = rule.snapshot("categories_history_tablet") { CategoryHistory() }

    @Test @Config(qualifiers = PHONE)
    fun historyFontScale2() = rule.snapshot("categories_history_font2", fontScale = 2f) { CategoryHistory() }

    @Test @Config(qualifiers = PHONE)
    fun detailCategorised() = rule.snapshot("categories_detail") {
        HistoryDetailScreen(CatFx.work, object : HistoryDetailActions {}, customCategories = CatFx.customs)
    }

    @Test @Config(qualifiers = PHONE)
    fun detailUncategorisedDark() = rule.snapshot("categories_detail_none", dark = true) {
        HistoryDetailScreen(Fx.done, object : HistoryDetailActions {}, customCategories = CatFx.customs)
    }

    @Test @Config(qualifiers = PHONE)
    fun detailMenuOpen() = rule.snapshot("categories_detail_menu") {
        HistoryDetailScreen(
            CatFx.custom, object : HistoryDetailActions {}, customCategories = CatFx.customs, initialCategoryMenuOpen = true,
        )
    }

    @Test @Config(qualifiers = PHONE)
    fun detailHiddenWhileTranscribing() = rule.snapshot("categories_detail_transcribing") {
        HistoryDetailScreen(
            Fx.done.copy(status = RecordingStatus.TRANSCRIBING, transcript = null),
            object : HistoryDetailActions {}, customCategories = CatFx.customs,
        )
    }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun detailTablet() = rule.snapshot("categories_detail_tablet") {
        HistoryDetailScreen(CatFx.work, object : HistoryDetailActions {}, customCategories = CatFx.customs)
    }

    @Test @Config(qualifiers = PHONE)
    fun detailFontScale2() = rule.snapshot("categories_detail_font2", fontScale = 2f) {
        HistoryDetailScreen(CatFx.work, object : HistoryDetailActions {}, customCategories = CatFx.customs)
    }

    @Test @Config(qualifiers = PHONE)
    fun settingsEmpty() = rule.snapshot("categories_settings_empty") { CategoriesScreen(emptyList(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun settingsWithCustoms() = rule.snapshot("categories_settings") { CategoriesScreen(CatFx.customs, noop) }

    @Test @Config(qualifiers = PHONE)
    fun settingsWithCustomsDark() = rule.snapshot("categories_settings", dark = true) { CategoriesScreen(CatFx.customs, noop) }

    @Test @Config(qualifiers = PHONE)
    fun settingsDuplicateError() = rule.snapshot("categories_settings_duplicate") {
        CategoriesScreen(CatFx.customs, noop, initialName = Loc.t("work", "praca"))
    }

    @Test @Config(qualifiers = PHONE)
    fun settingsTooLongError() = rule.snapshot("categories_settings_too_long") {
        CategoriesScreen(CatFx.customs, noop, initialName = "x".repeat(25))
    }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun settingsTablet() = rule.snapshot("categories_settings_tablet") { CategoriesScreen(CatFx.customs, noop) }

    @Test @Config(qualifiers = PHONE)
    fun settingsFontScale2() = rule.snapshot("categories_settings_font2", fontScale = 2f) { CategoriesScreen(CatFx.customs, noop) }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class CategoriesSnapshotPlTest : CategoriesSnapshotTest()
