package ai.whisperio.android.ui.recap

import ai.whisperio.android.R
import ai.whisperio.android.history.Recording
import ai.whisperio.core.Recap
import ai.whisperio.core.RecapStats
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.ZoneId

/**
 * CONTRACT-1.2 F1: the "This week" card for the top of History. Computes the recap from [items] and renders nothing
 * when the week has no item with text. Tap opens the Recap screen.
 */
@Composable
fun RecapCard(
    items: List<Recording>,
    now: Long,
    zone: ZoneId,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val stats = remember(items, now, zone) { Recap.compute(items.toRecapItems(), now, zone) }
    RecapCard(stats, onClick, modifier)
}

/** Stateless card (snapshots, tests). Hidden when [stats] has no notes. */
@Composable
fun RecapCard(stats: RecapStats, onClick: () -> Unit, modifier: Modifier = Modifier) {
    if (stats.isEmpty) return
    val t = rememberRecapText()
    val words = t.words(stats.words)
    val notes = t.notes(stats.notes)
    val saved = t.minutes(stats.minutesSaved)
    val cd = stringResource(R.string.recap_card_cd, words, notes, saved)
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).semantics { contentDescription = cd },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    stringResource(R.string.recap_card_title),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Text(
                    stringResource(R.string.recap_card_summary, words, notes),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Text(
                    stringResource(R.string.recap_card_saved, saved),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
        }
    }
}
