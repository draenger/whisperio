package ai.whisperio.android.ui.onboarding

import ai.whisperio.android.R
import ai.whisperio.android.settings.KeyUi
import ai.whisperio.android.ui.common.KeyEntry
import ai.whisperio.android.ui.common.Languages
import ai.whisperio.android.ui.common.providerLabel
import ai.whisperio.core.ProviderId
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

enum class OnboardingStep { WELCOME, PRIVACY, PROVIDER, LANGUAGE, MIC, KEYBOARD, DONE }

data class OnboardingState(
    val step: OnboardingStep = OnboardingStep.WELCOME,
    val consent: Boolean = false,
    val provider: ProviderId = ProviderId.OPENAI,
    val keyInput: String = "",
    val baseUrl: String = "",
    val keyUi: KeyUi = KeyUi.Idle,
    val language: String = "auto",
    val micGranted: Boolean = false,
    val keyboardEnabled: Boolean = false,
    val canAddTile: Boolean = false,
    /** A key for [provider] is already stored (re-opened onboarding), so Next is allowed without re-pasting. */
    val providerReady: Boolean = false,
)

interface OnboardingActions {
    fun onNext() {}
    fun onBack() {}
    fun onConsent(value: Boolean) {}
    fun onProvider(id: ProviderId) {}
    fun onKeyChange(value: String) {}
    fun onBaseUrlChange(value: String) {}
    fun onSubmitKey() {}
    fun onLanguage(code: String) {}
    fun onGrantMic() {}
    fun onOpenKeyboardSettings() {}
    fun onAddTile() {}
    fun onFinish() {}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OnboardingScreen(state: OnboardingState, actions: OnboardingActions, modifier: Modifier = Modifier) {
    val steps = OnboardingStep.entries
    val index = steps.indexOf(state.step)
    val canNext = when (state.step) {
        OnboardingStep.PRIVACY -> state.consent
        OnboardingStep.PROVIDER -> state.keyUi == KeyUi.Valid || state.providerReady
        else -> true
    }
    Column(
        modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 560.dp).weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
            Text(
                stringResource(R.string.onboarding_step_of, index + 1, steps.size),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            LinearProgressIndicator(
                progress = { (index + 1f) / steps.size },
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            )
            Spacer(Modifier.height(8.dp))
            when (state.step) {
                OnboardingStep.WELCOME -> StepText(R.string.onboarding_welcome_title, R.string.onboarding_welcome_body)
                OnboardingStep.PRIVACY -> {
                    StepText(R.string.onboarding_privacy_title, R.string.onboarding_privacy_body)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 56.dp)
                            .padding(top = 16.dp)
                            .toggleable(value = state.consent, role = Role.Checkbox, onValueChange = actions::onConsent),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = state.consent, onCheckedChange = null)
                        Text(
                            stringResource(R.string.onboarding_consent),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(start = 12.dp),
                        )
                    }
                }
                OnboardingStep.PROVIDER -> {
                    StepText(R.string.onboarding_provider_title, R.string.onboarding_provider_body)
                    FlowRow(
                        Modifier.padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ProviderId.entries.forEach { id ->
                            FilterChip(
                                selected = state.provider == id,
                                onClick = { actions.onProvider(id) },
                                label = { Text(providerLabel(id)) },
                                modifier = Modifier.heightIn(min = 48.dp),
                            )
                        }
                    }
                    KeyEntry(
                        provider = state.provider,
                        key = state.keyInput,
                        baseUrl = state.baseUrl,
                        ui = state.keyUi,
                        onKeyChange = actions::onKeyChange,
                        onBaseUrlChange = actions::onBaseUrlChange,
                        onSubmit = actions::onSubmitKey,
                    )
                }
                OnboardingStep.LANGUAGE -> {
                    StepText(R.string.onboarding_language_title, R.string.onboarding_language_body)
                    FlowRow(
                        Modifier.padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Languages.onboarding.forEach { code ->
                            FilterChip(
                                selected = state.language == code,
                                onClick = { actions.onLanguage(code) },
                                label = { Text(Languages.label(code)) },
                                modifier = Modifier.heightIn(min = 48.dp),
                            )
                        }
                    }
                }
                OnboardingStep.MIC -> {
                    StepText(R.string.onboarding_mic_title, R.string.onboarding_mic_body)
                    Spacer(Modifier.height(16.dp))
                    if (state.micGranted) {
                        Text(stringResource(R.string.onboarding_mic_granted), color = MaterialTheme.colorScheme.primary)
                    } else {
                        Button(onClick = actions::onGrantMic, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text(stringResource(R.string.onboarding_mic_grant))
                        }
                    }
                }
                OnboardingStep.KEYBOARD -> {
                    StepText(R.string.onboarding_keyboard_title, R.string.onboarding_keyboard_body)
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = actions::onOpenKeyboardSettings, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.onboarding_keyboard_open))
                    }
                    if (state.canAddTile) {
                        OutlinedButton(
                            onClick = actions::onAddTile,
                            modifier = Modifier.padding(top = 8.dp).heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.onboarding_add_tile)) }
                    }
                    Text(
                        stringResource(R.string.onboarding_skippable),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                OnboardingStep.DONE -> StepText(R.string.onboarding_done_title, R.string.onboarding_done_body)
            }
        }
        Row(
            Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (index > 0) {
                TextButton(onClick = actions::onBack, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.action_back))
                }
            } else {
                Spacer(Modifier)
            }
            if (state.step == OnboardingStep.DONE) {
                Button(onClick = actions::onFinish, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.onboarding_finish))
                }
            } else {
                Button(onClick = actions::onNext, enabled = canNext, modifier = Modifier.heightIn(min = 48.dp)) {
                    val skip = state.step == OnboardingStep.KEYBOARD
                    Text(stringResource(if (skip) R.string.onboarding_skip else R.string.action_next))
                }
            }
        }
    }
}

@Composable
private fun StepText(title: Int, body: Int) {
    Text(stringResource(title), style = MaterialTheme.typography.headlineMedium)
    Spacer(Modifier.height(12.dp))
    Text(stringResource(body), style = MaterialTheme.typography.bodyLarge)
}
