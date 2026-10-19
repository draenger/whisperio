package ai.whisperio.android.ui.history

import ai.whisperio.android.R
import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.ui.home.sourceLabelRes
import ai.whisperio.core.ExportFormat
import ai.whisperio.core.ExportItem
import ai.whisperio.core.HistoryExport
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import java.io.IOException
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Maps history rows to the pure exporter's input; [label] resolves the localised source name. */
fun exportItems(rows: List<Recording>, label: (Recording) -> String): List<ExportItem> =
    rows.map { ExportItem(it.createdAt, label(it), it.provider, if (it.status == RecordingStatus.DONE) it.transcript else null) }

/**
 * CONTRACT-1.1 F6: returns a trigger that opens the system "create document" picker (SAF) and, once the user picked a
 * file, writes the export to that uri only. Rows are re-read by id after the picker returns, so nothing large has to
 * survive process death; the result is reported on [snackbar].
 */
@Composable
fun rememberExporter(history: HistoryStore, snackbar: SnackbarHostState): (List<Recording>, ExportFormat) -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pendingIds by rememberSaveable(stateSaver = IdsSaver) { mutableStateOf(emptyList<String>()) }
    var pendingFormat by rememberSaveable { mutableStateOf(ExportFormat.TXT.name) }

    fun onPicked(uri: Uri?) {
        if (uri == null) return
        val ids = pendingIds.toSet()
        val format = ExportFormat.valueOf(pendingFormat)
        scope.launch {
            val rows = history.observeAll().first().filter { it.id in ids }
            val result = HistoryExport.format(exportItems(rows) { ctx.getString(sourceLabelRes(it.source)) }, format, ZoneId.systemDefault())
            val message = try {
                withContext(Dispatchers.IO) { write(ctx, uri, result.content) }
                if (result.skipped == 0) ctx.getString(R.string.export_done, result.exported)
                else ctx.getString(R.string.export_done_skipped, result.exported, result.skipped)
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                ctx.getString(R.string.export_failed)
            } catch (e: SecurityException) {
                ctx.getString(R.string.export_failed)
            }
            snackbar.showSnackbar(message)
        }
    }

    val txt = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.TXT.mimeType)) { onPicked(it) }
    val md = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.MD.mimeType)) { onPicked(it) }

    return { rows, format ->
        val usable = rows.any { it.status == RecordingStatus.DONE && !it.transcript.isNullOrBlank() }
        if (!usable) {
            scope.launch { snackbar.showSnackbar(ctx.getString(R.string.export_nothing)) }
        } else {
            pendingIds = rows.map { it.id }
            pendingFormat = format.name
            val name = HistoryExport.fileName(format, System.currentTimeMillis(), ZoneId.systemDefault())
            (if (format == ExportFormat.TXT) txt else md).launch(name)
        }
    }
}

/** Truncating write to the uri the user picked; no storage permission involved. */
private fun write(ctx: Context, uri: Uri, content: String) {
    val out = ctx.contentResolver.openOutputStream(uri, "wt") ?: throw IOException("no output stream")
    out.use { it.write(content.toByteArray(Charsets.UTF_8)) }
}
