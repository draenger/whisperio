package ai.whisperio.android.ui.common

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.PersistableBundle

/** `ClipDescription.EXTRA_IS_SENSITIVE` (API 33) as a literal so it can be set from minSdk 26. */
private const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"

/** Copies plain text; flags the clip sensitive only when the user turned that setting on (CONTRACT 6). */
fun copyPlainText(context: Context, text: String, sensitive: Boolean) {
    val clip = ClipData.newPlainText("Whisperio", text)
    if (sensitive) {
        clip.description.extras = PersistableBundle().apply { putBoolean(EXTRA_IS_SENSITIVE, true) }
    }
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
}
