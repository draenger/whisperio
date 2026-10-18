package ai.whisperio.android.ui.about

import ai.whisperio.android.R
import ai.whisperio.android.ui.common.KeyValueRow
import ai.whisperio.android.ui.common.SectionTitle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

object AboutLinks {
    // Real domain from docs/CNAME.
    const val PRIVACY = "https://whisperio.danielkasprzyk.com/privacy.html"
    const val TERMS = "https://whisperio.danielkasprzyk.com/terms.html"
    const val SUPPORT = "https://whisperio.danielkasprzyk.com/support.html"
}

@Composable
fun AboutScreen(versionName: String, versionCode: Int, onBack: () -> Unit, onOpenUrl: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.nav_about)) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                }
            },
        )
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp)) {
            Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
            Text(
                stringResource(R.string.about_tagline),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            KeyValueRow(stringResource(R.string.about_version), "$versionName ($versionCode)")
            SectionTitle(stringResource(R.string.about_links))
            LinkRow(stringResource(R.string.about_privacy)) { onOpenUrl(AboutLinks.PRIVACY) }
            LinkRow(stringResource(R.string.about_terms)) { onOpenUrl(AboutLinks.TERMS) }
            LinkRow(stringResource(R.string.about_support)) { onOpenUrl(AboutLinks.SUPPORT) }
            SectionTitle(stringResource(R.string.about_licences))
            Text(stringResource(R.string.about_licences_body), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun LinkRow(label: String, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 12.dp),
    )
}
