package ai.whisperio.android.ui.common

import ai.whisperio.android.R
import ai.whisperio.android.settings.CustomCategory
import ai.whisperio.core.Categories
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** A category as the UI shows it: seeds (localised label, fixed colour and icon) or a custom one (spark icon, cycled hue). */
@Immutable
data class CategoryUi(val id: String, val label: String, val color: Color, val icon: ImageVector, val custom: Boolean)

@StringRes
fun seedLabelRes(id: String): Int = when (id) {
    "work" -> R.string.category_work
    "personal" -> R.string.category_personal
    "ideas" -> R.string.category_ideas
    "messages" -> R.string.category_messages
    "code" -> R.string.category_code
    else -> R.string.category_todo
}

/** iOS `Categories.swift` colours; `personal` is the theme amber. */
private fun seedColor(id: String): Color = when (id) {
    "work" -> Color(0xFF4A8CF7)
    "personal" -> Color(0xFFF59E0B)
    "ideas" -> Color(0xFFFBBF24)
    "messages" -> Color(0xFFF472B6)
    "code" -> Color(0xFFA78BFA)
    else -> Color(0xFF34D399)
}

private fun seedIcon(id: String): ImageVector = when (id) {
    "work" -> Icons.Outlined.Work
    "personal" -> Icons.Outlined.Person
    "ideas" -> Icons.Outlined.Lightbulb
    "messages" -> Icons.Outlined.Chat
    "code" -> Icons.Outlined.Code
    else -> Icons.Outlined.CheckCircle
}

/** Core hues are 0xRRGGBB; Compose wants opaque ARGB. */
fun customColor(hueIndex: Int): Color = Color(0xFF000000L or Categories.customHue(hueIndex))

fun customCategoryUi(c: CustomCategory) = CategoryUi(c.id, c.name, customColor(c.hueIndex), Icons.Outlined.AutoAwesome, custom = true)

/** Seeds first (iOS order), then the custom ones in creation order. */
@Composable
fun rememberCategoryOptions(customs: List<CustomCategory>): List<CategoryUi> {
    val seeds = Categories.SEED_IDS.map { id ->
        CategoryUi(id, stringResource(seedLabelRes(id)), seedColor(id), seedIcon(id), custom = false)
    }
    return seeds + customs.map(::customCategoryUi)
}

/** The display labels of the seeds in the current locale (for the D6 duplicate check). */
@Composable
fun seedLabels(): List<String> = Categories.SEED_IDS.map { stringResource(seedLabelRes(it)) }

/** Coloured dot + label shown on a row (D2: only when categorised). Announced as one "Category: X" node. */
@Composable
fun CategoryTag(category: CategoryUi, modifier: Modifier = Modifier) {
    val cd = stringResource(R.string.category_tag_cd, category.label)
    Row(modifier.clearAndSetSemantics { contentDescription = cd }, verticalAlignment = Alignment.CenterVertically) {
        Spacer(Modifier.size(8.dp).background(category.color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(
            category.label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
