package ai.whisperio.android.screenshot

import ai.whisperio.android.R
import android.view.LayoutInflater
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** CONTRACT-1.1 F8: the 1x1 and 2x1 widget layouts, inflated as plain Views (RemoteViews use the same XML). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class WidgetSnapshotTest {
    private fun capture(name: String, layout: Int, widthDp: Int, heightDp: Int) {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val density = ctx.resources.displayMetrics.density
        val view = LayoutInflater.from(ctx).inflate(layout, FrameLayout(ctx), false)
        val w = (widthDp * density).toInt()
        val h = (heightDp * density).toInt()
        view.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
        view.layout(0, 0, w, h)
        view.captureRoboImage("$SNAPSHOT_DIR/$name${if (Loc.pl) "_pl" else ""}.png")
    }

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun widget1x1() = capture("widget_1x1", R.layout.widget_dictate_1x1, 74, 74)

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun widget2x1() = capture("widget_2x1", R.layout.widget_dictate_2x1, 160, 74)
}

@Config(qualifiers = ScreenshotConfig.PL)
class WidgetSnapshotPlTest : WidgetSnapshotTest()
