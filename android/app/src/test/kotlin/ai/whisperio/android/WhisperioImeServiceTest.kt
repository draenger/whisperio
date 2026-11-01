package ai.whisperio.android

import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.dictation.DictationResult
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.di.TextTidy
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ime.FieldKey
import ai.whisperio.android.ime.InputSession
import ai.whisperio.android.ime.InputSessionCounter
import ai.whisperio.android.ime.stopKeyboardRecordingIfNeeded
import ai.whisperio.android.ime.commitKeyboardResult
import ai.whisperio.android.ime.keyboardStartOptions
import ai.whisperio.android.ime.shouldStopKeyboardRecording
import android.text.InputType
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * IME glue (CONTRACT 5). The service itself needs a real WhisperioApp/AppGraph (Keystore), which the JVM lacks, so the
 * decisions it delegates to (session counter, cancel-on-hide, commit-or-not, password mic) are internal functions in
 * WhisperioImeService.kt and are driven here with a recording InputConnection and the real DictationController.
 */
@RunWith(RobolectricTestRunner::class)
@OptIn(ExperimentalCoroutinesApi::class)
class WhisperioImeServiceTest {
    @get:Rule val tmp = TemporaryFolder()

    private class RecordingConnection(var before: CharSequence? = "x") :
        BaseInputConnection(View(ApplicationProvider.getApplicationContext<android.app.Application>()), false) {
        val committed = mutableListOf<String>()
        override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
            committed += text.toString()
            return true
        }
        override fun getTextBeforeCursor(n: Int, flags: Int): CharSequence? = before
    }

    private fun info(inputType: Int = InputType.TYPE_CLASS_TEXT, id: Int = 7) = EditorInfo().apply {
        this.inputType = inputType
        fieldId = id
        packageName = "com.example"
    }

    private val key = FieldKey(7, "com.example")
    private fun session(counter: Long) = InputSession(counter, key)
    private fun result(counter: Long, id: String? = "r1", source: RecordingSource = RecordingSource.KEYBOARD) =
        DictationResult(id, "hello", source, session(counter))

    private class Outcome {
        val inserted = mutableListOf<String>()
        var acks = 0
    }

    private fun commit(
        res: DictationResult,
        ic: RecordingConnection?,
        info: EditorInfo?,
        current: InputSession,
        shown: Boolean,
        out: Outcome,
    ) = commitKeyboardResult(res, ic, info, current, shown, { out.inserted += it }, { out.acks++ })

    @Test fun startAndFinishInputBumpCounterButRestartDoesNot() {
        val c = InputSessionCounter()
        c.onStartInput(restarting = false)
        assertEquals(1L, c.value)
        c.onStartInput(restarting = true)
        assertEquals(1L, c.value)
        c.onFinishInput()
        assertEquals(2L, c.value)
        c.onStartInput(restarting = false)
        assertEquals(3L, c.value)
    }

    @Test fun finishInputViewStopsKeyboardRecordingOnly() {
        val rec = DictationState.Recording(0f, 0, false, RecordingSource.KEYBOARD)
        assertTrue(shouldStopKeyboardRecording(rec))
        assertFalse(shouldStopKeyboardRecording(rec.copy(source = RecordingSource.TILE)))
        assertFalse(shouldStopKeyboardRecording(DictationState.Idle))
        assertFalse(shouldStopKeyboardRecording(DictationState.Transcribing(RecordingSource.KEYBOARD)))
    }

    @Test fun finishInputViewCallsStopAndTranscribeNotCancel() {
        var stops = 0
        val rec = DictationState.Recording(0f, 0, false, RecordingSource.KEYBOARD)
        stopKeyboardRecordingIfNeeded(rec) { stops++ }
        assertEquals(1, stops)
        stopKeyboardRecordingIfNeeded(rec.copy(source = RecordingSource.APP)) { stops++ }
        stopKeyboardRecordingIfNeeded(DictationState.Idle) { stops++ }
        assertEquals(1, stops)
    }

    @Test fun destroyDecisionStopsOnlyKeyboardRecording() = runTest {
        val c = controller(FakeRecorder(), FakeHistory())
        c.start(StartOptions(RecordingSource.TILE))
        runCurrent()
        assertTrue(c.state.value is DictationState.Recording)
        stopKeyboardRecordingIfNeeded(c) // what onDestroy runs: a tile recording must survive the IME dying
        advanceTimeBy(1_000); runCurrent()
        assertTrue(c.state.value is DictationState.Recording)
        c.cancel()
        runCurrent()
    }

    @Test fun finishInputViewKeepsAndTranscribesRealRecording() = runTest {
        val recorder = FakeRecorder()
        val history = FakeHistory()
        val c = controller(recorder, history)
        c.start(keyboardStartOptions(false, 0, session(1))!!)
        runCurrent()
        assertTrue(c.state.value is DictationState.Recording)
        // the exact helper onFinishInputView and onDestroy both call
        stopKeyboardRecordingIfNeeded(c)
        advanceTimeBy(1_000); runCurrent()
        assertTrue(c.state.value !is DictationState.Recording)
        assertTrue(c.state.value != DictationState.Idle || history.rows.value.isNotEmpty())
        assertTrue(recorder.released > 0)
        assertTrue(history.rows.value.isNotEmpty()) // not discarded
    }

    @Test fun commitsWhenSameSessionTextFieldAndViewShown() {
        val ic = RecordingConnection(before = "a")
        val out = Outcome()
        assertEquals(true, commit(result(5), ic, info(), session(5), shown = true, out))
        assertEquals(listOf(" hello"), ic.committed)
        assertEquals(listOf("r1"), out.inserted)
        assertEquals(1, out.acks)
    }

    @Test fun notCommittedWhenSessionChanged() = assertNotInserted(result(5), info(), session(6), shown = true)

    @Test fun notCommittedWhenFieldChanged() =
        assertNotInserted(result(5), info(), InputSession(5, FieldKey(8, "com.example")), shown = true)

    @Test fun notCommittedInPasswordField() = assertNotInserted(
        result(5), info(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD), session(5), shown = true,
    )

    @Test fun notCommittedWhenInputViewHidden() = assertNotInserted(result(5), info(), session(5), shown = false)

    @Test fun notCommittedWithoutEditorInfo() = assertNotInserted(result(5), null, session(5), shown = true)

    @Test fun notCommittedWithoutInputConnection() {
        val out = Outcome()
        assertEquals(false, commit(result(5), null, info(), session(5), shown = true, out))
        assertTrue(out.inserted.isEmpty())
    }

    @Test fun foreignResultsAreIgnored() {
        val ic = RecordingConnection()
        val out = Outcome()
        assertNull(commit(result(5, source = RecordingSource.TILE), ic, info(), session(5), true, out))
        assertNull(commit(DictationResult("r1", "t", RecordingSource.KEYBOARD, null), ic, info(), session(5), true, out))
        assertTrue(ic.committed.isEmpty())
    }

    @Test fun passwordFieldDisablesMic() {
        assertNull(keyboardStartOptions(password = true, imeOptions = 0, session = session(1)))
        val opts = keyboardStartOptions(
            password = false, imeOptions = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING, session = session(1),
        )
        assertNotNull(opts)
        assertEquals(RecordingSource.KEYBOARD, opts!!.source)
        assertFalse(opts.saveToHistory)
        assertEquals(session(1), opts.session)
    }

    private fun assertNotInserted(res: DictationResult, info: EditorInfo?, current: InputSession, shown: Boolean) {
        val ic = RecordingConnection()
        val out = Outcome()
        assertEquals(false, commit(res, ic, info, current, shown, out))
        assertTrue(ic.committed.isEmpty())
        assertTrue(out.inserted.isEmpty())
        assertEquals(0, out.acks)
    }

    private fun TestScope.controller(recorder: FakeRecorder, history: FakeHistory) = DictationController(
        scope = CoroutineScope(StandardTestDispatcher(testScheduler)),
        recorder = recorder,
        focus = FakeFocus(),
        transcriber = FakeTranscriber(),
        settings = FakeSettings(),
        history = history,
        tidy = TextTidy { it },
        recordingsDir = File(tmp.root, "recordings"),
        micGranted = { true },
        nowMs = { testScheduler.currentTime },
        wallClockMs = { 1_000_000L },
        newId = { "id1" },
    )
}
