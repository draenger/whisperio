package ai.whisperio.android.ui.home

import ai.whisperio.android.R
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.settings.CustomCategory
import ai.whisperio.android.ui.common.CategoryTag
import ai.whisperio.android.ui.common.CategoryUi
import ai.whisperio.android.ui.common.LevelMeter
import ai.whisperio.android.ui.common.rememberCategoryOptions
import ai.whisperio.android.ui.common.SectionTitle
import ai.whisperio.android.ui.common.dictationStatusText
import ai.whisperio.android.ui.common.formatDateTime
import ai.whisperio.android.ui.common.liveStatus
import androidx.annotation.StringRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

data class HomeState(
    val dictation: DictationState = DictationState.Idle,
    val recent: List<Recording> = emptyList(),
    val setupNeeded: Boolean = false,
    val providerLabel: String = "",
    /** CONTRACT-1.2 F3: needed to resolve the tag of a custom category on the recent rows. */
    val customCategories: List<CustomCategory> = emptyList(),
)

interface HomeActions {
    fun onDictate() {}
    fun onStop() {}
    fun onCopy(text: String) {}
    fun onDismissResult() {}
    fun onOpen(id: String) {}
    fun onSeeAll() {}
    fun onOpenSetup() {}
}

@Composable
fun HomeScreen(state: HomeState, actions: HomeActions, modifier: Modifier = Modifier) {
    val d = state.dictation
    val categoryOptions = rememberCategoryOptions(state.customCategories)
    val recording = d is DictationState.Recording
    val transcribing = d is DictationState.Transcribing
    LazyColumn(
        modifier = modifier.widthIn(max = 640.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 12.dp),
    ) {
        item {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
                if (state.providerLabel.isNotEmpty()) {
                    Text(
                        stringResource(R.string.home_audio_goes_to, state.providerLabel),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (state.setupNeeded) {
                    Button(onClick = actions::onOpenSetup, modifier = Modifier.padding(top = 16.dp).heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.home_finish_setup))
                    }
                } else {
                    val desc = if (recording) stringResource(R.string.home_stop) else stringResource(R.string.home_dictate)
                    Box(Modifier.padding(vertical = 24.dp).size(136.dp), contentAlignment = Alignment.Center) {
                        if (transcribing) CircularProgressIndicator(Modifier.size(136.dp))
                        FilledIconButton(
                            onClick = if (recording) actions::onStop else actions::onDictate,
                            enabled = !transcribing,
                            shape = CircleShape,
                            modifier = Modifier.size(112.dp).semantics { contentDescription = desc },
                            colors = IconButtonDefaults.filledIconButtonColors(
                                containerColor = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                                contentColor = if (recording) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary,
                            ),
                        ) {
                            Icon(if (recording) Icons.Filled.Stop else Icons.Filled.Mic, null, Modifier.size(56.dp))
                        }
                    }
                    if (d is DictationState.Recording) LevelMeter(d.level, Modifier.widthIn(max = 320.dp))
                    Text(
                        dictationStatusText(d),
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                        color = if (d is DictationState.Error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.liveStatus().padding(top = 8.dp),
                    )
                }
                if (d is DictationState.Done) {
                    ResultCard(d.text, actions)
                }
                if (d is DictationState.Error) {
                    TextButton(onClick = actions::onDismissResult, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.action_dismiss))
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                SectionTitle(stringResource(R.string.home_recent))
                if (state.recent.isNotEmpty()) {
                    TextButton(onClick = actions::onSeeAll, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.home_see_all))
                    }
                }
            }
            if (state.recent.isEmpty()) {
                Text(
                    stringResource(R.string.history_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
        }
        items(state.recent, key = { it.id }) { rec ->
            RecordingRow(
                rec,
                onClick = { actions.onOpen(rec.id) },
                category = rec.category?.let { id -> categoryOptions.firstOrNull { it.id == id } },
            )
        }
    }
}

@Composable
private fun ResultCard(text: String, actions: HomeActions) {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(text, style = MaterialTheme.typography.bodyLarge, maxLines = 8, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { actions.onCopy(text) }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Filled.ContentCopy, null, Modifier.size(18.dp))
                Text(stringResource(R.string.action_copy), modifier = Modifier.padding(start = 8.dp))
            }
            TextButton(onClick = actions::onDismissResult, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.action_dismiss))
            }
        }
    }
}

@StringRes
fun sourceLabelRes(source: RecordingSource): Int = when (source) {
    RecordingSource.APP -> R.string.source_app
    RecordingSource.KEYBOARD -> R.string.source_keyboard
    RecordingSource.TILE -> R.string.source_tile
    RecordingSource.SHORTCUT -> R.string.source_shortcut
    RecordingSource.WIDGET -> R.string.source_widget
}

/**
 * Shared by Home and the History list. [selected] non-null = selection mode (checkbox, tap toggles via [onClick]);
 * [onLongClick] starts it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RecordingRow(
    rec: Recording,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean? = null,
    onLongClick: (() -> Unit)? = null,
    /** CONTRACT-1.2 F3: the resolved category of [rec], null when none (no tag, D2). */
    category: CategoryUi? = null,
    /** CONTRACT-1.2 F5: double-tap copy (History only). Delays a single tap by the double-tap timeout. */
    onDoubleClick: (() -> Unit)? = null,
    /** CONTRACT-1.2 F5: TalkBack custom actions (Delete, Copy). */
    customActions: List<CustomAccessibilityAction> = emptyList(),
) {
    val subtitle = when (rec.status) {
        RecordingStatus.DONE -> rec.transcript.orEmpty()
        RecordingStatus.FAILED -> stringResource(R.string.history_failed)
        RecordingStatus.RECORDING -> stringResource(R.string.history_recording)
        RecordingStatus.TRANSCRIBING -> stringResource(R.string.history_transcribing)
    }
    ListItem(
        headlineContent = { Text(subtitle, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            Column {
                Text("${formatDateTime(rec.createdAt)} - ${stringResource(sourceLabelRes(rec.source))}")
                if (category != null) CategoryTag(category, Modifier.padding(top = 2.dp))
            }
        },
        leadingContent = if (selected == null) null else {
            { Checkbox(checked = selected, onCheckedChange = null) }
        },
        modifier = modifier.heightIn(min = 56.dp)
            .combinedClickable(
                onClick = onClick,
                role = if (selected != null) Role.Checkbox else null,
                onLongClickLabel = if (onLongClick != null) stringResource(R.string.select_row) else null,
                onLongClick = onLongClick,
                onDoubleClick = onDoubleClick,
            )
            .then(if (customActions.isEmpty()) Modifier else Modifier.semantics { this.customActions = customActions })
            .then(
                if (selected == null) Modifier else {
                    val state = stringResource(if (selected) R.string.state_selected else R.string.state_not_selected)
                    Modifier.semantics { stateDescription = state }
                },
            ),
    )
}
