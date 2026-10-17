package ai.whisperio.android.dictate

import ai.whisperio.android.R
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.ui.common.LevelMeter
import ai.whisperio.android.ui.common.dictationStatusText
import ai.whisperio.android.ui.common.liveStatus
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Card shown over the translucent window while the tile / shortcut dictation runs. Stateless for snapshots. */
@Composable
fun DictateScreen(
    state: DictationState,
    onStop: () -> Unit,
    onCancel: () -> Unit,
    onClose: () -> Unit,
    onOpenApp: () -> Unit,
    onRetry: () -> Unit,
    needsSetup: Boolean,
    modifier: Modifier = Modifier,
) {
    val recording = state is DictationState.Recording
    Box(
        modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.32f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = !recording, onClick = onClose)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(16.dp),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth().clickable(enabled = false, onClick = {}),
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    stringResource(R.string.app_name),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    dictationStatusText(state),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.liveStatus(),
                    color = if (state is DictationState.Error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
                when (state) {
                    is DictationState.Recording -> {
                        LevelMeter(state.level)
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = onCancel, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                                Text(stringResource(R.string.action_cancel))
                            }
                            Button(onClick = onStop, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                                Text(stringResource(R.string.action_stop))
                            }
                        }
                    }
                    is DictationState.Transcribing -> CircularProgressIndicator()
                    is DictationState.Done -> {
                        Text(
                            state.text,
                            style = MaterialTheme.typography.bodyLarge,
                            maxLines = 6,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            stringResource(R.string.dictate_copied),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp).fillMaxWidth()) {
                            Text(stringResource(R.string.action_close))
                        }
                    }
                    is DictationState.Error -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                                Text(stringResource(R.string.action_close))
                            }
                            if (needsSetup) {
                                Button(onClick = onOpenApp, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                                    Text(stringResource(R.string.ime_open_setup_short))
                                }
                            } else {
                                Button(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                                    Text(stringResource(R.string.action_try_again))
                                }
                            }
                        }
                    }
                    DictationState.Idle -> Unit
                }
            }
        }
    }
}
