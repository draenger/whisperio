package ai.whisperio.android.ui.common

import ai.whisperio.android.R
import ai.whisperio.android.settings.KeyUi
import ai.whisperio.core.ProviderId
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun keyUiText(ui: KeyUi): String? = when (ui) {
    KeyUi.Idle, KeyUi.Validating -> null
    KeyUi.Valid -> stringResource(R.string.key_valid)
    KeyUi.Invalid -> stringResource(R.string.key_invalid)
    KeyUi.Missing -> stringResource(R.string.key_lost)
    is KeyUi.Network -> stringResource(R.string.key_network, ui.message)
    is KeyUi.Unexpected -> stringResource(R.string.key_unexpected, ui.status)
    is KeyUi.InvalidUrl -> stringResource(R.string.key_invalid_url, ui.message)
}

/** Paste field + "Check and save" for one provider; used by onboarding and the settings key dialog. */
@Composable
fun KeyEntry(
    provider: ProviderId,
    key: String,
    baseUrl: String,
    ui: KeyUi,
    onKeyChange: (String) -> Unit,
    onBaseUrlChange: (String) -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val message = keyUiText(ui)
    val isError = ui is KeyUi.Invalid || ui is KeyUi.Network || ui is KeyUi.Unexpected || ui is KeyUi.InvalidUrl
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = key,
            onValueChange = onKeyChange,
            label = {
                Text(
                    if (provider == ProviderId.SELFHOSTED) stringResource(R.string.key_field_optional)
                    else stringResource(R.string.key_field, providerLabel(provider)),
                )
            },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            isError = isError && ui !is KeyUi.InvalidUrl,
            modifier = Modifier.fillMaxWidth(),
        )
        if (provider == ProviderId.SELFHOSTED || provider == ProviderId.OPENAI) {
            OutlinedTextField(
                value = baseUrl,
                onValueChange = onBaseUrlChange,
                label = {
                    Text(
                        if (provider == ProviderId.SELFHOSTED) stringResource(R.string.url_selfhosted)
                        else stringResource(R.string.url_openai_custom),
                    )
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                isError = ui is KeyUi.InvalidUrl,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (message != null) {
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                modifier = Modifier.liveStatus(),
            )
        }
        Button(
            onClick = onSubmit,
            enabled = ui != KeyUi.Validating && (key.isNotBlank() || provider == ProviderId.SELFHOSTED),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Text(if (ui == KeyUi.Validating) stringResource(R.string.key_checking) else stringResource(R.string.key_check_save))
        }
    }
}
