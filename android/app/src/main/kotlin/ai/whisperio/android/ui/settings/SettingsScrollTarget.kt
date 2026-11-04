package ai.whisperio.android.ui.settings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Sections of the Settings screen another screen can ask to be scrolled to. */
enum class SettingsSection { PRIVACY }

/**
 * One-shot "scroll Settings to this section" request. Lives in AppRoot (not a nav argument) so it survives the
 * saveState/restoreState tab navigation, which would otherwise replay the first entry's stale arguments.
 * Settings consumes it once after composition, so rotation or returning to the tab never re-scrolls.
 */
class SettingsScrollTarget {
    private val _pending = MutableStateFlow<SettingsSection?>(null)
    val pending: StateFlow<SettingsSection?> = _pending

    fun request(section: SettingsSection) { _pending.value = section }

    /** Clears the request only if it is still [section] (a newer request is kept). */
    fun consume(section: SettingsSection) { _pending.compareAndSet(section, null) }
}
