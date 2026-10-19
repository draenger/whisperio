package ai.whisperio.android.screenshot

import ai.whisperio.android.history.Recording
import ai.whisperio.android.screenshot.ScreenshotConfig.PHONE
import ai.whisperio.android.ui.history.HistoryFilters
import ai.whisperio.android.ui.history.HistoryListScreen
import ai.whisperio.android.ui.history.SwipeDeleteBackdrop
import ai.whisperio.android.ui.home.RecordingRow
import ai.whisperio.android.ui.theme.WhisperioTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isPopup
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureRoboImage
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * CONTRACT-1.2 F5/F6 snapshots: the swipe backdrop (a row part-way through a swipe), the "Delete this day" overflow
 * menu and its confirm dialog (plain and filter-aware). Popups and dialogs live in their own window, so those are
 * captured from their own node. Baselines are recorded by the gate, not here.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class GestureSnapshotTest {
    @get:Rule val rule = createComposeRule()

    private val day: LocalDate = LocalDate.of(2026, 10, 17)

    @Composable
    private fun Fixture(
        items: List<Recording> = Fx.all + Fx.notInserted,
        filters: HistoryFilters = HistoryFilters(),
        menuDay: LocalDate? = null,
        deleteDay: LocalDate? = null,
    ) = HistoryListScreen(
        items, onOpen = {}, now = Fx.NOW, zone = ZoneOffset.UTC, initial = filters,
        initialMenuDay = menuDay, initialDeleteDay = deleteDay,
    )

    @OptIn(ExperimentalRoborazziApi::class)
    private fun shoot(
        name: String,
        dark: Boolean = false,
        fontScale: Float = 1f,
        target: () -> SemanticsNodeInteraction,
        content: @Composable () -> Unit,
    ) {
        val file = name + (if (dark) "_dark" else "") + (if (Loc.pl) "_pl" else "")
        rule.setContent {
            WhisperioTheme(darkTheme = dark) {
                val base = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
        rule.waitForIdle()
        target().captureRoboImage("$SNAPSHOT_DIR/$file.png")
    }

    private fun root() = rule.onRoot()
    private fun node(m: SemanticsMatcher) = rule.onNode(m)

    @Composable
    private fun SwipeFixture() {
        Box(Modifier.fillMaxWidth().height(72.dp)) {
            SwipeDeleteBackdrop()
            RecordingRow(Fx.done, onClick = {}, modifier = Modifier.offset(x = (-96).dp))
        }
    }

    @Test @Config(qualifiers = PHONE)
    fun swipeBackdrop() = shoot("history_swipe", target = { root() }) { SwipeFixture() }

    @Test @Config(qualifiers = PHONE)
    fun swipeBackdropDark() = shoot("history_swipe", dark = true, target = { root() }) { SwipeFixture() }

    @Test @Config(qualifiers = PHONE)
    fun dayMenu() = shoot("history_day_menu", target = { node(isPopup()) }) { Fixture(menuDay = day) }

    @Test @Config(qualifiers = PHONE)
    fun dayDeleteDialog() = shoot("history_day_delete", target = { node(isDialog()) }) { Fixture(deleteDay = day) }

    @Test @Config(qualifiers = PHONE)
    fun dayDeleteDialogFiltered() = shoot("history_day_delete_filtered", target = { node(isDialog()) }) {
        Fixture(filters = HistoryFilters(query = Loc.t("invoice", "fakturę")), deleteDay = day)
    }

    @Test @Config(qualifiers = PHONE)
    fun dayDeleteDialogDark() = shoot("history_day_delete", dark = true, target = { node(isDialog()) }) { Fixture(deleteDay = day) }

    @Test @Config(qualifiers = PHONE)
    fun dayDeleteDialogFontScale2() =
        shoot("history_day_delete_font2", fontScale = 2f, target = { node(isDialog()) }) { Fixture(deleteDay = day) }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun dayDeleteDialogTablet() = shoot("history_day_delete_tablet", target = { node(isDialog()) }) { Fixture(deleteDay = day) }

    /** A past date (Fx.notInserted, NOW - 2 days) so the dated wording (%2$s) is covered, not only "today". */
    @Test
    fun dayDeleteDialogPastDate() = shoot("history_day_delete_date", target = { node(isDialog()) }) { Fixture(deleteDay = day.minusDays(2)) }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class GestureSnapshotPlTest : GestureSnapshotTest()
