package ai.whisperio.android.ui.onboarding

import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.history.RecordingSource

/**
 * Onboarding step 7 ("try it") shares the app-wide dictation controller with the keyboard, the tile and Home. These pure
 * helpers keep the try-it session from touching - or leaking into - anything it did not start.
 *
 * [active] = the try-it mic started the current dictation. [pendingAck] = the user left onboarding while it was still
 * transcribing, so its Done/Error must be acknowledged silently when it lands (never shown on Home).
 */
internal data class TryItSession(val active: Boolean = false, val pendingAck: Boolean = false)

internal enum class TryItCommand { NONE, CANCEL, ACKNOWLEDGE }

internal data class TryItLeave(val command: TryItCommand, val session: TryItSession)

private fun DictationState.isApp(): Boolean = when (this) {
    is DictationState.Recording -> source == RecordingSource.APP
    is DictationState.Transcribing -> source == RecordingSource.APP
    is DictationState.Done -> source == RecordingSource.APP
    else -> false
}

/** What step 7 renders: the controller state only for the try-it's own APP session, otherwise Idle. */
internal fun tryItView(s: DictationState, t: TryItSession): DictationState = when {
    !t.active -> DictationState.Idle
    s is DictationState.Error -> s // errors carry no source; the active flag is the ownership proof
    s.isApp() -> s
    else -> DictationState.Idle
}

/** Finish / Back from step 7. */
internal fun tryItLeave(s: DictationState, t: TryItSession): TryItLeave {
    if (!t.active) return TryItLeave(TryItCommand.NONE, t)
    return when {
        s is DictationState.Recording && s.source == RecordingSource.APP -> TryItLeave(TryItCommand.CANCEL, TryItSession())
        s is DictationState.Transcribing && s.source == RecordingSource.APP ->
            TryItLeave(TryItCommand.NONE, TryItSession(active = false, pendingAck = true))
        s is DictationState.Done && s.source == RecordingSource.APP -> TryItLeave(TryItCommand.ACKNOWLEDGE, TryItSession())
        s is DictationState.Error -> TryItLeave(TryItCommand.ACKNOWLEDGE, TryItSession())
        else -> TryItLeave(TryItCommand.NONE, TryItSession())
    }
}

/** True when an abandoned (left-while-transcribing) try-it has now finished and its result must be dropped. */
internal fun tryItShouldAck(s: DictationState, t: TryItSession): Boolean =
    t.pendingAck && (s is DictationState.Error || (s is DictationState.Done && s.source == RecordingSource.APP))

/** Stop only ends a recording the try-it itself started. */
internal fun tryItCanStop(s: DictationState, t: TryItSession): Boolean = tryItView(s, t) is DictationState.Recording
