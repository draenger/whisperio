package ai.whisperio.android.ui.theme

import ai.whisperio.android.R
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Brand tokens from desktop/docs/design/tokens.css (teal lead, sky support; violet is retired).
 * Dark uses the bright teal #1CC8B4 (same as the launcher ghost). Light uses a teal deepened one step from
 * the desktop's #0F8478 so primary-coloured text (TextButton, links) clears 4.5:1 on the paper surfaces.
 */
object Brand {
    val Teal = Color(0xFF1CC8B4)
    val TealInk = Color(0xFF02110F)
    val TealDeep = Color(0xFF0B7469)
    val Sky = Color(0xFF3DA2F7)
}

private val LightColors = lightColorScheme(
    primary = Brand.TealDeep,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFC6F3EC),
    onPrimaryContainer = Color(0xFF04332E),
    secondary = Color(0xFF1668AD),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFD6E8FA),
    onSecondaryContainer = Color(0xFF0A2A4A),
    tertiary = Color(0xFF4A5D70),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE1E8EF),
    onTertiaryContainer = Color(0xFF0C1822),
    background = Color(0xFFF6F8FA),
    onBackground = Color(0xFF0C1822),
    surface = Color(0xFFF6F8FA),
    onSurface = Color(0xFF0C1822),
    surfaceVariant = Color(0xFFE3E9EF),
    onSurfaceVariant = Color(0xFF3F4F5E),
    surfaceTint = Brand.TealDeep,
    inverseSurface = Color(0xFF16243A),
    inverseOnSurface = Color(0xFFECF2F9),
    inversePrimary = Brand.Teal,
    error = Color(0xFFC81E1E),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFDE0DE),
    onErrorContainer = Color(0xFF5C0A0A),
    outline = Color(0xFF6B7D91),
    outlineVariant = Color(0xFFD2DBE4),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFF6F8FA),
    surfaceDim = Color(0xFFD9E0E7),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF1F4F7),
    surfaceContainer = Color(0xFFEEF2F6),
    surfaceContainerHigh = Color(0xFFE6EBF0),
    surfaceContainerHighest = Color(0xFFDDE4EB),
)

private val DarkColors = darkColorScheme(
    primary = Brand.Teal,
    onPrimary = Brand.TealInk,
    primaryContainer = Color(0xFF0B4F47),
    onPrimaryContainer = Color(0xFFA9F2E8),
    secondary = Color(0xFF7CC0FB),
    onSecondary = Color(0xFF04223F),
    secondaryContainer = Color(0xFF12406B),
    onSecondaryContainer = Color(0xFFD2E7FD),
    tertiary = Color(0xFFB4C1D0),
    onTertiary = Color(0xFF16243A),
    tertiaryContainer = Color(0xFF2C3A4E),
    onTertiaryContainer = Color(0xFFDCE5EE),
    background = Color(0xFF070D15),
    onBackground = Color(0xFFECF2F9),
    surface = Color(0xFF070D15),
    onSurface = Color(0xFFECF2F9),
    surfaceVariant = Color(0xFF16243A),
    onSurfaceVariant = Color(0xFFB4C1D0),
    surfaceTint = Brand.Teal,
    inverseSurface = Color(0xFFECF2F9),
    inverseOnSurface = Color(0xFF0C1822),
    inversePrimary = Brand.TealDeep,
    error = Color(0xFFF87171),
    onError = Color(0xFF2A0505),
    errorContainer = Color(0xFF7A1818),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF7E91A4),
    outlineVariant = Color(0xFF2C3A4E),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF243752),
    surfaceDim = Color(0xFF070D15),
    surfaceContainerLowest = Color(0xFF05090F),
    surfaceContainerLow = Color(0xFF0C1826),
    surfaceContainer = Color(0xFF101B2A),
    surfaceContainerHigh = Color(0xFF16243A),
    surfaceContainerHighest = Color(0xFF1D2D45),
)

private val Plex = FontFamily(
    Font(R.font.ibm_plex_sans_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_sans_medium, FontWeight.Medium),
    Font(R.font.ibm_plex_sans_semibold, FontWeight.SemiBold),
)

private val Grotesk = FontFamily(
    Font(R.font.space_grotesk_regular, FontWeight.Normal),
    Font(R.font.space_grotesk_medium, FontWeight.Medium),
    Font(R.font.space_grotesk_semibold, FontWeight.SemiBold),
)

/** M3 type scale unchanged; only the family: Space Grotesk for display/headline/titleLarge, IBM Plex Sans elsewhere (desktop --wsp-font-*). */
private val AppTypography: Typography = Typography().let { t ->
    t.copy(
        displayLarge = t.displayLarge.copy(fontFamily = Grotesk),
        displayMedium = t.displayMedium.copy(fontFamily = Grotesk),
        displaySmall = t.displaySmall.copy(fontFamily = Grotesk),
        headlineLarge = t.headlineLarge.copy(fontFamily = Grotesk, fontWeight = FontWeight.SemiBold),
        headlineMedium = t.headlineMedium.copy(fontFamily = Grotesk, fontWeight = FontWeight.SemiBold),
        headlineSmall = t.headlineSmall.copy(fontFamily = Grotesk, fontWeight = FontWeight.SemiBold),
        titleLarge = t.titleLarge.copy(fontFamily = Grotesk, fontWeight = FontWeight.SemiBold),
        titleMedium = t.titleMedium.copy(fontFamily = Plex),
        titleSmall = t.titleSmall.copy(fontFamily = Plex),
        bodyLarge = t.bodyLarge.copy(fontFamily = Plex),
        bodyMedium = t.bodyMedium.copy(fontFamily = Plex),
        bodySmall = t.bodySmall.copy(fontFamily = Plex),
        labelLarge = t.labelLarge.copy(fontFamily = Plex),
        labelMedium = t.labelMedium.copy(fontFamily = Plex),
        labelSmall = t.labelSmall.copy(fontFamily = Plex),
    )
}

private val AppShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
)

/** Brand teal on every device: dynamic color (Material You) stays OFF, as before, so the app matches desktop/iOS and the launcher icon. */
@Composable
fun WhisperioTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        shapes = AppShapes,
        typography = AppTypography,
        content = content,
    )
}
