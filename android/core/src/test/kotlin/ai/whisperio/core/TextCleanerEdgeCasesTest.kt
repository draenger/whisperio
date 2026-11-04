package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * [TextCleaner] paths not covered by TextCleanerTest. Quirks of the verbatim Swift port are pinned
 * as characterisation tests so any behaviour change is deliberate.
 */
class TextCleanerEdgeCasesTest {
    private fun tidy(s: String) = TextCleaner.tidy(s)

    @Test fun singleLetterBecomesASentence() {
        assertEquals("A.", tidy("a"))
    }

    @Test fun tabsAndSpaceRunsCollapseButNewlinesSurvive() {
        assertEquals("One two\nthree.", tidy("one\t\t two\nthree"))
        assertEquals("A\n\nb.", tidy("a\n\nb"))
    }

    @Test fun spaceBeforePunctuationIncludesNewlines() {
        assertEquals("Hello.", tidy("hello\n."))
        assertEquals("Wait, what?", tidy("wait  ,  what ?"))
    }

    @Test fun everyPunctuationMarkGetsAFollowingSpace() {
        assertEquals("A, b; c: d.", tidy("a,b;c:d"))
    }

    @Test fun sentenceStartAfterNewlineIsCapitalised() {
        assertEquals("One!\nTwo?\nThree.", tidy("one!\ntwo?\nthree"))
    }

    @Test fun capitalisationCarriesOverNonLetters() {
        // The flag survives digits and quotes until the next letter.
        assertEquals("Done. 2 Apples.", tidy("done. 2 apples"))
        assertEquals("He left. \"Bye\" she said.", tidy("he left. \"bye\" she said"))
    }

    @Test fun commasAndColonsDoNotCapitalise() {
        assertEquals("Note: lower, still lower.", tidy("note: lower, still lower"))
    }

    @Test fun leadingNonLetterIsNotCapitalised() {
        assertEquals("1st place.", tidy("1st place"))
        assertEquals("\"quoted\" start.", tidy("\"quoted\" start"))
    }

    @Test fun existingCapitalsAreKept() {
        assertEquals("NASA and iPhone. OK.", tidy("NASA and iPhone. OK"))
    }

    @Test fun onlyPunctuation() {
        assertEquals(".", tidy("."))
        assertEquals("?", tidy(" ? "))
        assertEquals(",.", tidy(","))
    }

    @Test fun unicodeSentenceStarts() {
        assertEquals("Ćma. Żaba! Łódź.", tidy("ćma. żaba! łódź"))
    }

    @Test fun emojiAtTheEndStillGetsAPeriod() {
        assertEquals("Nice 😀.", tidy("nice 😀"))
    }

    @Test fun idempotentOnAlreadyCleanText() {
        val clean = "First sentence. Second one, with a comma! Third?"
        assertEquals(clean, tidy(clean))
        assertEquals(clean, tidy(tidy(clean)))
    }

    // ---- Quirks inherited from TextCleaner.swift (documented in the source header)

    @Test fun quirkDecimalsAreSplit() {
        assertEquals("Pi is 3. 14.", tidy("pi is 3.14"))
    }

    @Test fun quirkStackedPunctuationIsSpacedOut() {
        assertEquals("What? !", tidy("what?!"))
        assertEquals("Wait. ..", tidy("wait..."))  // non-overlapping regex: only the first gap is filled
    }

    @Test fun quirkClosingQuoteGetsAnExtraPeriod() {
        assertEquals("He said \"hi. \".", tidy("he said \"hi.\""))
    }

    @Test fun quirkUrlsAndEmailsAreBroken() {
        assertEquals("Visit example. Com.", tidy("visit example.com"))
    }
}
