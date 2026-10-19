package ai.whisperio.core

import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals

class HistoryExportTest {
    private val utc: ZoneId = ZoneOffset.UTC
    private val t1 = 1_792_230_060_000L // 2026-10-17 09:41 UTC
    private val older = t1 - 86_400_000L

    private fun item(at: Long, text: String?, src: String = "App", prov: String = "openai") = ExportItem(at, src, prov, text)

    @Test fun txtNewestFirstWithSeparators() {
        val r = HistoryExport.format(listOf(item(older, "Old one."), item(t1, "New one.")), ExportFormat.TXT, utc)
        assertEquals("2026-10-17 09:41\n\nNew one.\n---\n\n2026-10-16 09:41\n\nOld one.\n---\n", r.content)
        assertEquals(2, r.exported)
        assertEquals(0, r.skipped)
    }

    @Test fun mdNewestFirstWithHeadings() {
        val r = HistoryExport.format(
            listOf(item(older, "Old one.", "Keyboard", "groq"), item(t1, "New one.")), ExportFormat.MD, utc,
        )
        assertEquals(
            "# Whisperio export\n\n## 2026-10-17 09:41 \u00B7 App \u00B7 openai\n\nNew one.\n\n" +
                "## 2026-10-16 09:41 \u00B7 Keyboard \u00B7 groq\n\nOld one.\n",
            r.content,
        )
    }

    @Test fun skipsItemsWithoutTextAndCountsThem() {
        val r = HistoryExport.format(listOf(item(t1, null), item(t1, "  \n"), item(older, "ok")), ExportFormat.TXT, utc)
        assertEquals(1, r.exported)
        assertEquals(2, r.skipped)
        assertEquals("2026-10-16 09:41\n\nok\n---\n", r.content)
    }

    @Test fun emptySelectionIsEmptyContent() {
        val r = HistoryExport.format(emptyList(), ExportFormat.MD, utc)
        assertEquals(ExportResult("", 0, 0), r)
        assertEquals(ExportResult("", 0, 1), HistoryExport.format(listOf(item(t1, null)), ExportFormat.TXT, utc))
    }

    @Test fun timeZoneShiftsTimestamp() {
        val r = HistoryExport.format(listOf(item(t1, "x")), ExportFormat.TXT, ZoneId.of("Europe/Warsaw"))
        assertEquals("2026-10-17 11:41\n\nx\n---\n", r.content)
    }

    @Test fun txtIsNotEscaped() {
        val r = HistoryExport.format(listOf(item(t1, "# not a heading")), ExportFormat.TXT, utc)
        assertEquals("2026-10-17 09:41\n\n# not a heading\n---\n", r.content)
    }

    @Test fun escapesLeadingMarkdownCharacters() {
        for (c in listOf("#", ">", "-", "+", "*")) {
            assertEquals("\$c x", HistoryExport.escapeMarkdown("$c x"), c)
        }
        assertEquals("a # b - c", HistoryExport.escapeMarkdown("a # b - c"))
    }

    @Test fun escapesOrderedListMarkers() {
        assertEquals("1\. one", HistoryExport.escapeMarkdown("1. one"))
        assertEquals("12\) twelve", HistoryExport.escapeMarkdown("12) twelve"))
        assertEquals("  3\. indented", HistoryExport.escapeMarkdown("  3. indented"))
        assertEquals("1 one", HistoryExport.escapeMarkdown("1 one"))
        assertEquals("a1. x", HistoryExport.escapeMarkdown("a1. x"))
    }

    @Test fun escapesRuleAndSetextLines() {
        assertEquals("\---", HistoryExport.escapeMarkdown("---"))
        assertEquals("\===", HistoryExport.escapeMarkdown("==="))
        assertEquals("\=", HistoryExport.escapeMarkdown("="))
        assertEquals("a=b", HistoryExport.escapeMarkdown("a=b"))
    }

    @Test fun escapesEveryLineOfMultilineText() {
        assertEquals("first\n\- second\n\n2\. third", HistoryExport.escapeMarkdown("first\n- second\n\n2. third"))
    }

    @Test fun mdBodyIsEscapedInOutput() {
        val r = HistoryExport.format(listOf(item(t1, "intro\n- item")), ExportFormat.MD, utc)
        assertEquals(
            "# Whisperio export\n\n## 2026-10-17 09:41 \u00B7 App \u00B7 openai\n\nintro\n\- item\n",
            r.content,
        )
    }

    @Test fun fileNameUsesInjectedClockAndFormat() {
        assertEquals("whisperio-2026-10-17.txt", HistoryExport.fileName(ExportFormat.TXT, t1, utc))
        assertEquals("whisperio-2026-10-17.md", HistoryExport.fileName(ExportFormat.MD, t1, utc))
        val lateUtc = 1_792_279_800_000L // 2026-10-17 23:30 UTC = 01:30 on the 18th in Warsaw
        assertEquals("whisperio-2026-10-18.txt", HistoryExport.fileName(ExportFormat.TXT, lateUtc, ZoneId.of("Europe/Warsaw")))
    }
}
