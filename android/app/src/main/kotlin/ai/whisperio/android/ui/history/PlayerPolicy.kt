package ai.whisperio.android.ui.history

import ai.whisperio.android.dictation.DictationState

/** CONTRACT-1.1 F4: what the detail screen shows for the kept audio. */
enum class PlayerAvailability {
    /** The audio file is gone (keep-audio off, retention, "delete all audio"): no player, no error. */
    HIDDEN,

    /** The file exists but the dictation controller is recording: shown, play is disabled. */
    DISABLED_RECORDING,

    READY,
}

fun playerAvailability(audioFileExists: Boolean, recording: Boolean): PlayerAvailability = when {
    !audioFileExists -> PlayerAvailability.HIDDEN
    recording -> PlayerAvailability.DISABLED_RECORDING
    else -> PlayerAvailability.READY
}

/** Starting a recording stops (releases) any playback. */
fun shouldStopPlayback(state: DictationState): Boolean = state is DictationState.Recording
