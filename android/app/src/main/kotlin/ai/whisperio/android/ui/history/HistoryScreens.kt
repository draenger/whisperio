package ai.whisperio.android.ui.history

import ai.whisperio.android.R
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.settings.CustomCategory
import ai.whisperio.android.ui.common.CategoryUi
import ai.whisperio.android.ui.common.SectionTitle
import ai.whisperio.android.ui.common.rememberCategoryOptions
import ai.whisperio.android.ui.home.sourceLabelRes
import ai.whisperio.android.ui.recap.RecapCard
import ai.whisperio.core.ExportFormat
import ai.whisperio.core.ProviderId
import ai.whisperio.core.wordCount
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Slider
import androidx.compose.ui.semantics.stateDescription
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.foundation.background
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import java.time.LocalDate
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.delay
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/** Saves a [HistoryFilters] across rotation (the debounced, applied value). */
private val FiltersSaver: Saver<HistoryFilters, Any> = listSaver(
    save = { listOf(it.query, it.failedOnly, it.sources.map { s -> s.name }, it.categories.toList()) },
    restore = { l ->
        HistoryFilters(
            l[0] as String,
            (l[2] as List<*>).map { RecordingSource.valueOf(it as String) }.toSet(),
            l[1] as Boolean,
            (l[3] as List<*>).map { it as String }.toSet(),
        )
    },
)

internal val IdsSaver: Saver<List<String>, Any> = listSaver(save = { it }, restore = { it })

/**
 * CONTRACT-1.1 F1-F3 + F6: search, source/failed chips, day headers and a selection mode with export. Filter and
 * selection state survive rotation. [now] and [zone] are injectable so snapshots stay deterministic; [initial] and
 * [initialSelection] seed the state (snapshots, tests).
 */
@Composable
fun HistoryListScreen(
    items: List<Recording>,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
    onExport: (List<Recording>, ExportFormat) -> Unit = { _, _ -> },
    now: Long = System.currentTimeMillis(),
    clearSelectionToken: Int = 0,
    zone: ZoneId = ZoneId.systemDefault(),
    initial: HistoryFilters = HistoryFilters(),
    initialSelection: Set<String> = emptySet(),
    /** CONTRACT-1.2 F3: the user's custom categories (seeds are built in). */
    customCategories: List<CustomCategory> = emptyList(),
    /** CONTRACT-1.2 F5: the swiped-away row waiting for Undo; hidden here only. */
    hiddenId: String? = null,
    onSwipeDelete: (String) -> Unit = {},
    onCopy: (String) -> Unit = {},
    /** CONTRACT-1.2 F6: ids to delete for "Delete this day" (already confirmed, filtered, in-flight skipped). */
    onDeleteDay: (List<String>) -> Unit = {},
    /** Entering selection mode flushes a pending delete (CONTRACT-1.2 F5). */
    onSelectionStart: () -> Unit = {},
    /** Seeds for snapshots: a day whose overflow menu / confirm dialog starts open. */
    initialMenuDay: LocalDate? = null,
    initialDeleteDay: LocalDate? = null,
    /** CONTRACT-1.2 F1: opens the Recap screen from the "This week" card. */
    onOpenRecap: () -> Unit = {},
) {
    var filters by rememberSaveable(stateSaver = FiltersSaver) { mutableStateOf(initial) }
    var input by rememberSaveable { mutableStateOf(initial.query) }
    var selected by rememberSaveable(stateSaver = IdsSaver) { mutableStateOf(initialSelection.toList()) }
    // CONTRACT-1.1 F1: 250 ms debounce between typing and filtering.
    LaunchedEffect(input) {
        if (input != filters.query) {
            delay(250)
            filters = filters.copy(query = input)
        }
    }
    val categoryOptions = rememberCategoryOptions(customCategories)
    val visibleItems = remember(items, hiddenId) { if (hiddenId == null) items else items.filter { it.id != hiddenId } }
    val shown = remember(visibleItems, filters, categoryOptions) {
        val labels = categoryOptions.associate { it.id to it.label }
        applyFilters(visibleItems, filters) { id -> labels[id] }
    }
    val picked = remember(visibleItems, selected) { visibleItems.filter { it.id in selected } }
    val selecting = picked.isNotEmpty()
    LaunchedEffect(selecting) { if (selecting) onSelectionStart() }
    var deleteDay by rememberSaveable { mutableStateOf(initialDeleteDay?.toEpochDay()) }
    // Back leaves selection mode first; a finished export (token bump from the route) also clears it.
    BackHandler(selecting) { selected = emptyList() }
    LaunchedEffect(clearSelectionToken) { if (clearSelectionToken > 0) selected = emptyList() }
    fun toggle(id: String) { selected = if (id in selected) selected - id else selected + id }

    Column(modifier.fillMaxSize()) {
        if (selecting) {
            SelectionBar(
                count = picked.size,
                matching = shown.size,
                onCancel = { selected = emptyList() },
                onSelectAll = { selected = shown.map { it.id } },
                onExport = { onExport(picked, it) },
            )
        } else {
            TopAppBar(title = { Text(stringResource(R.string.nav_history)) })
        }
        if (visibleItems.isEmpty()) {
            Text(
                stringResource(R.string.history_empty),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(20.dp),
            )
            return@Column
        }
        if (!selecting) {
            SearchAndChips(
                input = input,
                onInput = { input = it },
                filters = filters,
                onFilters = { filters = it },
                categoryOptions = categoryOptions,
            )
        }
        if (shown.isEmpty()) {
            Text(
                stringResource(R.string.history_no_results),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            TextButton(
                onClick = { input = ""; filters = HistoryFilters() },
                modifier = Modifier.padding(horizontal = 12.dp).heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.history_clear_filters)) }
        } else {
            val groups = remember(shown, now, zone) { groupByDay(shown, now, zone) }
            LazyColumn(Modifier.fillMaxSize()) {
                // Hidden while selecting; visibleItems already excludes the pending-delete row.
                if (!selecting) item(key = "recap") { RecapCard(visibleItems, now, zone, onOpenRecap) }
                groups.forEach { g ->
                    item(key = "day-${g.date}") {
                        DayHeader(
                            title = dayTitle(g),
                            menuEnabled = !selecting,
                            canDelete = deletableInDay(g.items).isNotEmpty(),
                            onDelete = { deleteDay = g.date.toEpochDay() },
                            initialMenuOpen = initialMenuDay == g.date,
                        )
                    }
                    items(g.items, key = { it.id }) { rec ->
                        val text = rec.transcript?.takeIf { rec.status == RecordingStatus.DONE && it.isNotBlank() }
                        val swipeable = !selecting && canSwipeDelete(rec)
                        val deleteLabel = stringResource(R.string.row_swipe_delete)
                        val copyLabel = stringResource(R.string.action_copy)
                        val actions = buildList {
                            if (swipeable) add(CustomAccessibilityAction(deleteLabel) { onSwipeDelete(rec.id); true })
                            if (!selecting && text != null) add(CustomAccessibilityAction(copyLabel) { onCopy(text); true })
                        }
                        SwipeDeleteRow(enabled = swipeable, onDelete = { onSwipeDelete(rec.id) }) {
                            RecordingRow(
                                rec,
                                onClick = { if (selecting) toggle(rec.id) else onOpen(rec.id) },
                                selected = if (selecting) rec.id in selected else null,
                                onLongClick = if (selecting) null else ({ toggle(rec.id) }),
                                onDoubleClick = if (selecting || text == null) null else ({ onCopy(text) }),
                                customActions = actions,
                                category = rec.category?.let { id -> categoryOptions.firstOrNull { it.id == id } },
                            )
                        }
                    }
                }
            }
            val dayGroup = deleteDay?.let { d -> groups.firstOrNull { it.date.toEpochDay() == d } }
            if (dayGroup != null) {
                val doomed = deletableInDay(dayGroup.items)
                val dayLabel = dayTitle(dayGroup)
                // Nothing left to delete (rows finished or were removed while the dialog was open): close it.
                LaunchedEffect(doomed.isEmpty()) { if (doomed.isEmpty()) deleteDay = null }
                if (doomed.isNotEmpty()) {
                    AlertDialog(
                        onDismissRequest = { deleteDay = null },
                        title = { Text(stringResource(R.string.day_delete_title)) },
                        text = {
                            Text(
                                when (dayGroup.kind) {
                                    DayKind.TODAY -> pluralStringResource(
                                        if (filters.active) R.plurals.day_delete_body_today_filtered else R.plurals.day_delete_body_today,
                                        doomed.size, doomed.size,
                                    )
                                    DayKind.YESTERDAY -> pluralStringResource(
                                        if (filters.active) R.plurals.day_delete_body_yesterday_filtered else R.plurals.day_delete_body_yesterday,
                                        doomed.size, doomed.size,
                                    )
                                    DayKind.DATE -> pluralStringResource(
                                        if (filters.active) R.plurals.day_delete_body_filtered else R.plurals.day_delete_body,
                                        doomed.size, doomed.size, dayLabel,
                                    )
                                },
                            )
                        },
                        confirmButton = {
                            TextButton(onClick = { deleteDay = null; onDeleteDay(doomed.map { it.id }) }) {
                                Text(stringResource(R.string.action_delete))
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { deleteDay = null }) { Text(stringResource(R.string.action_cancel)) }
                        },
                    )
                }
            }
        }
    }
}

/** Day title plus the "Delete this day" overflow (CONTRACT-1.2 F6); the menu is hidden in selection mode. */
@Composable
private fun DayHeader(title: String, menuEnabled: Boolean, canDelete: Boolean, onDelete: () -> Unit, initialMenuOpen: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        SectionTitle(title, Modifier.weight(1f))
        if (menuEnabled) {
            var open by rememberSaveable { mutableStateOf(initialMenuOpen) }
            Box {
                IconButton(onClick = { open = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.day_menu, title))
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.day_delete)) },
                        enabled = canDelete,
                        onClick = { open = false; onDelete() },
                    )
                }
            }
        }
    }
}

/** End-to-start swipe removes the row (CONTRACT-1.2 F5, D3); the caller shows the "Deleted / Undo" snackbar. */
@Composable
private fun SwipeDeleteRow(enabled: Boolean, onDelete: () -> Unit, content: @Composable () -> Unit) {
    val latest by rememberUpdatedState(onDelete)
    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = { target ->
            if (target == SwipeToDismissBoxValue.EndToStart) { latest(); true } else false
        },
    )
    SwipeToDismissBox(
        state = state,
        backgroundContent = { SwipeDeleteBackdrop() },
        enableDismissFromStartToEnd = false,
        enableDismissFromEndToStart = enabled,
    ) { content() }
}

/** What the swipe reveals behind the row: error container with the delete icon at the trailing edge. */
@Composable
internal fun SwipeDeleteBackdrop(modifier: Modifier = Modifier) {
    Box(
        modifier.fillMaxSize().background(MaterialTheme.colorScheme.errorContainer).padding(horizontal = 20.dp),
        contentAlignment = Alignment.CenterEnd,
    ) {
        Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
    }
}

@Composable
private fun dayTitle(g: DayGroup): String = when (g.kind) {
    DayKind.TODAY -> stringResource(R.string.day_today)
    DayKind.YESTERDAY -> stringResource(R.string.day_yesterday)
    DayKind.DATE -> DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()).format(g.date)
}

@Composable
private fun SearchAndChips(
    input: String,
    onInput: (String) -> Unit,
    filters: HistoryFilters,
    onFilters: (HistoryFilters) -> Unit,
    categoryOptions: List<CategoryUi>,
) {
    val focus = LocalFocusManager.current
    OutlinedTextField(
        value = input,
        onValueChange = onInput,
        label = { Text(stringResource(R.string.history_search_label)) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = if (input.isEmpty()) null else {
            {
                IconButton(onClick = { onInput("") }) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.history_search_clear))
                }
            }
        },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
    )
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val failed = stringResource(R.string.filter_failed)
        val failedCd = stringResource(R.string.filter_only, failed)
        FilterChip(
            selected = filters.failedOnly,
            onClick = { onFilters(filters.copy(failedOnly = !filters.failedOnly)) },
            label = { Text(failed) },
            modifier = Modifier.semantics { contentDescription = failedCd },
        )
        RecordingSource.entries.forEach { src ->
            val label = stringResource(sourceLabelRes(src))
            val cd = stringResource(R.string.filter_only, label)
            FilterChip(
                selected = src in filters.sources,
                onClick = {
                    onFilters(filters.copy(sources = if (src in filters.sources) filters.sources - src else filters.sources + src))
                },
                label = { Text(label) },
                modifier = Modifier.semantics { contentDescription = cd },
            )
        }
    }
    // CONTRACT-1.2 F3: category chips (multi-select, "None" included); AND-combined with search and the chips above.
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        fun toggleCategory(id: String) {
            onFilters(filters.copy(categories = if (id in filters.categories) filters.categories - id else filters.categories + id))
        }
        val none = stringResource(R.string.category_none)
        val noneCd = stringResource(R.string.filter_only, none)
        FilterChip(
            selected = HistoryFilters.NO_CATEGORY in filters.categories,
            onClick = { toggleCategory(HistoryFilters.NO_CATEGORY) },
            label = { Text(none) },
            modifier = Modifier.semantics { contentDescription = noneCd },
        )
        categoryOptions.forEach { c ->
            val cd = stringResource(R.string.filter_only, c.label)
            FilterChip(
                selected = c.id in filters.categories,
                onClick = { toggleCategory(c.id) },
                label = { Text(c.label) },
                leadingIcon = { Icon(c.icon, contentDescription = null, tint = c.color) },
                modifier = Modifier.semantics { contentDescription = cd },
            )
        }
    }
}

/** Replaces the app bar while rows are selected: count, cancel, "select all matching" and the export format menu. */
@Composable
private fun SelectionBar(
    count: Int,
    matching: Int,
    onCancel: () -> Unit,
    onSelectAll: () -> Unit,
    onExport: (ExportFormat) -> Unit,
) {
    TopAppBar(
        title = { Text(stringResource(R.string.select_count, count)) },
        navigationIcon = {
            IconButton(onClick = onCancel) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.select_cancel))
            }
        },
        actions = {
            IconButton(onClick = onSelectAll) {
                Icon(Icons.Filled.SelectAll, contentDescription = stringResource(R.string.select_all, matching))
            }
            var open by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { open = true }) {
                    Icon(Icons.Filled.Save, contentDescription = stringResource(R.string.action_export))
                }
                ExportMenu(open, { open = false }, onExport)
            }
        },
    )
}

/** The `.txt` / `.md` choice; the SAF picker itself is launched by the caller. */
@Composable
private fun ExportMenu(open: Boolean, onDismiss: () -> Unit, onExport: (ExportFormat) -> Unit) {
    DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
        DropdownMenuItem(text = { Text(stringResource(R.string.export_txt)) }, onClick = { onDismiss(); onExport(ExportFormat.TXT) })
        DropdownMenuItem(text = { Text(stringResource(R.string.export_md)) }, onClick = { onDismiss(); onExport(ExportFormat.MD) })
    }
}

@Composable
private fun AudioPlayerRow(player: PlayerUi) {
    val position = formatElapsed(player.positionMs.toLong())
    val duration = formatElapsed(player.durationMs.toLong())
    val stateText = stringResource(R.string.player_state, position, duration)
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            IconButton(onClick = player.onToggle, enabled = player.enabled, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(
                    if (player.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = stringResource(if (player.playing) R.string.player_pause else R.string.player_play),
                )
            }
            val max = player.durationMs.coerceAtLeast(1).toFloat()
            val seekLabel = stringResource(R.string.player_position)
            Slider(
                value = player.positionMs.toFloat().coerceIn(0f, max),
                onValueChange = { player.onSeek(it.toInt()) },
                valueRange = 0f..max,
                enabled = player.enabled,
                modifier = Modifier.weight(1f).semantics {
                    contentDescription = seekLabel
                    stateDescription = stateText
                },
            )
            Text(
                "$position / $duration",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
        if (!player.enabled) {
            Text(
                stringResource(R.string.player_disabled_recording),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The detail "Category" menu: None, seeds, customs; the current one carries a check mark. */
@Composable
private fun CategoryControl(rec: Recording, options: List<CategoryUi>, initialOpen: Boolean, actions: HistoryDetailActions) {
    var menuOpen by rememberSaveable { mutableStateOf(initialOpen) }
    val current = options.firstOrNull { it.id == rec.category }
    val none = stringResource(R.string.category_none)
    val button = stringResource(R.string.category_button, current?.label ?: none)
    val buttonCd = stringResource(R.string.category_button_cd, current?.label ?: none)
    val selectedCd = stringResource(R.string.category_selected)
    Box(Modifier.padding(top = 12.dp)) {
        OutlinedButton(
            onClick = { menuOpen = true },
            modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = buttonCd },
        ) {
            if (current != null) Icon(current.icon, null, Modifier.padding(end = 8.dp), tint = current.color)
            Text(button)
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text(none) },
                trailingIcon = if (current == null) ({ Icon(Icons.Filled.Check, contentDescription = selectedCd) }) else null,
                onClick = { menuOpen = false; actions.onSetCategory(rec.id, null) },
            )
            options.forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.label) },
                    leadingIcon = { Icon(c.icon, contentDescription = null, tint = c.color) },
                    trailingIcon = if (c.id == rec.category) ({ Icon(Icons.Filled.Check, contentDescription = selectedCd) }) else null,
                    onClick = { menuOpen = false; actions.onSetCategory(rec.id, c.id) },
                )
            }
        }
    }
}

@Composable
private fun RetryWithControl(rec: Recording, ui: RetryWithUi, initialOpen: Boolean, actions: HistoryDetailActions) {
    var menuOpen by rememberSaveable { mutableStateOf(initialOpen) }
    val enabled = ui.audioAvailable && ui.choices.isNotEmpty() && !ui.busy
    Box(Modifier.padding(top = 12.dp)) {
        OutlinedButton(onClick = { menuOpen = true }, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) {
            Icon(Icons.Filled.Refresh, null, Modifier.padding(end = 8.dp))
            Text(stringResource(if (ui.retrying) R.string.retry_with_busy else R.string.action_retry_with))
        }
        DropdownMenu(expanded = menuOpen && enabled, onDismissRequest = { menuOpen = false }) {
            ui.choices.forEach { c ->
                DropdownMenuItem(
                    text = { Text("${c.label} - ${c.model}") },
                    onClick = { menuOpen = false; actions.onRetryWith(rec.id, c.id) },
                )
            }
        }
    }
    val reason = when {
        !ui.audioAvailable -> R.string.error_no_audio
        ui.choices.isEmpty() -> R.string.retry_with_none
        else -> null
    }
    if (reason != null) {
        Text(
            stringResource(reason),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

interface HistoryDetailActions {
    fun onBack() {}
    fun onCopy(text: String) {}
    fun onShare(text: String) {}
    fun onRetry(id: String) {}
    fun onRetryWith(id: String, provider: ProviderId) {}
    fun onDelete(id: String) {}
    fun onExport(rec: Recording, format: ExportFormat) {}

    /** CONTRACT-1.2 F3: [category] null = none. */
    fun onSetCategory(id: String, category: String?) {}
}

/** CONTRACT-1.1 F4: the kept-audio player; null on the screen means no player (file gone). */
data class PlayerUi(
    val playing: Boolean,
    val positionMs: Int,
    val durationMs: Int,
    /** False while the dictation controller is recording: shown with a reason, play disabled. */
    val enabled: Boolean,
    val onToggle: () -> Unit,
    val onSeek: (Int) -> Unit,
)

/** One provider offered in the "Retry with..." menu. */
data class RetryChoiceUi(val id: ProviderId, val label: String, val model: String)

/** CONTRACT-1.1 F5: state of the "Retry with..." control. */
data class RetryWithUi(
    val choices: List<RetryChoiceUi>,
    val audioAvailable: Boolean,
    /** A recording or transcription is in flight (this or another one): the control is disabled. */
    val busy: Boolean = false,
    /** This very entry is being re-transcribed. */
    val retrying: Boolean = false,
)

@Composable
fun HistoryDetailScreen(
    rec: Recording?,
    actions: HistoryDetailActions,
    modifier: Modifier = Modifier,
    player: PlayerUi? = null,
    retryWith: RetryWithUi? = null,
    initialRetryMenuOpen: Boolean = false,
    customCategories: List<CustomCategory> = emptyList(),
    initialCategoryMenuOpen: Boolean = false,
) {
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
                    IconButton(onClick = { confirmDelete = true }, enabled = retryWith?.retrying != true) {
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
            val words = remember(text) { wordCount(text) }
            val wordCountSuffix = if (words > 0) " · ${pluralStringResource(R.plurals.history_word_count, words, words)}" else ""
            Text(
                "${stringResource(sourceLabelRes(rec.source))} · ${formatDateTime(rec.createdAt)} · ${formatElapsed(rec.durationMs)}$wordCountSuffix",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            if (player != null) AudioPlayerRow(player)
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
            if (rec.status == RecordingStatus.DONE && text != null) {
                var exportOpen by remember { mutableStateOf(false) }
                Box(Modifier.padding(top = 8.dp)) {
                    OutlinedButton(onClick = { exportOpen = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Icon(Icons.Filled.Save, null, Modifier.padding(end = 8.dp))
                        Text(stringResource(R.string.action_export))
                    }
                    ExportMenu(exportOpen, { exportOpen = false }) { actions.onExport(rec, it) }
                }
            }
            if (rec.audioPath != null && rec.status != RecordingStatus.TRANSCRIBING && rec.status != RecordingStatus.RECORDING) {
                OutlinedButton(onClick = { actions.onRetry(rec.id) }, modifier = Modifier.padding(top = 12.dp).heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.Refresh, null, Modifier.padding(end = 8.dp))
                    Text(stringResource(R.string.action_retry))
                }
            }
            // Hidden while RECORDING / TRANSCRIBING (CONTRACT-1.2 F3).
            if (rec.status == RecordingStatus.DONE || rec.status == RecordingStatus.FAILED) {
                CategoryControl(rec, rememberCategoryOptions(customCategories), initialCategoryMenuOpen, actions)
            }
            if (retryWith != null && (rec.status == RecordingStatus.DONE || rec.status == RecordingStatus.FAILED)) {
                RetryWithControl(rec, retryWith, initialRetryMenuOpen, actions)
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
