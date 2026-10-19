package ai.whisperio.android

import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ui.history.PlayerAvailability
import ai.whisperio.android.ui.history.playerAvailability
import ai.whisperio.android.ui.history.shouldStopPlayback
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** CONTRACT-1.1 F4: playback state policy. */
class PlayerPolicyTest {
    @Test fun hiddenWhenTheAudioFileIsGone() {
        assertEquals(PlayerAvailability.HIDDEN, playerAvailability(audioFileExists = false, recording = false))
        // Gone wins over recording: no player at all, no reason text.
        assertEquals(PlayerAvailability.HIDDEN, playerAvailability(audioFileExists = false, recording = true))
    }

    @Test fun disabledWhileRecording() =
        assertEquals(PlayerAvailability.DISABLED_RECORDING, playerAvailability(audioFileExists = true, recording = true))

    @Test fun readyOtherwise() =
        assertEquals(PlayerAvailability.READY, playerAvailability(audioFileExists = true, recording = false))

    @Test fun onlyRecordingStopsPlayback() {
        assertTrue(shouldStopPlayback(DictationState.Recording(0f, 0, false, RecordingSource.APP)))
        assertFalse(shouldStopPlayback(DictationState.Idle))
        assertFalse(shouldStopPlayback(DictationState.Transcribing(RecordingSource.APP)))
        assertFalse(shouldStopPlayback(DictationState.Done("x", null, RecordingSource.APP)))
    }
}
