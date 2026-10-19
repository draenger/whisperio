package ai.whisperio.android.ui.history

import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** CONTRACT-1.2 F5: at most one swiped-away row waits for its Undo window. */
data class PendingDeleteState(val pendingId: String? = null)

/** Result of one transition: the new [state] and the id (if any) that must be deleted for real now. */
data class PendingStep(val state: PendingDeleteState, val commit: String? = null)

/**
 * CONTRACT-1.2 F5 pending-delete policy as pure functions (no Android, no coroutines):
 * one pending item; a second swipe commits the first at once; Undo restores; the snackbar timing out or being dismissed
 * commits; flush (background, Erase all, selection, Delete a day, export) commits whatever is pending.
 * Events about an id that is no longer pending (a stale snackbar result) change nothing.
 */
object PendingDeletePolicy {
    fun swipe(s: PendingDeleteState, id: String): PendingStep = when (s.pendingId) {
        id -> PendingStep(s)
        else -> PendingStep(PendingDeleteState(id), commit = s.pendingId)
    }

    fun undo(s: PendingDeleteState, id: String): PendingStep =
        if (s.pendingId == id) PendingStep(PendingDeleteState()) else PendingStep(s)

    /** The snackbar for [id] timed out or was dismissed without Undo. */
    fun settle(s: PendingDeleteState, id: String): PendingStep =
        if (s.pendingId == id) PendingStep(PendingDeleteState(), commit = id) else PendingStep(s)

    fun flush(s: PendingDeleteState): PendingStep = PendingStep(PendingDeleteState(), commit = s.pendingId)

    /** Erase all data: the pending item goes with everything else, nothing to commit separately. */
    fun drop(@Suppress("UNUSED_PARAMETER") s: PendingDeleteState): PendingStep = PendingStep(PendingDeleteState())
}

/** Swipe (and the TalkBack "Delete" action) is off for an item that is still being recorded or transcribed. */
fun canSwipeDelete(rec: Recording): Boolean =
    rec.status != RecordingStatus.RECORDING && rec.status != RecordingStatus.TRANSCRIBING

/** CONTRACT-1.2 F6: what "Delete this day" removes from a day's (already filtered) rows: everything not in flight. */
fun deletableInDay(items: List<Recording>): List<Recording> = items.filter(::canSwipeDelete)

/**
 * App-level holder of the pending delete ([PendingDeletePolicy] applied under a lock). Commits (Room delete + audio
 * file) run in [scope] (the app scope, never cancelled with a screen). If the process dies before a commit the item
 * simply comes back (accepted, CONTRACT-1.2 F5).
 */
class PendingDeleteController(private val scope: CoroutineScope, private val history: HistoryStore) {
    private val lock = Any()
    private var state = PendingDeleteState()
    private val _pendingId = MutableStateFlow<String?>(null)

    /** The id hidden from History while its Undo window is open. */
    val pendingId: StateFlow<String?> get() = _pendingId

    private fun apply(step: (PendingDeleteState) -> PendingStep): Job? {
        val commit: String?
        synchronized(lock) {
            val r = step(state)
            state = r.state
            _pendingId.value = r.state.pendingId
            commit = r.commit
        }
        return commit?.let { id -> scope.launch { history.delete(id) } }
    }

    fun swipe(id: String): Job? = apply { PendingDeletePolicy.swipe(it, id) }
    fun undo(id: String) { apply { PendingDeletePolicy.undo(it, id) } }
    fun settle(id: String): Job? = apply { PendingDeletePolicy.settle(it, id) }
    fun flush(): Job? = apply { PendingDeletePolicy.flush(it) }
    fun drop() { apply { PendingDeletePolicy.drop(it) } }

    /** F6: flushes the pending item, then deletes [ids] (re-checked: a row that went in flight meanwhile is kept). */
    fun deleteDay(ids: List<String>): Job {
        flush()
        return scope.launch {
            ids.forEach { id ->
                val rec = history.get(id)
                if (rec != null && canSwipeDelete(rec)) history.delete(id)
            }
        }
    }
}
