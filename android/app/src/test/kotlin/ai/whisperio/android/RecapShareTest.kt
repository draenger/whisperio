package ai.whisperio.android

import ai.whisperio.android.ui.recap.RecapShare
import ai.whisperio.android.ui.recap.RecapText
import ai.whisperio.android.ui.recap.recapCardContent
import ai.whisperio.core.Recap
import ai.whisperio.core.RecapItem
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import java.io.File
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

    /** 380 words spoken in 5 minutes: 10 minutes of typing -> 5 minutes saved. */
    private val longWeek get() = Recap.compute(
        listOf(RecapItem("l", now - 1000, 300_000, List(380) { "word" }.joinToString(" "), true, "openai")),
        now, ZoneOffset.UTC,
    )

    @Test fun shareTextHasWordsNotesMinutesAndStreak() {
        val text = RecapText(ctx.resources, Locale.US).shareText(longWeek)
        assertTrue(text, text.contains("380 words"))
        assertTrue(text, text.contains("1 note"))
        assertTrue(text, text.contains("about 5 minutes saved"))
        assertTrue(text, text.contains("1 day"))
    }

    @Test fun shortWeekNeverSaysZeroMinutes() {
        // 13 words in 90 s: slower than typing -> 0 minutes saved.
        assertEquals(0, stats.minutesSaved)
        val t = RecapText(ctx.resources, Locale.US)
        val text = t.shareText(stats)
        assertTrue(text, text.contains("13 words"))
        assertTrue(text, text.contains("2 notes"))
        assertTrue(text, text.contains("2 days"))
        assertFalse(text, text.contains("minute"))
        assertFalse(text.contains("secret"))
        assertEquals("13", t.heroValue(stats))
        assertEquals("words dictated this week", t.heroCaption(stats))
        val card = recapCardContent(stats, t, ctx).allText.joinToString("\n")
        assertFalse(card, card.contains("saved")) // "Words per minute" tile stays; no minutes-saved hero
    }

    @Test fun heroShowsMinutesSavedFromOneMinuteUp() {
        val t = RecapText(ctx.resources, Locale.US)
        assertEquals("5", t.heroValue(longWeek))
        assertEquals("minutes saved vs typing", t.heroCaption(longWeek))
    }

    @Test fun chooserCarriesTheStreamClipDataAndReadGrant() {
        // FileProvider checks "root + '/'", so on a Windows host ('\' paths) only the real provider fails; there the
        // URI is built by hand and the provider/paths wiring is checked on '/' hosts (and on device) instead.
        val realProvider = File.separatorChar == '/'
        val chooser = runBlocking {
            if (realProvider) {
                RecapShare.buildChooser(ctx, stats)
            } else {
                RecapShare.buildChooser(ctx, stats) { app, file ->
                    Uri.Builder().scheme("content").authority(RecapShare.authority(app)).path("share/${file.name}").build()
                }
            }
        }
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
        if (realProvider) {
            val uri = FileProvider.getUriForFile(ctx, RecapShare.authority(ctx), file)
            assertEquals(RecapShare.authority(ctx), uri.authority)
        }
    }
}
