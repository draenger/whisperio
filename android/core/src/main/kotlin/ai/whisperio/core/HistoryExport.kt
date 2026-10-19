package ai.whisperio.core

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class ExportFormat(val extension: String, val mimeType: String) {
    TXT("txt", "text/plain"),
    MD("md", "text/markdown"),
}

/** One history row as the exporter sees it; [source] is the already localised label. [text] null or blank = skipped. */
data class ExportItem(val createdAt: Long, val source: String, val provider: String, val text: String?)

data class ExportResult(val content: String, val exported: Int, val skipped: Int)

/** CONTRACT-1.1 F6: pure text formatter (UTF-8, LF), newest first; the caller writes the bytes to the SAF uri. */
object HistoryExport {
    private val stamp = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.ROOT)
    private val day = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT)
    private val orderedList = Regex("""^(\s*)(\d+)([.)])""")
    private val setextEquals = Regex("""^\s*=+\s*$""")

    fun format(items: List<ExportItem>, format: ExportFormat, zone: ZoneId): ExportResult {
        val usable = items.filter { !it.text.isNullOrBlank() }.sortedByDescending { it.createdAt }
        val skipped = items.size - usable.size
        if (usable.isEmpty()) return ExportResult("", 0, skipped)
        val blocks = usable.map { item ->
            val at = stamp.format(Instant.ofEpochMilli(item.createdAt).atZone(zone))
            val body = item.text!!.trim().replace("\r\n", "\n").replace('\r', '\n')
            when (format) {
                ExportFormat.TXT -> "$at\n\n$body\n---\n"
                ExportFormat.MD -> "## $at \u00B7 ${item.source} \u00B7 ${item.provider}\n\n${escapeMarkdown(body)}\n"
            }
        }
        val content = when (format) {
            ExportFormat.TXT -> blocks.joinToString("\n")
            ExportFormat.MD -> "# Whisperio export\n\n" + blocks.joinToString("\n")
        }
        return ExportResult(content, usable.size, skipped)
    }

    /** `whisperio-YYYY-MM-DD.{txt|md}` for the picker's default name; the clock is injected by the caller. */
    fun fileName(format: ExportFormat, nowMs: Long, zone: ZoneId): String =
        "whisperio-${day.format(Instant.ofEpochMilli(nowMs).atZone(zone))}.${format.extension}"

    /**
     * Backslash-escapes what would turn a transcript line into Markdown structure: a leading `#`, `>`, `-`, `+`, `*`,
     * `\d+.` or `\d+)` (escaped before the punctuation), and a line of only `=` (setext heading; `---` is covered by `-`).
     */
    fun escapeMarkdown(text: String): String = text.split('\n').joinToString("\n") { line ->
        val indent = line.length - line.trimStart().length
        val head = line.substring(0, indent)
        val rest = line.substring(indent)
        when {
            rest.isEmpty() -> line
            rest[0] in "#>-+*" -> "$head\\$rest"
            setextEquals.matches(rest) -> "$head\\$rest"
            else -> orderedList.find(line)?.let { m ->
                val p = m.groups[3]!!.range.first
                line.substring(0, p) + "\\" + line.substring(p)
            } ?: line
        }
    }
}
