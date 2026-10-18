package ai.whisperio.android.ui.history

import ai.whisperio.android.R
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.ui.common.KeyValueRow
import ai.whisperio.android.ui.common.formatDateTime
import ai.whisperio.android.ui.common.formatElapsed
import ai.whisperio.android.ui.home.RecordingRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
fun HistoryListScreen(items: List<Recording>, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        TopAppBar(title = { Text(stringResource(R.string.nav_history)) })
        if (items.isEmpty()) {
            Text(
                stringResource(R.string.history_empty),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(20.dp),
            )
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.id }) { RecordingRow(it, onClick = { onOpen(it.id) }) }
            }
        }
    }
}

interface HistoryDetailActions {
    fun onBack() {}
    fun onCopy(text: String) {}
    fun onShare(text: String) {}
    fun onRetry(id: String) {}
    fun onDelete(id: String) {}
}

@Composable
fun HistoryDetailScreen(rec: Recording?, actions: HistoryDetailActions, modifier: Modifier = Modifier) {
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    Column(modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.history_detail)) },
            navigationIcon = {
                IconButton(onClick = actions::onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                }
            },
            actions = {
                if (rec != null) {
                    IconButton(onClick = { confirmDelete = true }) {
                        Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.action_delete))
                    }
                }
            },
        )
        if (rec == null) {
            Text(stringResource(R.string.history_missing), Modifier.padding(20.dp))
            return@Column
        }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp)) {
            val text = rec.transcript
            if (rec.status == RecordingStatus.DONE && text != null) {
                SelectionContainer { Text(text, style = MaterialTheme.typography.bodyLarge) }
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { actions.onCopy(text) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Icon(Icons.Filled.ContentCopy, null, Modifier.padding(end = 8.dp))
                        Text(stringResource(R.string.action_copy))
                    }
                    OutlinedButton(onClick = { actions.onShare(text) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Icon(Icons.Filled.Share, null, Modifier.padding(end = 8.dp))
                        Text(stringResource(R.string.action_share))
                    }
                }
            } else {
                Text(
                    when (rec.status) {
                        RecordingStatus.FAILED -> rec.error?.takeIf { it.isNotBlank() } ?: stringResource(R.string.history_failed)
                        RecordingStatus.TRANSCRIBING -> stringResource(R.string.history_transcribing)
                        else -> stringResource(R.string.history_recording)
                    },
                    color = MaterialTheme.colorScheme.error.takeIf { rec.status == RecordingStatus.FAILED } ?: MaterialTheme.colorScheme.onSurface,
                )
            }
            if (rec.audioPath != null && rec.status != RecordingStatus.TRANSCRIBING && rec.status != RecordingStatus.RECORDING) {
                OutlinedButton(onClick = { actions.onRetry(rec.id) }, modifier = Modifier.padding(top = 12.dp).heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.Refresh, null, Modifier.padding(end = 8.dp))
                    Text(stringResource(R.string.action_retry))
                }
            }
            if (rec.inserted == false && rec.status == RecordingStatus.DONE) {
                Text(
                    stringResource(R.string.history_not_inserted),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
            KeyValueRow(stringResource(R.string.history_when), formatDateTime(rec.createdAt))
            KeyValueRow(stringResource(R.string.history_duration), formatElapsed(rec.durationMs))
            KeyValueRow(stringResource(R.string.history_provider), "${rec.provider} / ${rec.model}")
            KeyValueRow(stringResource(R.string.history_language), rec.language)
        }
    }
    if (confirmDelete && rec != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(stringResource(R.string.history_delete_title)) },
            text = { Text(stringResource(R.string.history_delete_body)) },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; actions.onDelete(rec.id) }) { Text(stringResource(R.string.action_delete)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.action_cancel)) }
            },
        )
    }
}
