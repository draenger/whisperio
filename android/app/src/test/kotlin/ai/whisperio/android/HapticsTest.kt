package ai.whisperio.android

import ai.whisperio.android.ui.common.confirmHapticConstant
import android.view.HapticFeedbackConstants
import org.junit.Assert.assertEquals
import org.junit.Test

class HapticsTest {
    @Test fun confirmFromApi30() {
        assertEquals(HapticFeedbackConstants.CONFIRM, confirmHapticConstant(30))
        assertEquals(HapticFeedbackConstants.CONFIRM, confirmHapticConstant(36))
    }

    @Test fun virtualKeyBelowApi30() {
        assertEquals(HapticFeedbackConstants.VIRTUAL_KEY, confirmHapticConstant(26))
        assertEquals(HapticFeedbackConstants.VIRTUAL_KEY, confirmHapticConstant(29))
    }
}
