package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals

class WordCountTest {
    @Test fun nullAndBlankHaveNoWords() {
        assertEquals(0, wordCount(null))
        assertEquals(0, wordCount(""))
        assertEquals(0, wordCount("  \t\r\n "))
        assertEquals(0, wordCount("\u00A0"))
    }

    @Test fun singleWord() {
        assertEquals(1, wordCount("Hello"))
    }

    @Test fun multipleSpacesSeparateWords() {
        assertEquals(3, wordCount("  one   two  three  "))
    }

    @Test fun tabsSeparateWords() {
        assertEquals(3, wordCount("\tone\t\ttwo\tthree\t"))
    }

    @Test fun newlinesSeparateWords() {
        assertEquals(3, wordCount("\none\n\ntwo\r\nthree\n"))
    }

    @Test fun nonBreakingSpacesSeparateWords() {
        assertEquals(3, wordCount("\u00A0one\u00A0\u00A0two\u00A0three\u00A0"))
    }

    @Test fun polishText() {
        assertEquals(3, wordCount("Zażółć gęślą jaźń"))
    }

    @Test fun punctuationDoesNotSeparateWords() {
        assertEquals(2, wordCount("one,two-three ..."))
    }
}
