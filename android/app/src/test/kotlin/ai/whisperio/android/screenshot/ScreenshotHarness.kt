package ai.whisperio.android.screenshot

import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.ui.theme.WhisperioTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage

/**
 * Shared harness for the screenshot gate (Zryw pattern). Every test renders a stateless screen composable at a fixed
 * window size inside [WhisperioTheme] and compares it with the committed baseline in `src/test/snapshots/<name>.png`
 * (record: `recordRoborazziDebug`, verify: `verifyRoborazziDebug`). Pure JVM: Robolectric native graphics.
 * Every snapshot class runs once as [EN] (`<name>.png`) and once as [PL] (`<name>_pl.png`).
 */
object ScreenshotConfig {
    /** Pixel 7: 411x914 dp, en/pl is selected at class level. */
    const val PHONE = "+w411dp-h914dp-normal-long-notround-port-notnight-420dpi"

    /** 10" tablet landscape: 1280x800 dp. */
    const val TABLET = "+w1280dp-h800dp-xlarge-long-notround-land-notnight-240dpi"

    const val EN = "en-rUS"
    const val PL = "pl-rPL"
}

object Loc {
    val pl: Boolean get() = java.util.Locale.getDefault().language == "pl"
    fun t(en: String, pl: String): String = if (this.pl) pl else en
}

internal const val SNAPSHOT_DIR = "src/test/snapshots"

/** Fixed clock and fixtures: nothing in a baseline may depend on the wall clock. */
object Fx {
    /** 2026-10-17 09:41 UTC */
    const val NOW = 1_792_230_060_000L

    val done get() = Recording(
        id = "r1", createdAt = NOW - 5 * 60_000, durationMs = 12_000, status = RecordingStatus.DONE,
        provider = "openai", model = "whisper-1", language = "auto",
        transcript = Loc.t(
            "Remind me to send the invoice to Anna before Friday.",
            "Przypomnij mi, żeby wysłać fakturę do Anny przed piątkiem.",
        ),
        audioPath = "/data/r1.m4a", source = RecordingSource.KEYBOARD, inserted = true,
    )
    val doneTile get() = done.copy(
        id = "r2", createdAt = NOW - 3 * 3_600_000, source = RecordingSource.TILE, inserted = null,
        transcript = Loc.t("Buy oat milk and coffee.", "Kup mleko owsiane i kawę."),
    )
    val failed get() = done.copy(
        id = "r3", createdAt = NOW - 26 * 3_600_000, status = RecordingStatus.FAILED, transcript = null,
        error = "HTTP 401: Incorrect API key provided.", source = RecordingSource.APP, inserted = null,
    )
    val notInserted get() = done.copy(id = "r4", createdAt = NOW - 2 * 86_400_000, inserted = false)
    val all get() = listOf(done, doneTile, failed)
}

/** Renders [content] on the app background and records / verifies `<name>[_dark][_pl].png`. */
@OptIn(com.github.takahirom.roborazzi.ExperimentalRoborazziApi::class)
internal fun ComposeContentTestRule.snapshot(
    name: String,
    dark: Boolean = false,
    fontScale: Float = 1f,
    content: @Composable () -> Unit,
) {
    val file = name + (if (dark) "_dark" else "") + (if (Loc.pl) "_pl" else "")
    setContent {
        WhisperioTheme(darkTheme = dark) {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                    contentColor = MaterialTheme.colorScheme.onBackground,
                ) { content() }
            }
        }
    }
    waitForIdle()
    onRoot().captureRoboImage("$SNAPSHOT_DIR/$file.png")
}
