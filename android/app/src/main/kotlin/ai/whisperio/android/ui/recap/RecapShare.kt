package ai.whisperio.android.ui.recap

import ai.whisperio.android.R
import ai.whisperio.android.ui.theme.Brand
import ai.whisperio.core.RecapStats
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One stat on the share card: the number, its label and an optional sub-line (best streak). */
data class RecapCardTile(val value: String, val label: String, val sub: String? = null)

/**
 * Everything the share card draws, as plain strings. CONTRACT-1.2 F2 / D5: numbers and labels only, never transcript
 * text; [allText] is what the unit test inspects.
 */
data class RecapCardContent(
    val weekLabel: String,
    val heroValue: String,
    val heroCaption: String,
    val tiles: List<RecapCardTile>,
    val footer: String,
) {
    val allText: List<String>
        get() = listOf(weekLabel, heroValue, heroCaption, footer) + tiles.flatMap { listOfNotNull(it.value, it.label, it.sub) }
}

fun recapCardContent(stats: RecapStats, t: RecapText, context: Context): RecapCardContent = RecapCardContent(
    weekLabel = t.weekLabel(stats),
    heroValue = t.heroValue(stats),
    heroCaption = t.heroCaption(stats),
    tiles = listOf(
        RecapCardTile(t.num(stats.words), context.getString(R.string.recap_tile_words)),
        RecapCardTile(t.num(stats.notes), context.getString(R.string.recap_tile_notes)),
        RecapCardTile(t.wpm(stats), context.getString(R.string.recap_tile_wpm)),
        RecapCardTile(
            t.num(stats.streakCurrent), context.getString(R.string.recap_tile_streak),
            context.getString(R.string.recap_tile_best, t.days(stats.streakBest)),
        ),
    ),
    footer = context.getString(R.string.recap_card_footer),
)

object RecapShare {
    const val WIDTH = 1080
    const val HEIGHT = 1350
    private const val DIR = "share"
    private const val FILE = "recap.png"

    /** `${applicationId}.share`, as declared in the manifest. */
    fun authority(context: Context): String = "${context.packageName}.share"

    /** `cacheDir/share/recap.png`, overwritten on every share and deleted by Erase all data. */
    fun cardFile(cacheDir: File): File = File(File(cacheDir, DIR), FILE)

    /** Deterministic 1080x1350 card drawn with [Canvas] (no Compose capture), so it is unit-testable. */
    fun renderCard(content: RecapCardContent): Bitmap {
        val bmp = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val bg = 0xFF0C1822.toInt()
        val panel = 0xFF16243A.toInt()
        val ink = 0xFFECF2F9.toInt()
        val muted = 0xFF9FB1C4.toInt()
        val accent = Brand.Teal.toArgb()
        c.drawColor(bg)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        fun text(s: String, x: Float, y: Float, size: Float, color: Int, bold: Boolean, maxWidth: Float, center: Boolean = false) {
            paint.color = color
            paint.typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            paint.textSize = size
            while (paint.measureText(s) > maxWidth && paint.textSize > 16f) paint.textSize -= 2f
            paint.textAlign = if (center) Paint.Align.CENTER else Paint.Align.LEFT
            c.drawText(s, x, y, paint)
        }

        val margin = 80f
        val inner = WIDTH - 2 * margin
        text(content.footer, margin, 130f, 52f, accent, true, inner)
        text(content.weekLabel, margin, 200f, 40f, muted, false, inner)

        // Hero: minutes saved, or the week's words below 1 minute.
        text(content.heroValue, WIDTH / 2f, 500f, 260f, ink, true, inner, center = true)
        text(content.heroCaption, WIDTH / 2f, 590f, 46f, accent, false, inner, center = true)

        // 2x2 tiles.
        val gap = 40f
        val tileW = (inner - gap) / 2f
        val tileH = 270f
        val top = 700f
        content.tiles.take(4).forEachIndexed { i, tile ->
            val left = margin + (i % 2) * (tileW + gap)
            val y = top + (i / 2) * (tileH + gap)
            paint.color = panel
            c.drawRoundRect(RectF(left, y, left + tileW, y + tileH), 36f, 36f, paint)
            val pad = 36f
            text(tile.value, left + pad, y + 120f, 100f, ink, true, tileW - 2 * pad)
            text(tile.label, left + pad, y + 180f, 36f, muted, false, tileW - 2 * pad)
            tile.sub?.let { text(it, left + pad, y + 230f, 32f, accent, false, tileW - 2 * pad) }
        }
        return bmp
    }

    /**
     * Draws the card, writes it to `cacheDir/share/recap.png` and builds the chooser (text + PNG through the
     * FileProvider; `ClipData` for the share-sheet preview and a read grant on the URI). Runs the file work on IO.
     */
    suspend fun buildChooser(
        context: Context,
        stats: RecapStats,
        // Seam for JVM tests on Windows hosts, where FileProvider's "root + '/'" prefix check never matches a '\' path.
        uriFor: (Context, File) -> Uri = { app, file -> FileProvider.getUriForFile(app, authority(app), file) },
    ): Intent = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        val text = RecapText(context.resources)
        val file = cardFile(app.cacheDir)
        file.parentFile?.mkdirs()
        val bmp = renderCard(recapCardContent(stats, text, context))
        try {
            file.outputStream().use { out -> check(bmp.compress(Bitmap.CompressFormat.PNG, 100, out)) { "png encode failed" } }
        } finally {
            bmp.recycle()
        }
        val uri = uriFor(app, file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, text.shareText(stats))
            clipData = ClipData.newRawUri(null, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        Intent.createChooser(send, context.getString(R.string.recap_share_chooser)).apply {
            clipData = ClipData.newRawUri(null, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}
