package ai.whisperio.android

import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.ui.history.PendingDeleteController
import ai.whisperio.android.ui.history.PendingDeletePolicy
import ai.whisperio.android.ui.history.PendingDeleteState
import ai.whisperio.android.ui.history.PendingStep
import ai.whisperio.android.ui.history.canSwipeDelete
import ai.whisperio.android.ui.history.deletableInDay
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** CONTRACT-1.2 F5/F6: the pending-delete policy as a pure state machine, the controller on top of it, and the day filter. */
@OptIn(ExperimentalCoroutinesApi::class)
class PendingDeleteTest {
    private val none = PendingDeleteState()

    private fun rec(id: String, status: RecordingStatus = RecordingStatus.DONE, text: String? = "hello") = Recording(
        id = id, createdAt = 1_000, durationMs = 1_000, status = status, provider = "openai", model = "m",
        language = "auto", transcript = text, source = RecordingSource.APP,
    )

    // ---- pure policy ----

    @Test fun firstSwipeHidesWithoutCommitting() {
        val r = PendingDeletePolicy.swipe(none, "a")
        assertEquals("a", r.state.pendingId)
        assertNull(r.commit)
    }

    @Test fun secondSwipeCommitsTheFirstAtOnce() {
        val r = PendingDeletePolicy.swipe(PendingDeleteState("a"), "b")
        assertEquals("b", r.state.pendingId)
        assertEquals("a", r.commit)
    }

    @Test fun swipingTheSameIdAgainChangesNothing() {
        val r = PendingDeletePolicy.swipe(PendingDeleteState("a"), "a")
        assertEquals("a", r.state.pendingId)
        assertNull(r.commit)
    }

    @Test fun undoRestoresWithoutCommit() {
        val r = PendingDeletePolicy.undo(PendingDeleteState("a"), "a")
        assertNull(r.state.pendingId)
        assertNull(r.commit)
    }

    @Test fun undoOfAStaleIdKeepsTheCurrentPending() {
        val r = PendingDeletePolicy.undo(PendingDeleteState("b"), "a")
        assertEquals("b", r.state.pendingId)
        assertNull(r.commit)
    }

    @Test fun timeoutOrDismissCommits() {
        val r = PendingDeletePolicy.settle(PendingDeleteState("a"), "a")
        assertNull(r.state.pendingId)
        assertEquals("a", r.commit)
    }

    @Test fun staleTimeoutDoesNotCommitTheNewerPending() {
        // The snackbar of "a" reports Dismissed after "b" replaced it: "a" was already committed by the swipe.
        val r = PendingDeletePolicy.settle(PendingDeleteState("b"), "a")
        assertEquals("b", r.state.pendingId)
        assertNull(r.commit)
    }

    @Test fun timeoutWithNothingPendingIsANoOp() {
        val r = PendingDeletePolicy.settle(none, "a")
        assertEquals(none, r.state)
        assertNull(r.commit)
    }

    @Test fun flushCommitsWhateverIsPendingAndClears() {
        val r = PendingDeletePolicy.flush(PendingDeleteState("a"))
        assertNull(r.state.pendingId)
        assertEquals("a", r.commit)
        val empty = PendingDeletePolicy.flush(none)
        assertNull(empty.commit)
        assertEquals(none, empty.state)
    }

    @Test fun dropForgetsWithoutCommit() {
        val r = PendingDeletePolicy.drop(PendingDeleteState("a"))
        assertNull(r.state.pendingId)
        assertNull(r.commit)
    }

    @Test fun sequenceSwipeUndoSwipeCommitsNothingUntilFlush() {
        var s = none
        val commits = mutableListOf<String>()
        fun step(r: PendingStep) { s = r.state; r.commit?.let { commits.add(it) } }
        step(PendingDeletePolicy.swipe(s, "a"))
        step(PendingDeletePolicy.undo(s, "a"))
        step(PendingDeletePolicy.swipe(s, "b"))
        assertTrue(commits.isEmpty())
        step(PendingDeletePolicy.flush(s))
        assertEquals(listOf("b"), commits)
    }

    // ---- in-flight and day helpers ----

    @Test fun inFlightRowsCannotBeSwiped() {
        assertTrue(canSwipeDelete(rec("a")))
        assertTrue(canSwipeDelete(rec("a", RecordingStatus.FAILED)))
        assertFalse(canSwipeDelete(rec("a", RecordingStatus.RECORDING)))
        assertFalse(canSwipeDelete(rec("a", RecordingStatus.TRANSCRIBING)))
    }

    @Test fun deleteDaySkipsInFlightItems() {
        val day = listOf(rec("a"), rec("b", RecordingStatus.TRANSCRIBING), rec("c", RecordingStatus.FAILED), rec("d", RecordingStatus.RECORDING))
        assertEquals(listOf("a", "c"), deletableInDay(day).map { it.id })
        assertTrue(deletableInDay(listOf(rec("x", RecordingStatus.RECORDING))).isEmpty())
    }

    // ---- controller (commits run in the injected scope) ----

    private fun TestScope.fixture(vararg ids: String): Pair<FakeHistory, PendingDeleteController> {
        val history = FakeHistory()
        val c = PendingDeleteController(this, history)
        history.rows.value = ids.associateWith { rec(it) }
        return history to c
    }

    @Test fun swipeHidesButKeepsTheRowUntilCommit() = runTest(StandardTestDispatcher()) {
        val (h, c) = fixture("a")
        c.swipe("a")
        testScheduler.advanceUntilIdle()
        assertEquals("a", c.pendingId.value)
        assertTrue("a" in h.rows.value)
    }

    @Test fun secondSwipeDeletesTheFirstRow() = runTest(StandardTestDispatcher()) {
        val (h, c) = fixture("a", "b")
        c.swipe("a")
        c.swipe("b")
        testScheduler.advanceUntilIdle()
        assertEquals("b", c.pendingId.value)
        assertEquals(setOf("b"), h.rows.value.keys)
    }

    @Test fun undoKeepsTheRowForGood() = runTest(StandardTestDispatcher()) {
        val (h, c) = fixture("a")
        c.swipe("a")
        c.undo("a")
        c.settle("a")
        c.flush()
        testScheduler.advanceUntilIdle()
        assertNull(c.pendingId.value)
        assertEquals(setOf("a"), h.rows.value.keys)
    }

    @Test fun settleAndFlushDeleteThePending() = runTest(StandardTestDispatcher()) {
        val (h, c) = fixture("a", "b")
        c.swipe("a")
        c.settle("a")
        c.swipe("b")
        c.flush()
        testScheduler.advanceUntilIdle()
        assertTrue(h.rows.value.isEmpty())
        assertNull(c.pendingId.value)
    }

    @Test fun dropOnEraseAllDeletesNothingItself() = runTest(StandardTestDispatcher()) {
        val (h, c) = fixture("a")
        c.swipe("a")
        c.drop()
        testScheduler.advanceUntilIdle()
        assertNull(c.pendingId.value)
        assertEquals(setOf("a"), h.rows.value.keys) // history.clear() is the eraser, not drop()
    }

    @Test fun deleteDayFlushesThePendingFirstAndSkipsRowsThatWentInFlight() = runTest(StandardTestDispatcher()) {
        val (h, c) = fixture("p", "a", "b", "keep")
        c.swipe("p")
        h.rows.value = h.rows.value + ("b" to rec("b", RecordingStatus.TRANSCRIBING))
        c.deleteDay(listOf("a", "b"))
        testScheduler.advanceUntilIdle()
        assertNull(c.pendingId.value)
        assertEquals(setOf("b", "keep"), h.rows.value.keys)
    }
}
