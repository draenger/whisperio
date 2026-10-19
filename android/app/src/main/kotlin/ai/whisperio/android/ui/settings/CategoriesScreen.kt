package ai.whisperio.android.ui.settings

import ai.whisperio.android.R
import ai.whisperio.android.settings.CategoryNameCheck
import ai.whisperio.android.settings.CustomCategories
import ai.whisperio.android.settings.CustomCategory
import ai.whisperio.android.ui.common.CategoryUi
import ai.whisperio.android.ui.common.SectionTitle
import ai.whisperio.android.ui.common.customCategoryUi
import ai.whisperio.android.ui.common.rememberCategoryOptions
import ai.whisperio.android.ui.common.seedLabels
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp

interface CategoriesActions {
    fun onBack() {}

    /** [name] already passed the D6 rule in the UI; the repository checks it again atomically. */
    fun onAdd(name: String) {}
    fun onDelete(id: String) {}
}

/** CONTRACT-1.2 F3: Settings > Categories. Seeds are listed read-only; custom ones can be added and deleted (no edit). */
@Composable
fun CategoriesScreen(
    customs: List<CustomCategory>,
    actions: CategoriesActions,
    modifier: Modifier = Modifier,
    initialName: String = "",
) {
    var name by rememberSaveable { mutableStateOf(initialName) }
    var confirmDelete by rememberSaveable { mutableStateOf<String?>(null) }
    val options = rememberCategoryOptions(customs)
    val taken = seedLabels() + customs.map { it.name }
    val check = CustomCategories.check(name, taken)

    fun submit() {
        val ok = check as? CategoryNameCheck.Ok ?: return
        actions.onAdd(ok.name)
        name = ""
    }

    Column(modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.settings_categories)) },
            navigationIcon = {
                IconButton(onClick = actions::onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                }
            },
        )
        Column(
            Modifier.widthIn(max = 640.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            SectionTitle(stringResource(R.string.categories_builtin))
            options.filter { !it.custom }.forEach { CategoryRow(it, null) }

            SectionTitle(stringResource(R.string.categories_custom))
            if (customs.isEmpty()) {
                Text(
                    stringResource(R.string.categories_custom_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
            customs.forEach { c -> CategoryRow(customCategoryUi(c)) { confirmDelete = c.id } }

            val error: Int? = when (check) {
                CategoryNameCheck.TooLong -> R.string.categories_err_long
                CategoryNameCheck.Duplicate -> R.string.categories_err_duplicate
                else -> null
            }
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(stringResource(R.string.categories_add_label)) },
                isError = error != null,
                supportingText = if (error != null) ({ Text(stringResource(error)) }) else null,
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
            Button(
                onClick = { submit() },
                enabled = check is CategoryNameCheck.Ok,
                modifier = Modifier.padding(top = 8.dp).heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.categories_add)) }
        }
    }

    val pending = customs.firstOrNull { it.id == confirmDelete }
    if (pending != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text(stringResource(R.string.categories_delete_title)) },
            text = { Text(stringResource(R.string.categories_delete_body, pending.name)) },
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
private fun CategoryRow(c: CategoryUi, onDelete: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(c.icon, contentDescription = null, tint = c.color, modifier = Modifier.padding(end = 12.dp))
        Text(c.label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (onDelete != null) {
            IconButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.categories_delete_cd, c.label))
            }
        }
    }
}
