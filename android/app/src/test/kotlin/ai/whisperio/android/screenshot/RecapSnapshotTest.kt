package ai.whisperio.android.screenshot

import ai.whisperio.android.ui.recap.RecapCard
import ai.whisperio.android.ui.recap.RecapScreen
import ai.whisperio.core.Recap
import ai.whisperio.core.RecapItem
import ai.whisperio.core.RecapStats
import androidx.compose.ui.test.junit4.createComposeRule
import java.time.ZoneOffset
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

private const val PHONE = ScreenshotConfig.PHONE
private const val DAY = 86_400_000L

/** Fixed week: Fx.NOW is Saturday 2026-10-17, so the week is Mon 10-12 .. Sun 10-18 (UTC). Baselines are recorded in the batch gate. */
private object RecapFx {
    private fun item(id: String, daysAgo: Int, words: Int, ms: Long, provider: String, category: String?) = RecapItem(
        id = id, createdAt = Fx.NOW - daysAgo * DAY, durationMs = ms,
        transcript = List(words) { "word" }.joinToString(" "), done = true, provider = provider, category = category,
    )

    val items = listOf(
        item("a", 0, 180, 70_000, "openai", "work"),
        item("b", 1, 95, 40_000, "openai", null),
        item("c", 2, 320, 130_000, "groq", "ideas"),
        item("d", 4, 60, 25_000, "groq", "work"),
        item("e", 5, 15, 9_000, "openai", null),
    )
    val stats: RecapStats get() = Recap.compute(items, Fx.NOW, ZoneOffset.UTC)
    val empty: RecapStats get() = Recap.compute(emptyList(), Fx.NOW, ZoneOffset.UTC)
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class RecapSnapshotTest {
    @get:Rule val rule = createComposeRule()

    private val label: (String) -> String = { Loc.t(it.replaceFirstChar(Char::titlecase), it.replaceFirstChar(Char::titlecase)) }

    @Test @Config(qualifiers = PHONE)
    fun screen() = rule.snapshot("recap_screen") { RecapScreen(RecapFx.stats, {}, {}, categoryLabel = label) }

    @Test @Config(qualifiers = PHONE)
    fun screenDark() = rule.snapshot("recap_screen", dark = true) { RecapScreen(RecapFx.stats, {}, {}, categoryLabel = label) }

    @Test @Config(qualifiers = PHONE)
    fun screenEmpty() = rule.snapshot("recap_screen_empty") { RecapScreen(RecapFx.empty, {}, {}) }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun screenTablet() = rule.snapshot("recap_screen_tablet") { RecapScreen(RecapFx.stats, {}, {}, categoryLabel = label) }

    @Test @Config(qualifiers = PHONE)
    fun screenFontScale2() = rule.snapshot("recap_screen_font2", fontScale = 2f) {
        RecapScreen(RecapFx.stats, {}, {}, categoryLabel = label)
    }

    @Test @Config(qualifiers = PHONE)
    fun card() = rule.snapshot("recap_card") { RecapCard(RecapFx.stats, onClick = {}) }

    @Test @Config(qualifiers = PHONE)
    fun cardDark() = rule.snapshot("recap_card", dark = true) { RecapCard(RecapFx.stats, onClick = {}) }

    @Test @Config(qualifiers = PHONE)
    fun cardFontScale2() = rule.snapshot("recap_card_font2", fontScale = 2f) { RecapCard(RecapFx.stats, onClick = {}) }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class RecapSnapshotPlTest : RecapSnapshotTest()
