package ai.whisperio.android

import ai.whisperio.android.dictate.DictateActivity
import ai.whisperio.android.history.RecordingSource
import org.junit.Assert.assertEquals
import org.junit.Test

class DictateActivitySourceTest {
    @Test fun tileExtraMapsToTile() =
        assertEquals(RecordingSource.TILE, DictateActivity.sourceFor("tile"))

    @Test fun shortcutExtraMapsToShortcut() =
        assertEquals(RecordingSource.SHORTCUT, DictateActivity.sourceFor("shortcut"))

    @Test fun widgetExtraMapsToWidget() {
        assertEquals(RecordingSource.WIDGET, DictateActivity.sourceFor("widget"))
        assertEquals(RecordingSource.WIDGET, DictateActivity.sourceFor(ai.whisperio.android.widget.WidgetLaunch.SOURCE))
        assertEquals(RecordingSource.TILE, DictateActivity.sourceFor("WIDGET"))
    }

    @Test fun missingOrUnknownExtraFallsBackToTile() {
        assertEquals(RecordingSource.TILE, DictateActivity.sourceFor(null))
        assertEquals(RecordingSource.TILE, DictateActivity.sourceFor(""))
        assertEquals(RecordingSource.TILE, DictateActivity.sourceFor("keyboard"))
        assertEquals(RecordingSource.TILE, DictateActivity.sourceFor("SHORTCUT"))
    }
}
