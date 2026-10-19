package ai.whisperio.android.ui.recap

import ai.whisperio.android.R
import ai.whisperio.android.ui.common.KeyValueRow
import ai.whisperio.android.ui.common.SectionTitle
import ai.whisperio.core.RecapStats
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.DayOfWeek
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.max

@Composable
fun rememberRecapText(): RecapText {
    val config = LocalConfiguration.current // re-created when the locale changes
    val res = LocalContext.current.resources
    return remember(config, res) { RecapText(res) }
}

/**
 * CONTRACT-1.2 F1 weekly recap. Stateless: [stats] comes from `Recap.compute`. [categoryLabel] maps a non-null category
 * id to its label (lane K plugs in the real labels; the default shows the id); null is always "None".
 * [providerLabel] maps the stored provider id to a display name.
 */
@Composable
fun RecapScreen(
    stats: RecapStats,
    onBack: () -> Unit,
    onShare: () -> Unit,
    modifier: Modifier = Modifier,
    sharing: Boolean = false,
    categoryLabel: (String) -> String = { it },
    providerLabel: (String) -> String = { it },
) {
    val t = rememberRecapText()
    Column(modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.recap_title)) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                }
            },
            actions = {
                IconButton(onClick = onShare, enabled = !sharing && !stats.isEmpty) {
                    Icon(Icons.Filled.Share, contentDescription = stringResource(R.string.recap_share))
                }
            },
        )
        if (stats.isEmpty) {
            Text(
                stringResource(R.string.recap_empty),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(20.dp),
            )
            return@Column
        }
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                t.weekLabel(stats),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Hero(t.num(stats.minutesSaved), t.savedCaption(stats.minutesSaved))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(t.num(stats.words), stringResource(R.string.recap_tile_words), Modifier.weight(1f))
                StatTile(t.num(stats.notes), stringResource(R.string.recap_tile_notes), Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(t.wpm(stats), stringResource(R.string.recap_tile_wpm), Modifier.weight(1f))
                StatTile(
                    t.num(stats.streakCurrent), stringResource(R.string.recap_tile_streak), Modifier.weight(1f),
                    sub = stringResource(R.string.recap_tile_best, t.days(stats.streakBest)),
                )
            }

            SectionTitle(stringResource(R.string.recap_words_per_day))
            WordsPerDayChart(stats.wordsPerDay, t)

            stats.noteOfWeek?.let { note ->
                SectionTitle(stringResource(R.string.recap_note_title))
                Card(
                    Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            note.transcript.orEmpty(),
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 5,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            t.words(stats.noteOfWeekWords),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            if (stats.categories.isNotEmpty()) {
                SectionTitle(stringResource(R.string.recap_categories))
                val none = stringResource(R.string.recap_category_none)
                stats.categories.forEach { c ->
                    val label = c.category?.let(categoryLabel) ?: none
                    val value = t.notes(c.notes)
                    Column(
                        Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
                    ) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                            Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        LinearProgressIndicator(
                            progress = { c.notes / stats.notes.toFloat() },
                            modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp),
                        )
                    }
                }
            }

            if (stats.providers.isNotEmpty()) {
                SectionTitle(stringResource(R.string.recap_providers))
                stats.providers.forEach { p -> KeyValueRow(providerLabel(p.provider), t.minutesShort(p.minutes)) }
            }
        }
    }
}

@Composable
private fun Hero(value: String, caption: String) {
    Card(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.displayLarge)
            Text(caption, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier, sub: String? = null) {
    Card(
        modifier.semantics(mergeDescendants = true) {},
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(value, style = MaterialTheme.typography.headlineMedium)
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (sub != null) Text(sub, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
    }
}

/** Mon..Sun bars drawn with Canvas (no chart dependency); TalkBack gets one summary instead of seven unlabeled bars. */
@Composable
private fun WordsPerDayChart(values: List<Int>, t: RecapText, modifier: Modifier = Modifier) {
    val locale = Locale.getDefault()
    val days = DayOfWeek.values().toList()
    val res = LocalContext.current.resources
    val letters = days.map { it.getDisplayName(TextStyle.NARROW_STANDALONE, locale) }
    val spoken = days.indices.joinToString(", ") { i ->
        res.getString(R.string.recap_chart_item, days[i].getDisplayName(TextStyle.FULL_STANDALONE, locale), t.words(values.getOrElse(i) { 0 }))
    }
    val cd = stringResource(R.string.recap_chart_cd, spoken)
    val bar = MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.surfaceVariant
    val peak = max(1, values.maxOrNull() ?: 0)
    Column(modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = cd }) {
        Canvas(Modifier.fillMaxWidth().height(120.dp)) {
            val slot = size.width / 7f
            val barW = slot * 0.5f
            val radius = CornerRadius(barW / 4f)
            for (i in 0 until 7) {
                val x = i * slot + (slot - barW) / 2f
                drawRoundRect(track, Offset(x, 0f), Size(barW, size.height), radius)
                val v = values.getOrElse(i) { 0 }
                if (v > 0) {
                    val h = max(size.height * v / peak, 4.dp.toPx())
                    drawRoundRect(bar, Offset(x, size.height - h), Size(barW, h), radius)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            letters.forEach {
                Text(
                    it,
                    Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
