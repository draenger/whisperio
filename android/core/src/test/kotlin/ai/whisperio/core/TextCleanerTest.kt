package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals

/** The iOS source has no TextCleaner tests; these vectors are hand-derived from TextCleaner.swift. */
class TextCleanerTest {
    @Test fun emptyAndWhitespaceStayEmpty() {
        assertEquals("", TextCleaner.tidy(""))
        assertEquals("", TextCleaner.tidy("  \n\t "))
    }

    @Test fun fixesSpacingAndPunctuationGaps() {
        assertEquals("Hello world, this is a test.", TextCleaner.tidy("hello  world ,this is   a test"))
    }

    @Test fun capitalizesEverySentence() {
        assertEquals("First. Second! Third? Fourth.", TextCleaner.tidy("first. second! third? fourth"))
    }

    @Test fun keepsExistingTerminalPunctuation() {
        assertEquals("Already fine.", TextCleaner.tidy("already fine."))
        assertEquals("Really?", TextCleaner.tidy("really?"))
    }

    @Test fun trimsTrailingSpacesOnLines() {
        assertEquals("Line one\nline two.", TextCleaner.tidy("line one \nline two"))
    }

    @Test fun unicodeLetters() {
        assertEquals("Zażółć gęślą jaźń.", TextCleaner.tidy("zażółć gęślą jaźń"))
    }
}
