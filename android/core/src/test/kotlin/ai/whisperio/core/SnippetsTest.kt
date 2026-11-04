package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SnippetsTest {
    private val sig = Snippet("1", "my signature", "Best regards,\nJan Kowalski")
    private val addr = Snippet("2", "adres domowy", "ul. Długa 5, 00-001 Warszawa")

    @Test fun emptyListIsNoOp() {
        assertEquals("my signature", Snippets.apply("my signature", emptyList()))
    }

    @Test fun exactWholePhraseMatchReplaces() {
        assertEquals(sig.replacement, Snippets.apply("my signature", listOf(sig)))
    }

    @Test fun caseInsensitive() {
        assertEquals(sig.replacement, Snippets.apply("My Signature", listOf(sig)))
        assertEquals(sig.replacement, Snippets.apply("MY SIGNATURE", listOf(sig)))
    }

    @Test fun edgePunctuationAndWhitespaceTolerated() {
        // TextCleaner adds a capital and a final period; providers add quotes, ellipses, spaces.
        assertEquals(sig.replacement, Snippets.apply("My signature.", listOf(sig)))
        assertEquals(sig.replacement, Snippets.apply("  \"my signature!?\"  ", listOf(sig)))
        assertEquals(sig.replacement, Snippets.apply("¿my signature…", listOf(sig)))
        assertEquals(sig.replacement, Snippets.apply("my   signature", listOf(sig)))
    }

    @Test fun triggerWithEdgePunctuationStillMatches() {
        val s = Snippet("3", "  Thanks! ", "Thank you very much.")
        assertEquals(s.replacement, Snippets.apply("thanks", listOf(s)))
    }

    @Test fun partialOrEmbeddedPhraseDoesNotMatch() {
        assertEquals("Here is my signature.", Snippets.apply("Here is my signature.", listOf(sig)))
        assertEquals("My signature please.", Snippets.apply("My signature please.", listOf(sig)))
        assertEquals("My.", Snippets.apply("My.", listOf(sig)))
    }

    @Test fun innerPunctuationMustMatch() {
        val s = Snippet("4", "e-mail", "me@example.com")
        assertEquals("Email.", Snippets.apply("Email.", listOf(s)))
        assertEquals("me@example.com", Snippets.apply("E-mail.", listOf(s)))
    }

    @Test fun languageAgnosticUnicode() {
        assertEquals(addr.replacement, Snippets.apply("Adres domowy.", listOf(addr)))
        val pl = Snippet("5", "żółć", "OK")
        assertEquals("OK", Snippets.apply("ŻÓŁĆ.", listOf(pl)))
        // Decomposed (NFD) input matches a composed (NFC) trigger.
        assertEquals("OK", Snippets.apply("żółć", listOf(pl)))
        val de = Snippet("6", "straße", "Hauptstraße 1")
        assertEquals("Hauptstraße 1", Snippets.apply("Straße!", listOf(de)))
        val ru = Snippet("7", "мой адрес", "Москва")
        assertEquals("Москва", Snippets.apply("Мой адрес.", listOf(ru)))
    }

    @Test fun firstMatchWins() {
        val a = Snippet("a", "hello", "A")
        val b = Snippet("b", "Hello.", "B")
        assertEquals("A", Snippets.apply("hello", listOf(a, b)))
    }

    @Test fun blankAndPunctuationOnlyNeverMatch() {
        val junk = Snippet("j", "...", "X")
        assertEquals("...", Snippets.apply("...", listOf(junk)))
        assertEquals("", Snippets.apply("", listOf(sig)))
        assertEquals("Hi", Snippets.apply("Hi", listOf(Snippet("k", "hi", "  "))))
    }

    @Test fun normalizeKey() {
        assertEquals("my signature", Snippets.normalize(" «My  Signature». "))
        assertEquals("", Snippets.normalize("?!. "))
    }

    @Test fun checkValidates() {
        assertEquals(SnippetCheck.Ok("my sig", "text"), Snippets.check("  my sig ", " text\n", emptyList()))
        assertIs<SnippetCheck.BlankTrigger>(Snippets.check(" ?! ", "x", emptyList()))
        assertIs<SnippetCheck.BlankReplacement>(Snippets.check("a", "  ", emptyList()))
        assertIs<SnippetCheck.TriggerTooLong>(Snippets.check("a".repeat(Snippets.MAX_TRIGGER + 1), "x", emptyList()))
        assertIs<SnippetCheck.ReplacementTooLong>(Snippets.check("a", "x".repeat(Snippets.MAX_REPLACEMENT + 1), emptyList()))
        assertIs<SnippetCheck.Duplicate>(Snippets.check("My Signature!", "x", listOf(sig)))
    }

    @Test fun addUpdateRemove() {
        var list = Snippets.add(emptyList(), sig)
        list = Snippets.add(list, addr)
        list = Snippets.update(list, "1", "sig", "S")
        assertEquals(listOf(Snippet("1", "sig", "S"), addr), list)
        assertEquals(list, Snippets.update(list, "missing", "x", "y"))
        assertEquals(listOf(addr), Snippets.remove(list, "1"))
    }

    @Test fun encodeDecodeRoundTrip() {
        val list = listOf(sig, addr, Snippet("q", "quote \"x\"", "line1\nline2 \\ end"))
        assertEquals(list, Snippets.decode(Snippets.encode(list)))
    }

    @Test fun decodeIsTolerant() {
        assertTrue(Snippets.decode(null).isEmpty())
        assertTrue(Snippets.decode("").isEmpty())
        assertTrue(Snippets.decode("not json").isEmpty())
        assertTrue(Snippets.decode("{\"id\":\"1\"}").isEmpty())
        val raw = """[{"id":"1","trigger":"a","replacement":"A"},{"id":"1","trigger":"b","replacement":"B"},
            |{"id":"2","trigger":"","replacement":"x"},{"id":"3","trigger":"c"},5,{"id":"4","trigger":"d","replacement":"D","extra":1}]""".trimMargin()
        assertEquals(listOf(Snippet("1", "a", "A"), Snippet("4", "d", "D")), Snippets.decode(raw))
    }

    @Test fun combiningMarksKeepDifferentTriggersApart() {
        // 'का' and 'की' differ only by a vowel sign (a combining mark): they must stay distinct.
        val ka = Snippet("10", "का", "KA")
        val ki = Snippet("11", "की", "KI")
        assertEquals("KI", Snippets.apply("की", listOf(ka, ki)))
        assertEquals("KA", Snippets.apply("का", listOf(ka, ki)))
        assertEquals("KI", Snippets.apply("की.", listOf(ka, ki))) // edge punctuation still stripped
    }
}
