package ai.whisperio.android.ui.common

import ai.whisperio.android.dictation.DictationState
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView

/** The screen must stay on exactly while the microphone is recording (a timeout would otherwise end the dictation). */
internal fun needsScreenOn(state: DictationState): Boolean = state is DictationState.Recording

/** Sets/clears the view's keep-screen-on flag; honoured by the window (activity or IME) the view is attached to. */
internal fun applyKeepScreenOn(view: View, on: Boolean) {
    view.keepScreenOn = on
}

/** Keeps the screen on while [active]; cleared when [active] turns false or the composable leaves the composition. */
@Composable
fun KeepScreenOn(active: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, active) {
        applyKeepScreenOn(view, active)
        onDispose { applyKeepScreenOn(view, false) }
    }
}
