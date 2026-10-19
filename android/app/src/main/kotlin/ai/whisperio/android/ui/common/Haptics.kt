package ai.whisperio.android.ui.common

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View

/** CONTRACT-1.1 F9: CONFIRM on API 30+, VIRTUAL_KEY below. */
internal fun confirmHapticConstant(sdk: Int): Int =
    if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY

/**
 * Short confirmation tick on copy, keyboard insert and finished transcription. Uses the view haptic path, so it needs
 * no VIBRATE permission and follows the system "touch feedback" setting. A detached view does nothing.
 */
fun View.confirmHaptic() {
    if (isAttachedToWindow) performHapticFeedback(confirmHapticConstant(Build.VERSION.SDK_INT))
}
