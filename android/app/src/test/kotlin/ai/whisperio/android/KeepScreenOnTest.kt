package ai.whisperio.android

import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ui.common.applyKeepScreenOn
import ai.whisperio.android.ui.common.needsScreenOn
import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class KeepScreenOnTest {
    @Test fun screenStaysOnOnlyWhileRecording() {
        assertTrue(needsScreenOn(DictationState.Recording(0f, 0, false, RecordingSource.TILE)))
        assertTrue(needsScreenOn(DictationState.Recording(0f, 0, false, RecordingSource.KEYBOARD)))
        assertFalse(needsScreenOn(DictationState.Idle))
        assertFalse(needsScreenOn(DictationState.Transcribing(RecordingSource.APP)))
        assertFalse(needsScreenOn(DictationState.Error(DictationError.NO_KEY)))
    }

    @Test fun keepScreenOnFollowsRecordingState() {
        val view = View(ApplicationProvider.getApplicationContext<android.app.Application>())
        assertFalse(view.keepScreenOn)
        applyKeepScreenOn(view, needsScreenOn(DictationState.Recording(0f, 0, false, RecordingSource.APP)))
        assertTrue(view.keepScreenOn)
        applyKeepScreenOn(view, needsScreenOn(DictationState.Idle))
        assertFalse(view.keepScreenOn)
    }
}
