package ai.whisperio.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape

/** Brand violet from desktop/icons/whisperio.svg (9577FE) with its dark ink (311F69). Dynamic color is off. */
object Brand {
    val Violet = Color(0xFF9577FE)
    val VioletInk = Color(0xFF311F69)
    val VioletDeep = Color(0xFF5B3FD6)
}

private val LightColors = lightColorScheme(
    primary = Brand.VioletDeep,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE7DFFF),
    onPrimaryContainer = Brand.VioletInk,
    secondary = Color(0xFF605A7C),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE6DFFF),
    onSecondaryContainer = Color(0xFF1C1735),
    background = Color(0xFFFBFAFF),
    onBackground = Color(0xFF1B1A22),
    surface = Color(0xFFFBFAFF),
    onSurface = Color(0xFF1B1A22),
    surfaceVariant = Color(0xFFE8E4F2),
    onSurfaceVariant = Color(0xFF494657),
    outline = Color(0xFF7A7689),
    error = Color(0xFFB3261E),
    onError = Color.White,
    errorContainer = Color(0xFFF9DEDC),
    onErrorContainer = Color(0xFF410E0B),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFB9A6FF),
    onPrimary = Color(0xFF22115F),
    primaryContainer = Color(0xFF3B2A7A),
    onPrimaryContainer = Color(0xFFE7DFFF),
    secondary = Color(0xFFC9C1E6),
    onSecondary = Color(0xFF312B4B),
    secondaryContainer = Color(0xFF48425F),
    onSecondaryContainer = Color(0xFFE6DFFF),
    background = Color(0xFF14111F),
    onBackground = Color(0xFFE6E1EE),
    surface = Color(0xFF14111F),
    onSurface = Color(0xFFE6E1EE),
    surfaceVariant = Color(0xFF2B2838),
    onSurfaceVariant = Color(0xFFCAC4D8),
    outline = Color(0xFF948FA3),
    error = Color(0xFFF2B8B5),
    onError = Color(0xFF601410),
    errorContainer = Color(0xFF8C1D18),
    onErrorContainer = Color(0xFFF9DEDC),
)

private val AppShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
)

@Composable
fun WhisperioTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        shapes = AppShapes,
        content = content,
    )
}
