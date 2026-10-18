package ai.whisperio.android.ime

import ai.whisperio.android.R
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.ui.common.LevelMeter
import ai.whisperio.android.ui.common.dictationStatusText
import ai.whisperio.android.ui.common.liveStatus
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.automirrored.filled.KeyboardReturn
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.SpaceBar
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Everything the panel renders; built by the service, or by fixtures in snapshot tests. */
data class ImePanelState(
    val dictation: DictationState,
    val passwordField: Boolean,
    val setupNeeded: Boolean,
    /** e.g. "OpenAI - whisper-1"; shown so the user always sees where audio goes. */
    val providerLabel: String,
    /** True when a finished dictation was not typed (field changed meanwhile). */
    val notInserted: Boolean = false,
)

class ImePanelActions(
    val onMic: () -> Unit,
    val onBackspace: () -> Unit,
    val onSpace: () -> Unit,
    val onEnter: () -> Unit,
    val onSwitchKeyboard: () -> Unit,
    val onOpenSetup: () -> Unit,
    val onProviderChip: () -> Unit,
)

@Composable
fun ImePanel(state: ImePanelState, actions: ImePanelActions, modifier: Modifier = Modifier) {
    val d = state.dictation
    val recording = d is DictationState.Recording
    val transcribing = d is DictationState.Transcribing
    Box(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .windowInsetsPadding(WindowInsets.navigationBars),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                AssistChip(
                    onClick = actions.onProviderChip,
                    label = { Text(state.providerLabel, maxLines = 1) },
                    modifier = Modifier.heightIn(min = 48.dp).weight(1f, fill = false),
                )
                Box(Modifier.weight(1f))
                IconButton(onClick = actions.onSwitchKeyboard, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Filled.Keyboard, contentDescription = stringResource(R.string.ime_switch_keyboard))
                }
            }

            if (state.setupNeeded) {
                Button(onClick = actions.onOpenSetup, modifier = Modifier.heightIn(min = 56.dp)) {
                    Text(stringResource(R.string.ime_open_setup), textAlign = TextAlign.Center)
                }
            } else {
                val micDesc = when {
                    state.passwordField -> stringResource(R.string.ime_mic_disabled)
                    recording -> stringResource(R.string.ime_mic_stop)
                    transcribing -> stringResource(R.string.ime_mic_busy)
                    else -> stringResource(R.string.ime_mic_start)
                }
                Box(contentAlignment = Alignment.Center, modifier = Modifier.size(88.dp)) {
                    if (transcribing) CircularProgressIndicator(Modifier.size(88.dp), strokeWidth = 3.dp)
                    FilledIconButton(
                        onClick = actions.onMic,
                        enabled = !state.passwordField && !transcribing,
                        modifier = Modifier.size(72.dp).semantics { contentDescription = micDesc },
                        shape = CircleShape,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                            contentColor = if (recording) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary,
                        ),
                    ) {
                        Icon(
                            when {
                                state.passwordField -> Icons.Filled.MicOff
                                recording -> Icons.Filled.Stop
                                else -> Icons.Filled.Mic
                            },
                            contentDescription = null,
                            modifier = Modifier.size(36.dp),
                        )
                    }
                }
                if (d is DictationState.Recording) LevelMeter(d.level, Modifier.widthIn(max = 320.dp))
                val status = when {
                    state.passwordField -> stringResource(R.string.ime_password_off)
                    d is DictationState.Done && state.notInserted -> stringResource(R.string.ime_not_inserted)
                    else -> dictationStatusText(d)
                }
                Text(
                    status,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = if (d is DictationState.Error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.liveStatus().heightIn(min = 24.dp),
                )
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                FilledTonalIconButton(onClick = actions.onBackspace, modifier = Modifier.size(width = 64.dp, height = 48.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Backspace, contentDescription = stringResource(R.string.ime_backspace))
                }
                FilledTonalIconButton(onClick = actions.onSpace, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.SpaceBar, contentDescription = stringResource(R.string.ime_space))
                }
                FilledTonalIconButton(onClick = actions.onEnter, modifier = Modifier.size(width = 64.dp, height = 48.dp)) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardReturn, contentDescription = stringResource(R.string.ime_enter))
                }
            }
        }
    }
}
