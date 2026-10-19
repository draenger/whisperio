package ai.whisperio.android

import ai.whisperio.android.ui.recap.RecapShare
import ai.whisperio.android.ui.recap.RecapText
import ai.whisperio.android.ui.recap.recapCardContent
import ai.whisperio.core.Recap
import ai.whisperio.core.RecapItem
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import java.time.ZoneOffset
import java.util.Locale
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS")
class RecapShareTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()
    private val now = 1_792_230_060_000L // 2026-10-17 09:41 UTC
    private val secret = "my private secret transcript about the merger"

    private val stats get() = Recap.compute(
        listOf(
            RecapItem("a", now - 1000, 60_000, "$secret and more words here", true, "openai"),
            RecapItem("b", now - 86_400_000L, 30_000, "second note", true, "groq"),
        ),
        now, ZoneOffset.UTC,
    )

    @Test fun cardIs1080x1350() {
        val bmp = RecapShare.renderCard(recapCardContent(stats, RecapText(ctx.resources, Locale.US), ctx))
        assertEquals(1080, bmp.width)
        assertEquals(1350, bmp.height)
        // Not a blank canvas: the corner is the background, the middle (hero number) has other pixels.
        val corner = bmp.getPixel(2, 2)
        var different = false
        for (x in 300 until 780 step 7) for (y in 300 until 520 step 7) if (bmp.getPixel(x, y) != corner) different = true
        assertTrue(different)
    }

    @Test fun cardTextHasNumbersAndLabelsOnlyNeverTranscriptText() {
        val content = recapCardContent(stats, RecapText(ctx.resources, Locale.US), ctx)
        val all = content.allText.joinToString("\n")
        assertFalse(all.contains("secret"))
        assertFalse(all.contains("merger"))
        assertFalse(all.contains("second note"))
        // Words (11 + 2 = 13 across two notes), notes and the streak are there as numbers.
        assertTrue(all.contains("13"))
        assertEquals(4, content.tiles.size)
        assertEquals("2", content.tiles[1].value)
    }

    @Test fun shareTextHasWordsNotesMinutesAndStreak() {
        val text = RecapText(ctx.resources, Locale.US).shareText(stats)
        assertTrue(text, text.contains("13 words"))
        assertTrue(text, text.contains("2 notes"))
        assertTrue(text, text.contains("2 days"))
        assertFalse(text.contains("secret"))
    }

    @Test fun chooserCarriesTheStreamClipDataAndReadGrant() {
        val chooser = runBlocking { RecapShare.buildChooser(ctx, stats) }
        val send = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        assertNotNull(send)
        assertEquals(Intent.ACTION_SEND, send!!.action)
        assertEquals("image/png", send.type)
        assertNotNull(send.clipData)
        assertTrue(send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(chooser.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        val file = RecapShare.cardFile(ctx.cacheDir)
        assertTrue(file.exists())
        assertTrue(file.length() > 0)
        assertEquals("${ctx.packageName}.share", RecapShare.authority(ctx))
        val uri = FileProvider.getUriForFile(ctx, RecapShare.authority(ctx), file)
        assertEquals(RecapShare.authority(ctx), uri.authority)
    }
}
