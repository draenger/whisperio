package ai.whisperio.android

import ai.whisperio.android.ui.common.copyPlainText
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ClipboardTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val cm get() = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private fun sensitiveFlag(): Boolean? =
        cm.primaryClip!!.description.extras?.takeIf { it.containsKey(ClipDescription.EXTRA_IS_SENSITIVE) }
            ?.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE)

    @Test fun copiesPlainTextTranscript() {
        copyPlainText(ctx, "hello transcript", sensitive = false)
        val clip = cm.primaryClip!!
        assertEquals(1, clip.itemCount)
        assertEquals("hello transcript", clip.getItemAt(0).text.toString())
        assertTrue(clip.description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN))
    }

    @Test fun notFlaggedSensitiveWhenSettingOff() {
        copyPlainText(ctx, "not secret", sensitive = false)
        assertEquals(null, sensitiveFlag())
    }

    @Test fun flaggedSensitiveWhenSettingOn() {
        copyPlainText(ctx, "secret", sensitive = true)
        assertEquals("secret", cm.primaryClip!!.getItemAt(0).text.toString())
        assertEquals(true, sensitiveFlag())
    }

    @Test fun laterCopyReplacesEarlierAndDropsSensitiveFlag() {
        copyPlainText(ctx, "first", sensitive = true)
        copyPlainText(ctx, "second", sensitive = false)
        assertEquals("second", cm.primaryClip!!.getItemAt(0).text.toString())
        assertFalse(sensitiveFlag() == true)
    }
}
