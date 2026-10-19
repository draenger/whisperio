package ai.whisperio.android

import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ui.onboarding.TryItCommand
import ai.whisperio.android.ui.onboarding.TryItSession
import ai.whisperio.android.ui.onboarding.tryItCanStop
import ai.whisperio.android.ui.onboarding.tryItLeave
import ai.whisperio.android.ui.onboarding.tryItPendingStale
import ai.whisperio.android.ui.onboarding.tryItShouldAck
import ai.whisperio.android.ui.onboarding.tryItView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TryItPolicyTest {
    private val active = TryItSession(active = true)
    private fun rec(src: RecordingSource = RecordingSource.APP) = DictationState.Recording(0f, 0, false, src)
    private val transcribing = DictationState.Transcribing(RecordingSource.APP)
    private val done = DictationState.Done("hi", "r1", RecordingSource.APP)
    private val error = DictationState.Error(DictationError.PROVIDER, "x")

    @Test fun finishWhileRecordingCancels() {
        val l = tryItLeave(rec(), active)
        assertEquals(TryItCommand.CANCEL, l.command)
        assertEquals(TryItSession(), l.session)
    }

    @Test fun finishWhileTranscribingMarksPendingAckAndDoesNothingNow() {
        val l = tryItLeave(transcribing, active)
        assertEquals(TryItCommand.NONE, l.command)
        assertEquals(TryItSession(active = false, pendingAck = true), l.session)
    }

    @Test fun finishWhileDoneOrErrorAcknowledges() {
        assertEquals(TryItCommand.ACKNOWLEDGE, tryItLeave(done, active).command)
        assertEquals(TryItCommand.ACKNOWLEDGE, tryItLeave(error, active).command)
        assertEquals(TryItSession(), tryItLeave(done, active).session)
    }

    @Test fun finishWhenIdleDoesNothing() {
        val l = tryItLeave(DictationState.Idle, active)
        assertEquals(TryItCommand.NONE, l.command)
        assertEquals(TryItSession(), l.session)
    }

    @Test fun leavingNeverTouchesSessionsTheTryItDidNotStart() {
        val inactive = TryItSession()
        assertEquals(TryItCommand.NONE, tryItLeave(rec(RecordingSource.KEYBOARD), inactive).command)
        assertEquals(TryItCommand.NONE, tryItLeave(done, inactive).command)
        assertEquals(TryItCommand.NONE, tryItLeave(error, inactive).command)
        // active but the live recording belongs to the keyboard/tile: not cancelled
        assertEquals(TryItCommand.NONE, tryItLeave(rec(RecordingSource.TILE), active).command)
    }

    @Test fun abandonedTranscriptionIsAckedWhenItLands() {
        val pending = TryItSession(pendingAck = true)
        assertFalse(tryItShouldAck(transcribing, pending))
        assertFalse(tryItShouldAck(DictationState.Idle, pending))
        assertTrue(tryItShouldAck(done, pending))
        assertTrue(tryItShouldAck(error, pending))
        assertFalse(tryItShouldAck(done, TryItSession()))
        assertFalse(tryItShouldAck(done.copy(source = RecordingSource.KEYBOARD), pending))
    }

    @Test fun viewShowsOnlyTheOwnAppSession() {
        assertEquals(done, tryItView(done, active))
        assertEquals(transcribing, tryItView(transcribing, active))
        assertEquals(error, tryItView(error, active))
        assertEquals(DictationState.Idle, tryItView(done, TryItSession()))
        assertEquals(DictationState.Idle, tryItView(rec(RecordingSource.KEYBOARD), active))
        assertEquals(DictationState.Idle, tryItView(rec(RecordingSource.TILE), active))
    }

    @Test fun stopOnlyEndsOwnRecording() {
        assertTrue(tryItCanStop(rec(), active))
        assertFalse(tryItCanStop(rec(RecordingSource.KEYBOARD), active))
        assertFalse(tryItCanStop(rec(), TryItSession()))
    }

    @Test fun pendingAckIsStaleOnceControllerIsIdleOrRecording() {
        val pending = TryItSession(pendingAck = true)
        assertTrue(tryItPendingStale(DictationState.Idle, pending))
        for (src in RecordingSource.values()) assertTrue(tryItPendingStale(rec(src), pending))
    }

    @Test fun pendingAckSurvivesTranscribingAndTheAckPath() {
        val pending = TryItSession(pendingAck = true)
        assertFalse(tryItPendingStale(transcribing, pending))
        assertFalse(tryItPendingStale(done, pending))
        assertFalse(tryItPendingStale(error, pending))
        // leave-while-transcribing yields a session that is not stale in the very state it was left in
        assertFalse(tryItPendingStale(transcribing, tryItLeave(transcribing, active).session))
    }

    @Test fun noPendingAckIsNeverStale() {
        assertFalse(tryItPendingStale(DictationState.Idle, TryItSession()))
        assertFalse(tryItPendingStale(rec(), active))
    }

    @Test fun clearedStaleFlagDoesNotSwallowALaterDone() {
        var session = TryItSession(pendingAck = true)
        if (tryItPendingStale(DictationState.Idle, session)) session = session.copy(pendingAck = false)
        assertFalse(tryItShouldAck(DictationState.Done("home", "r2", RecordingSource.APP), session))
    }
}
