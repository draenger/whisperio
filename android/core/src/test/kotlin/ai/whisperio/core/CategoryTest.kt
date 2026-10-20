package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CategoryTest {
    @Test fun seedsMatchIosOrder() {
        assertEquals(listOf("work", "personal", "ideas", "messages", "code", "todo"), Categories.SEED_IDS)
    }

    @Test fun customHueCyclesThroughTheSixColours() {
        val expected = listOf(0x4A8CF7L, 0xFBBF24L, 0xF472B6L, 0xA78BFAL, 0x34D399L, 0x22D3EEL)
        expected.forEachIndexed { i, c -> assertEquals(c, Categories.customHue(i), "slot $i") }
        assertEquals(0x4A8CF7L, Categories.customHue(6))
        assertEquals(0xFBBF24L, Categories.customHue(7))
        assertEquals(0x22D3EEL, Categories.customHue(35))
    }

    @Test fun negativeIndexWrapsInsteadOfThrowing() {
        assertEquals(0x22D3EEL, Categories.customHue(-1))
    }

    @Test fun seedLookup() {
        assertTrue(Categories.isSeed("work"))
        assertFalse(Categories.isSeed("c_123"))
        assertFalse(Categories.isSeed(null))
    }
}
