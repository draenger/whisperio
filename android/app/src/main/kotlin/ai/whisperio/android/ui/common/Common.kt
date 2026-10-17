package ai.whisperio.android.ui.common

import ai.whisperio.android.R
import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.core.ProviderId
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/** Wall-clock formatting, kept in one place so the fixed-clock snapshots stay deterministic. */
fun formatDateTime(epochMs: Long, locale: Locale = Locale.getDefault()): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale).format(Date(epochMs))

fun formatElapsed(ms: Long): String {
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(Locale.ROOT, h, m, s) else "%d:%02d".format(Locale.ROOT, m, s)
}

/** Brand names are not translated; only the self-hosted entry is localised. */
fun ProviderId.label(context: Context): String = when (this) {
    ProviderId.OPENAI -> "OpenAI"
    ProviderId.GROQ -> "Groq"
    ProviderId.MISTRAL -> "Mistral"
    ProviderId.ELEVENLABS -> "ElevenLabs"
    ProviderId.DEEPGRAM -> "Deepgram"
    ProviderId.ASSEMBLYAI -> "AssemblyAI"
    ProviderId.SELFHOSTED -> context.getString(R.string.provider_selfhosted)
}

@Composable
fun providerLabel(id: ProviderId): String = id.label(LocalContext.current)

@Composable
fun errorText(error: DictationError, detail: String?): String = when (error) {
    DictationError.PERMISSION_MISSING -> stringResource(R.string.error_permission)
    DictationError.CONSENT_MISSING -> stringResource(R.string.error_consent)
    DictationError.NO_KEY -> stringResource(R.string.error_no_key)
    DictationError.SILENT_MIC -> stringResource(R.string.error_silent_mic)
    DictationError.NO_SPEECH -> stringResource(R.string.error_no_speech)
    DictationError.TOO_LARGE -> stringResource(R.string.error_too_large)
    DictationError.RECORDER_FAILED -> stringResource(R.string.error_recorder)
    DictationError.NO_AUDIO -> stringResource(R.string.error_no_audio)
    DictationError.PROVIDER -> detail?.takeIf { it.isNotBlank() } ?: stringResource(R.string.error_provider)
}

/** Spoken status for TalkBack live regions; shared by the IME panel, the Dictate sheet and Home. */
@Composable
fun dictationStatusText(state: DictationState): String = when (state) {
    DictationState.Idle -> stringResource(R.string.status_idle)
    is DictationState.Recording ->
        if (state.nearLimit) stringResource(R.string.status_recording_near_limit, formatElapsed(state.elapsedMs))
        else stringResource(R.string.status_recording, formatElapsed(state.elapsedMs))
    is DictationState.Transcribing -> stringResource(R.string.status_transcribing)
    is DictationState.Done -> stringResource(R.string.status_done)
    is DictationState.Error -> errorText(state.error, state.detail)
}

/** Polite live region so TalkBack announces recording / transcribing / error changes (CONTRACT 5). */
fun Modifier.liveStatus(): Modifier = semantics { liveRegion = LiveRegionMode.Polite }

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier.padding(top = 16.dp, bottom = 4.dp).semantics { heading() },
    )
}

/** Row with a 48 dp minimum height and one clickable surface. */
@Composable
fun ClickRow(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(onClick = onClick, role = Role.Button),
    ) { content() }
}

/** Horizontal level meter: a row of bars driven by the 0..1 [level]. */
@Composable
fun LevelMeter(level: Float, modifier: Modifier = Modifier) {
    val active = MaterialTheme.colorScheme.primary
    val idle = MaterialTheme.colorScheme.surfaceVariant
    Canvas(modifier = modifier.height(24.dp).fillMaxWidth()) {
        val bars = 24
        val gap = 4.dp.toPx()
        val barW = (size.width - gap * (bars - 1)) / bars
        val lit = (level.coerceIn(0f, 1f) * bars).toInt()
        for (i in 0 until bars) {
            val h = size.height * (0.35f + 0.65f * ((i % 6) + 1) / 6f)
            drawLine(
                color = if (i < lit) active else idle,
                start = Offset(i * (barW + gap) + barW / 2, (size.height - h) / 2),
                end = Offset(i * (barW + gap) + barW / 2, (size.height + h) / 2),
                strokeWidth = barW,
            )
        }
    }
}

@Composable
fun KeyValueRow(label: String, value: String, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
