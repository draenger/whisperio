package ai.whisperio.android.ui.settings

import ai.whisperio.android.di.EncryptHistoryResult
import ai.whisperio.android.settings.AppSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The "Encrypt history" switch as a state holder shared by Settings and the one-time Home card. It lives in the
 * app graph (not in a composable), so [busy] and [notice] survive rotation and navigation while [run] works.
 * [run] is `AppGraph.setEncryptHistory`; [scope] must not be tied to a screen.
 */
class EncryptSwitch(
    private val scope: CoroutineScope,
    private val run: suspend (Boolean) -> EncryptHistoryResult,
    /** Items still stored in plaintext while the switch is ON (written while the Keystore failed). */
    val pending: StateFlow<Int> = MutableStateFlow(0),
    /** True when sealed data exists but its data key is missing (no new key is minted over it). */
    val locked: StateFlow<Boolean> = MutableStateFlow(false),
) {
    private val _busy = MutableStateFlow<Boolean?>(null)
    private val _notice = MutableStateFlow<EncryptNotice?>(null)

    /** Non-null while rows are migrating: the target value (true = encrypting). */
    val busy: StateFlow<Boolean?> = _busy.asStateFlow()

    /** What the user must be told about the last run; null = nothing to show. */
    val notice: StateFlow<EncryptNotice?> = _notice.asStateFlow()

    /** Ignored while a run is in progress. Call only after the user confirmed the dialog. */
    fun request(value: Boolean) {
        if (!_busy.compareAndSet(null, value)) return
        _notice.value = null
        scope.launch {
            try {
                _notice.value = encryptNoticeFor(run(value))
            } finally {
                _busy.value = null
            }
        }
    }

    fun dismissNotice() {
        _notice.value = null
    }
}

/**
 * Whether Home offers the one-time "Encrypt history" card: only after onboarding, only while encryption is OFF and
 * only until the user has answered it (Turn on or Not now).
 */
fun shouldOfferEncryptCard(s: AppSettings): Boolean = s.onboardingDone && !s.encryptHistory && !s.encryptCardHandled
