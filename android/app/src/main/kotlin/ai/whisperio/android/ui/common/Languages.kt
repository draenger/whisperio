package ai.whisperio.android.ui.common

import ai.whisperio.android.R
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

/** Language names are shown in their own language on purpose (as in iOS); only "Auto" is localised. */
object Languages {
    private val names = mapOf(
        "en" to "English", "pl" to "Polski", "de" to "Deutsch", "es" to "Español", "fr" to "Français",
        "it" to "Italiano", "pt" to "Português", "nl" to "Nederlands", "ru" to "Русский",
        "uk" to "Українська",
    )

    /** Onboarding chips (CONTRACT 7.1): nl and ru stay available in Settings only. */
    val onboarding = listOf("pl", "en", "de", "es", "fr", "it", "pt", "uk", "auto")

    /** Settings list (CONTRACT 7.4). */
    val settings = listOf("auto", "en", "pl", "de", "es", "fr", "it", "pt", "nl", "ru", "uk")

    /** Short form for the keyboard chip: `PL`, `EN`, ... and a localised "Auto". */
    @Composable
    fun short(code: String): String =
        if (code == "auto") stringResource(R.string.language_auto_short) else code.uppercase()

    @Composable
    fun label(code: String): String =
        if (code == "auto") stringResource(R.string.language_auto) else names[code] ?: code
}
