package ai.whisperio.android.ui.settings

import ai.whisperio.android.R
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.KeyUi
import ai.whisperio.android.ui.common.KeyEntry
import ai.whisperio.android.ui.common.Languages
import ai.whisperio.android.ui.common.SectionTitle
import ai.whisperio.android.ui.common.keyUiText
import ai.whisperio.android.ui.common.liveStatus
import ai.whisperio.android.ui.common.providerLabel
import ai.whisperio.core.ProviderId
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp

data class KeyDialogState(
    val provider: ProviderId,
    val key: String = "",
    val baseUrl: String = "",
    val ui: KeyUi = KeyUi.Idle,
)

data class SettingsUiState(
    val settings: AppSettings,
    val configured: Set<ProviderId> = emptySet(),
    /** Keys wiped because the Keystore key was invalidated: shown as "paste again". */
    val lost: Set<ProviderId> = emptySet(),
    val models: Map<ProviderId, List<String>> = emptyMap(),
    /** OpenAI base URL is set and is not an official host: show the custom-host warning (CONTRACT 4.3). */
    val customHost: Boolean = false,
    val keyDialog: KeyDialogState? = null,
    /** Result of the last "Check key" per provider (Validating while in flight). Absent = never checked. */
    val keyChecks: Map<ProviderId, KeyUi> = emptyMap(),
    /** F7: number of apps with a saved keyboard language. */
    val appLanguageCount: Int = 0,
)

interface SettingsActions {
    fun onMove(id: ProviderId, delta: Int) {}
    fun onModel(id: ProviderId, model: String) {}
    fun onOpenKeyDialog(id: ProviderId) {}
    fun onRemoveKey(id: ProviderId) {}
    fun onCheckKey(id: ProviderId) {}
    fun onKeyDialogKey(value: String) {}
    fun onKeyDialogUrl(value: String) {}
    fun onKeyDialogSubmit() {}
    fun onKeyDialogDismiss() {}
    fun onFallback(value: Boolean) {}
    fun onLanguage(code: String) {}
    fun onPerAppLanguage(value: Boolean) {}
    fun onClearAppLanguages() {}
    fun onVocabulary(value: String) {}
    fun onCleanup(value: Boolean) {}
    fun onAutoStop(seconds: Int) {}
    fun onKeepAudio(value: Boolean) {}
    fun onAutoDelete(days: Int?) {}
    fun onSensitive(value: Boolean) {}
    fun onConsent(value: Boolean) {}
    fun onDeleteAllAudio() {}
    fun onEraseAll() {}
    fun onCategories() {}
    fun onAbout() {}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(state: SettingsUiState, actions: SettingsActions, modifier: Modifier = Modifier) {
    val s = state.settings
    var confirmErase by rememberSaveable { mutableStateOf(false) }
    var confirmAudio by rememberSaveable { mutableStateOf(false) }
    var vocabulary by rememberSaveable { mutableStateOf(s.vocabulary) }

    Column(modifier.fillMaxSize()) {
        TopAppBar(title = { Text(stringResource(R.string.nav_settings)) })
        Column(
            Modifier
                .widthIn(max = 640.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            SectionTitle(stringResource(R.string.settings_providers))
            Text(
                stringResource(R.string.settings_providers_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            s.order.forEachIndexed { index, slot ->
                ProviderCard(
                    index = index,
                    last = s.order.lastIndex,
                    id = slot.id,
                    model = slot.model,
                    models = state.models[slot.id].orEmpty(),
                    hasKey = slot.id in state.configured,
                    lost = slot.id in state.lost,
                    check = state.keyChecks[slot.id] ?: KeyUi.Idle,
                    baseUrl = s.baseUrls[slot.id],
                    customHostWarning = slot.id == ProviderId.OPENAI && state.customHost,
                    actions = actions,
                )
            }
            SwitchRow(stringResource(R.string.settings_fallback), stringResource(R.string.settings_fallback_hint), s.fallbackEnabled, actions::onFallback)

            SectionTitle(stringResource(R.string.settings_dictation))
            Text(stringResource(R.string.settings_language), style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Languages.settings.forEach { code ->
                    FilterChip(
                        selected = s.language == code,
                        onClick = { actions.onLanguage(code) },
                        label = { Text(Languages.label(code)) },
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
            SwitchRow(
                stringResource(R.string.settings_per_app_language),
                stringResource(R.string.settings_per_app_language_hint),
                s.perAppLanguage,
                actions::onPerAppLanguage,
            )
            if (s.perAppLanguage) {
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.settings_per_app_language_count, state.appLanguageCount),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    val clearDesc = stringResource(R.string.settings_per_app_language_clear_desc, state.appLanguageCount)
                    TextButton(
                        onClick = actions::onClearAppLanguages,
                        enabled = state.appLanguageCount > 0,
                        modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = clearDesc },
                    ) { Text(stringResource(R.string.settings_per_app_language_clear)) }
                }
            }
            OutlinedTextField(
                value = vocabulary,
                onValueChange = { vocabulary = it; actions.onVocabulary(it) },
                label = { Text(stringResource(R.string.settings_vocabulary)) },
                supportingText = { Text(stringResource(R.string.settings_vocabulary_hint)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
            SwitchRow(stringResource(R.string.settings_cleanup), stringResource(R.string.settings_cleanup_hint), s.cleanupEnabled, actions::onCleanup)
            Text(
                if (s.autoStopSeconds == 0) stringResource(R.string.settings_autostop_off)
                else stringResource(R.string.settings_autostop_value, s.autoStopSeconds),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 12.dp),
            )
            Slider(
                value = s.autoStopSeconds / 5f,
                onValueChange = { actions.onAutoStop((it.toInt() * 5)) },
                valueRange = 0f..24f,
                steps = 23,
                modifier = Modifier.heightIn(min = 48.dp),
            )

            SectionTitle(stringResource(R.string.settings_privacy_storage))
            SwitchRow(
                stringResource(R.string.settings_consent),
                stringResource(R.string.settings_consent_hint),
                s.cloudConsentGranted,
                actions::onConsent,
            )
            SwitchRow(stringResource(R.string.settings_keep_audio), stringResource(R.string.settings_keep_audio_hint), s.keepAudio, actions::onKeepAudio)
            Text(stringResource(R.string.settings_auto_delete), style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AppSettings.AUTO_DELETE_CHOICES.forEach { days ->
                    FilterChip(
                        selected = s.autoDeleteDays == days,
                        onClick = { actions.onAutoDelete(days) },
                        label = {
                            Text(if (days == null) stringResource(R.string.settings_never) else stringResource(R.string.settings_days, days))
                        },
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
            SwitchRow(stringResource(R.string.settings_sensitive), stringResource(R.string.settings_sensitive_hint), s.transcriptsSensitive, actions::onSensitive)
            OutlinedButton(onClick = { confirmAudio = true }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 48.dp)) {
                Text(stringResource(R.string.settings_delete_audio))
            }
            OutlinedButton(
                onClick = { confirmErase = true },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.settings_erase_all), color = MaterialTheme.colorScheme.error) }

            SectionTitle(stringResource(R.string.settings_categories))
            Text(
                stringResource(R.string.settings_categories_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = actions::onCategories,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.settings_categories)) }

            TextButton(onClick = actions::onAbout, modifier = Modifier.padding(top = 16.dp).heightIn(min = 48.dp)) {
                Text(stringResource(R.string.nav_about))
            }
        }
    }

    state.keyDialog?.let { d ->
        AlertDialog(
            onDismissRequest = actions::onKeyDialogDismiss,
            title = { Text(providerLabel(d.provider)) },
            text = {
                KeyEntry(
                    provider = d.provider,
                    key = d.key,
                    baseUrl = d.baseUrl,
                    ui = d.ui,
                    onKeyChange = actions::onKeyDialogKey,
                    onBaseUrlChange = actions::onKeyDialogUrl,
                    onSubmit = actions::onKeyDialogSubmit,
                )
            },
            confirmButton = {
                TextButton(onClick = actions::onKeyDialogDismiss) {
                    Text(stringResource(if (d.ui is KeyUi.Valid) R.string.action_close else R.string.action_cancel))
                }
            },
        )
    }
    if (confirmAudio) {
        AlertDialog(
            onDismissRequest = { confirmAudio = false },
            title = { Text(stringResource(R.string.settings_delete_audio)) },
            text = { Text(stringResource(R.string.settings_delete_audio_body)) },
            confirmButton = {
                TextButton(onClick = { confirmAudio = false; actions.onDeleteAllAudio() }) { Text(stringResource(R.string.action_delete)) }
            },
            dismissButton = { TextButton(onClick = { confirmAudio = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
    if (confirmErase) {
        AlertDialog(
            onDismissRequest = { confirmErase = false },
            title = { Text(stringResource(R.string.settings_erase_all)) },
            text = { Text(stringResource(R.string.settings_erase_all_body)) },
            confirmButton = {
                TextButton(onClick = { confirmErase = false; actions.onEraseAll() }) {
                    Text(stringResource(R.string.settings_erase_confirm), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmErase = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProviderCard(
    index: Int,
    last: Int,
    id: ProviderId,
    model: String,
    models: List<String>,
    hasKey: Boolean,
    lost: Boolean,
    check: KeyUi,
    baseUrl: String?,
    customHostWarning: Boolean,
    actions: SettingsActions,
) {
    Card(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${index + 1}. ${providerLabel(id)}", style = MaterialTheme.typography.titleMedium)
                    val statusRes = when {
                        lost -> R.string.key_lost
                        hasKey -> R.string.key_saved
                        id == ProviderId.SELFHOSTED && !baseUrl.isNullOrBlank() -> R.string.key_saved_url_only
                        else -> R.string.key_none
                    }
                    Text(
                        stringResource(statusRes),
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (lost) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = { actions.onMove(id, -1) }, enabled = index > 0) {
                    Icon(Icons.Filled.KeyboardArrowUp, contentDescription = stringResource(R.string.settings_move_up, providerLabel(id)))
                }
                IconButton(onClick = { actions.onMove(id, 1) }, enabled = index < last) {
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = stringResource(R.string.settings_move_down, providerLabel(id)))
                }
            }
            val choices = if (model in models || model.isBlank()) models else listOf(model) + models
            if (choices.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    choices.forEach { m ->
                        FilterChip(
                            selected = m == model,
                            onClick = { actions.onModel(id, m) },
                            label = { Text(m) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        )
                    }
                }
            }
            val checkMessage = keyUiText(check)
            if (checkMessage != null) {
                Text(
                    checkMessage,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (check is KeyUi.Valid) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    modifier = Modifier.liveStatus().padding(top = 4.dp),
                )
            }
            if (!baseUrl.isNullOrBlank()) {
                Text(baseUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (customHostWarning) {
                Text(
                    stringResource(R.string.settings_custom_host_warning),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            // FlowRow: at large font scales the three key actions wrap instead of squeezing Remove to zero width.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                OutlinedButton(onClick = { actions.onOpenKeyDialog(id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(if (hasKey) R.string.key_replace else R.string.key_add))
                }
                if (hasKey) {
                    TextButton(
                        onClick = { actions.onCheckKey(id) },
                        enabled = check != KeyUi.Validating,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) {
                        Text(stringResource(if (check == KeyUi.Validating) R.string.key_checking else R.string.key_check))
                    }
                    TextButton(onClick = { actions.onRemoveKey(id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.key_remove))
                    }
                }
            }
        }
    }
}

@Composable
private fun SwitchRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(top = 8.dp)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}
