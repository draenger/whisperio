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

/** Per-view owner count so two screens (Home, Onboarding) never clear each other's keep-screen-on. */
private val owners = java.util.WeakHashMap<View, Int>()

internal fun acquireKeepScreenOn(view: View) {
    owners[view] = (owners[view] ?: 0) + 1
    applyKeepScreenOn(view, true)
}

internal fun releaseKeepScreenOn(view: View) {
    val n = (owners[view] ?: 0) - 1
    if (n <= 0) owners.remove(view) else owners[view] = n
    applyKeepScreenOn(view, n > 0)
}

/** Keeps the screen on while [active]; released when [active] turns false or the composable leaves the composition. */
@Composable
fun KeepScreenOn(active: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, active) {
        if (active) acquireKeepScreenOn(view)
        onDispose { if (active) releaseKeepScreenOn(view) }
    }
}
