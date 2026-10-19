package ai.whisperio.android

import ai.whisperio.android.ime.InputSession
import ai.whisperio.android.ime.effectiveLanguage
import ai.whisperio.android.ime.keyboardStartOptions
import ai.whisperio.android.settings.AppLanguageMap
import ai.whisperio.android.settings.AppLanguagePolicy
import android.text.InputType
import android.view.inputmethod.EditorInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** F7 pure logic: LRU map and the "should store?" rule (CONTRACT-1.1). Plain JUnit, no Android runtime. */
class AppLanguageMapTest {

    @Test fun putAndGet() {
        val m = AppLanguageMap.EMPTY.put("com.a", "pl").put("com.b", "en")
        assertEquals("pl", m.get("com.a"))
        assertEquals("en", m.get("com.b"))
        assertNull(m.get("com.c"))
        assertEquals(listOf("com.b", "com.a"), m.packages)
    }

    @Test fun putExistingReplacesAndMovesToFront() {
        val m = AppLanguageMap.EMPTY.put("com.a", "pl").put("com.b", "en").put("com.a", "de")
        assertEquals(2, m.size)
        assertEquals("de", m.get("com.a"))
        assertEquals(listOf("com.a", "com.b"), m.packages)
    }

    @Test fun touchMovesToFrontWithoutChangingLanguage() {
        val m = AppLanguageMap.EMPTY.put("com.a", "pl").put("com.b", "en").put("com.c", "de").touch("com.a")
        assertEquals(listOf("com.a", "com.c", "com.b"), m.packages)
        assertEquals("pl", m.get("com.a"))
    }

    @Test fun touchUnknownPackageIsNoOp() {
        val m = AppLanguageMap.EMPTY.put("com.a", "pl")
        assertEquals(m, m.touch("com.zzz"))
    }

    @Test fun evictsLeastRecentlyUsedAtTwoHundred() {
        var m = AppLanguageMap.EMPTY
        for (i in 1..200) m = m.put("com.app$i", "pl")
        assertEquals(200, m.size)
        m = m.put("com.app201", "en") // evicts com.app1, the oldest
        assertEquals(200, m.size)
        assertNull(m.get("com.app1"))
        assertEquals("pl", m.get("com.app2"))
        assertEquals("en", m.get("com.app201"))
        assertEquals("com.app201", m.packages.first())
    }

    @Test fun touchProtectsAnEntryFromEviction() {
        var m = AppLanguageMap.EMPTY
        for (i in 1..200) m = m.put("com.app$i", "pl")
        m = m.touch("com.app1").put("com.app201", "en") // app1 was refreshed, app2 is now the oldest
        assertEquals("pl", m.get("com.app1"))
        assertNull(m.get("com.app2"))
        assertEquals(200, m.size)
    }

    @Test fun rewritingAnExistingEntryAtTheCapEvictsNothing() {
        var m = AppLanguageMap.EMPTY
        for (i in 1..200) m = m.put("com.app$i", "pl")
        m = m.put("com.app1", "de")
        assertEquals(200, m.size)
        assertEquals("de", m.get("com.app1"))
        assertEquals("pl", m.get("com.app2"))
    }

    @Test fun encodeDecodeRoundTripKeepsOrder() {
        val m = AppLanguageMap.EMPTY.put("com.a", "pl").put("com.b", "auto").put("com.c", "uk")
        assertEquals(m, AppLanguageMap.decode(m.encode()))
    }

    @Test fun decodeToleratesGarbageDuplicatesAndOversize() {
        val raw = "com.a\tpl\nbroken line\n\ncom.a\ten\ncom.b\t\n\tde\ncom.c\tuk"
        val m = AppLanguageMap.decode(raw)
        assertEquals(listOf("com.a", "com.c"), m.packages)
        assertEquals("pl", m.get("com.a"))
        val big = (1..250).joinToString("\n") { "com.app$it\tpl" }
        assertEquals(200, AppLanguageMap.decode(big).size)
        assertEquals(AppLanguageMap.EMPTY, AppLanguageMap.decode(null))
        assertEquals(AppLanguageMap.EMPTY, AppLanguageMap.decode(""))
    }

    @Test fun invalidKeysAreRejected() {
        val m = AppLanguageMap.EMPTY.put("", "pl").put("com.a", "").put("com\ta", "pl").put("com.a", "p\nl")
        assertEquals(0, m.size)
    }

    @Test fun toStringDoesNotLeakPackageNames() {
        val m = AppLanguageMap.EMPTY.put("com.secret.bank", "pl")
        assertFalse(m.toString().contains("secret"))
    }

    // --- the privacy rule ---

    private val plainText = InputType.TYPE_CLASS_TEXT

    @Test fun plainFieldIsStored() {
        assertTrue(AppLanguagePolicy.shouldStore(plainText, 0, "com.a"))
    }

    @Test fun nullOrBlankPackageIsNeverStored() {
        assertFalse(AppLanguagePolicy.shouldStore(plainText, 0, null))
        assertFalse(AppLanguagePolicy.shouldStore(plainText, 0, ""))
    }

    @Test fun passwordFieldsAreNeverStored() {
        for (v in listOf(
            InputType.TYPE_TEXT_VARIATION_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
        )) assertFalse(AppLanguagePolicy.shouldStore(plainText or v, 0, "com.a"))
    }

    @Test fun numberPasswordIsNeverStored() {
        val numberPassword = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        assertFalse(AppLanguagePolicy.shouldStore(numberPassword, 0, "com.a"))
        assertTrue(AppLanguagePolicy.shouldStore(InputType.TYPE_CLASS_NUMBER, 0, "com.a"))
    }

    @Test fun noPersonalizedLearningIsNeverStored() {
        assertFalse(AppLanguagePolicy.shouldStore(plainText, EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING, "com.a"))
        assertFalse(
            AppLanguagePolicy.shouldStore(
                plainText, EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING or EditorInfo.IME_ACTION_SEND, "com.a",
            ),
        )
    }

    // --- keyboard wiring helpers ---

    @Test fun fieldLanguageOnlyCountsWhileTheSwitchIsOn() {
        assertEquals("pl", effectiveLanguage(true, "pl", "en"))
        assertEquals("en", effectiveLanguage(true, null, "en"))
        assertEquals("en", effectiveLanguage(false, "pl", "en"))
    }

    @Test fun keyboardStartOptionsCarryTheLanguage() {
        val session = InputSession(1, null)
        assertEquals("pl", keyboardStartOptions(false, 0, session, language = "pl")!!.language)
        assertNull(keyboardStartOptions(false, 0, session)!!.language)
        assertNull(keyboardStartOptions(true, 0, session, language = "pl")) // mic stays off in password fields
    }
}
