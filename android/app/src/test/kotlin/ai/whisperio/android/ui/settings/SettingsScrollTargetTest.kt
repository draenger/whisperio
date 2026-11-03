package ai.whisperio.android.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SettingsScrollTargetTest {
    @Test
    fun startsEmpty() { assertNull(SettingsScrollTarget().pending.value) }

    @Test
    fun requestThenConsumeClearsOnce() {
        val t = SettingsScrollTarget()
        t.request(SettingsSection.PRIVACY)
        assertEquals(SettingsSection.PRIVACY, t.pending.value)
        t.consume(SettingsSection.PRIVACY)
        assertNull(t.pending.value)
        t.consume(SettingsSection.PRIVACY)
        assertNull(t.pending.value)
    }

    @Test
    fun repeatedRequestAfterConsumeScrollsAgain() {
        val t = SettingsScrollTarget()
        t.request(SettingsSection.PRIVACY)
        t.consume(SettingsSection.PRIVACY)
        t.request(SettingsSection.PRIVACY)
        assertEquals(SettingsSection.PRIVACY, t.pending.value)
    }
}
