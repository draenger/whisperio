package ai.whisperio.android

import ai.whisperio.android.security.generateWithStrongBoxFallback
import java.security.ProviderException
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

/** L1: StrongBox is requested opportunistically; a device without it falls back once to the regular Keystore. */
class StrongBoxFallbackTest {
    @Test fun usesStrongBoxWhenAvailable() {
        val calls = mutableListOf<Boolean>()
        assertEquals("k", generateWithStrongBoxFallback(true) { calls += it; "k" })
        assertEquals(listOf(true), calls)
    }

    @Test fun retriesOnceWithoutStrongBoxWhenUnavailable() {
        val calls = mutableListOf<Boolean>()
        val r = generateWithStrongBoxFallback(true) { sb -> calls += sb; if (sb) throw ProviderException("no strongbox") else "k" }
        assertEquals("k", r)
        assertEquals(listOf(true, false), calls)
    }

    @Test fun skipsStrongBoxBelowApi28() {
        val calls = mutableListOf<Boolean>()
        generateWithStrongBoxFallback(false) { calls += it }
        assertEquals(listOf(false), calls)
    }

    @Test fun secondFailurePropagatesAndOtherErrorsAreNotRetried() {
        val calls = mutableListOf<Boolean>()
        try {
            generateWithStrongBoxFallback<String>(true) { calls += it; throw ProviderException("boom") }
            fail()
        } catch (_: ProviderException) {}
        assertEquals(listOf(true, false), calls)
        calls.clear()
        try {
            generateWithStrongBoxFallback<String>(true) { calls += it; throw IllegalStateException("x") }
            fail()
        } catch (_: IllegalStateException) {}
        assertEquals(listOf(true), calls)
    }
}
