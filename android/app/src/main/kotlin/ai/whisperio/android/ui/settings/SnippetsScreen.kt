package ai.whisperio.android.ui.settings

import ai.whisperio.android.R
import ai.whisperio.core.Snippet
import ai.whisperio.core.SnippetCheck
import ai.whisperio.core.Snippets
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

interface SnippetsActions {
    fun onBack() {}

    /** [editId] null = add. Values already passed [Snippets.check] in the UI; the repository checks again atomically. */
    fun onSave(trigger: String, replacement: String, editId: String?) {}
    fun onDelete(id: String) {}
}

/** Settings > Snippets: say a trigger phrase on its own and the replacement text is inserted instead. */
@Composable
fun SnippetsScreen(snippets: List<Snippet>, actions: SnippetsActions, modifier: Modifier = Modifier) {
    // Editor state: null = closed, "" = adding, otherwise the id being edited.
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var confirmDelete by rememberSaveable { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.settings_snippets)) },
            navigationIcon = {
                IconButton(onClick = actions::onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                }
            },
        )
        Column(
            Modifier.widthIn(max = 640.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            Text(
                stringResource(R.string.snippets_explainer),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (snippets.isEmpty()) {
                Text(
                    stringResource(R.string.snippets_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 12.dp),
                )
            }
            snippets.forEach { s ->
                SnippetRow(s, onEdit = { editing = s.id }, onDelete = { confirmDelete = s.id })
            }
            Button(
                onClick = { editing = "" },
                modifier = Modifier.padding(top = 12.dp).heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.snippets_add)) }
        }
    }

    editing?.let { id ->
        val existing = snippets.firstOrNull { it.id == id }
        // An edited snippet deleted meanwhile simply closes the editor.
        if (id.isEmpty() || existing != null) {
            SnippetEditor(
                existing = existing,
                others = snippets.filterNot { it.id == id },
                onDismiss = { editing = null },
                onSave = { t, r -> editing = null; actions.onSave(t, r, existing?.id) },
            )
        }
    }

    val pending = snippets.firstOrNull { it.id == confirmDelete }
    if (pending != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text(stringResource(R.string.snippets_delete_title)) },
            text = { Text(stringResource(R.string.snippets_delete_body, pending.trigger)) },
            confirmButton = {
                TextButton(onClick = { confirmDelete = null; actions.onDelete(pending.id) }) {
                    Text(stringResource(R.string.action_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@Composable
private fun SnippetRow(s: Snippet, onEdit: () -> Unit, onDelete: () -> Unit) {
    val editLabel = stringResource(R.string.snippets_edit_cd, s.trigger)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(onClickLabel = editLabel, role = Role.Button, onClick = onEdit)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(s.trigger, style = MaterialTheme.typography.bodyLarge)
            Text(
                s.replacement,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.snippets_delete_cd, s.trigger))
        }
    }
}

@Composable
private fun SnippetEditor(existing: Snippet?, others: List<Snippet>, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var trigger by rememberSaveable { mutableStateOf(existing?.trigger.orEmpty()) }
    var replacement by rememberSaveable { mutableStateOf(existing?.replacement.orEmpty()) }
    val check = Snippets.check(trigger, replacement, others)
    // Blank fields are only "not ready yet"; show errors for real problems.
    val triggerError: Int? = when (check) {
        SnippetCheck.TriggerTooLong -> R.string.snippets_err_trigger_long
        SnippetCheck.Duplicate -> R.string.snippets_err_duplicate
        else -> null
    }
    val replacementError: Int? = if (check == SnippetCheck.ReplacementTooLong) R.string.snippets_err_replacement_long else null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (existing == null) R.string.snippets_add else R.string.snippets_edit_title)) },
        text = {
            Column {
                OutlinedTextField(
                    value = trigger,
                    onValueChange = { trigger = it },
                    label = { Text(stringResource(R.string.snippets_trigger_label)) },
                    isError = triggerError != null,
                    supportingText = { Text(stringResource(triggerError ?: R.string.snippets_trigger_hint)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = replacement,
                    onValueChange = { replacement = it },
                    label = { Text(stringResource(R.string.snippets_replacement_label)) },
                    isError = replacementError != null,
                    supportingText = if (replacementError != null) ({ Text(stringResource(replacementError)) }) else null,
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { (check as? SnippetCheck.Ok)?.let { onSave(it.trigger, it.replacement) } },
                enabled = check is SnippetCheck.Ok,
            ) { Text(stringResource(R.string.snippets_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
