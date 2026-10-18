package ai.whisperio.android

import ai.whisperio.android.dictate.DictateActivity
import ai.whisperio.android.dictate.TileLaunch
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.xmlpull.v1.XmlPullParser

/**
 * Tile launch plan and launcher shortcut wiring. TileService.onClick itself needs a system binder (not available
 * on the JVM), so the API-branch decision and the intent/PendingIntent it uses are tested as TileLaunch; the
 * locked -> unlockAndRun branch is a one-line `if (isLocked)` in onClick and is covered by the on-device check.
 */
@RunWith(RobolectricTestRunner::class)
class TileShortcutTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    @Test fun api34AndUpUsePendingIntentOverload() {
        assertTrue(TileLaunch.usesPendingIntent(34))
        assertTrue(TileLaunch.usesPendingIntent(35))
    }

    @Test fun api33AndBelowUseIntentOverload() {
        assertFalse(TileLaunch.usesPendingIntent(33))
        assertFalse(TileLaunch.usesPendingIntent(31))
    }

    @Test fun tileIntentTargetsDictateActivityWithTileSource() {
        val i = TileLaunch.dictateIntent(ctx)
        assertEquals(DictateActivity::class.java.name, i.component?.className)
        assertEquals("tile", i.getStringExtra(DictateActivity.EXTRA_SOURCE))
        assertTrue(i.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test fun tilePendingIntentIsImmutableActivityIntent() {
        val intent = TileLaunch.dictateIntent(ctx)
        val pending = TileLaunch.pendingFor(ctx, intent)
        val sp = shadowOf(pending)
        assertTrue(sp.isActivityIntent)
        assertTrue(sp.flags and PendingIntent.FLAG_IMMUTABLE != 0)
        assertEquals("tile", sp.savedIntent.getStringExtra(DictateActivity.EXTRA_SOURCE))
        assertEquals(DictateActivity::class.java.name, sp.savedIntent.component?.className)
    }

    private data class Parsed(var action: String? = null, var pkg: String? = null, var cls: String? = null, val extras: MutableMap<String, String> = mutableMapOf())

    private fun parseShortcut(): Parsed {
        val ns = "http://schemas.android.com/apk/res/android"
        val p = ctx.resources.getXml(R.xml.shortcuts)
        val out = Parsed()
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            if (p.eventType != XmlPullParser.START_TAG) continue
            when (p.name) {
                "intent" -> {
                    out.action = p.getAttributeValue(ns, "action")
                    out.pkg = p.getAttributeValue(ns, "targetPackage")
                    out.cls = p.getAttributeValue(ns, "targetClass")
                }
                "extra" -> out.extras[p.getAttributeValue(ns, "name")] = p.getAttributeValue(ns, "value")
            }
        }
        return out
    }

    @Test fun shortcutTargetsDictateActivityWithShortcutSource() {
        val s = parseShortcut()
        assertEquals(DictateActivity::class.java.name, s.cls)
        assertEquals(ctx.packageName, s.pkg)
        assertEquals("shortcut", s.extras[DictateActivity.EXTRA_SOURCE])
        assertNotNull(s.action)
    }

    /**
     * DictateActivity is exported=false, yet a pinned/dynamic shortcut launches it: the launcher starts shortcut
     * intents through ShortcutService/LauncherApps, which fires them with the publisher app's own identity, and a
     * same-app caller may start a non-exported component. So exported=false is correct and keeps other apps out.
     */
    @Test fun dictateActivityIsNotExportedButResolvableFromOwnPackage() {
        val s = parseShortcut()
        val component = ComponentName(s.pkg!!, s.cls!!)
        val info = ctx.packageManager.getActivityInfo(component, 0)
        assertFalse(info.exported)
        val intent = Intent(s.action).setComponent(component)
        assertNotNull(ctx.packageManager.resolveActivity(intent, 0))
    }
}
