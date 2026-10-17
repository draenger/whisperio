package ai.whisperio.android.ime

import android.text.InputType
import android.view.inputmethod.EditorInfo

/** Identity of the bound text field: `EditorInfo.fieldId` + `packageName` (CONTRACT 5). */
data class FieldKey(val fieldId: Int, val packageName: String?)

sealed interface EnterAction {
    /** Insert a newline key press. */
    data object Newline : EnterAction

    /** `InputConnection.performEditorAction(code)`. */
    data class Editor(val code: Int) : EnterAction
}

/**
 * Pure IME decisions, no Android runtime needed (constants are compile-time inlined), so they run as plain JUnit.
 * Privacy rules from CONTRACT 5 live here: password fields disable the mic, NO_PERSONALIZED_LEARNING skips history.
 */
object ImeCommitPolicy {

    fun isPasswordField(inputType: Int): Boolean {
        val cls = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (cls) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    /** IME_FLAG_NO_PERSONALIZED_LEARNING (incognito): dictation allowed, history off. */
    fun isNoPersonalizedLearning(imeOptions: Int): Boolean =
        imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0

    fun shouldSaveToHistory(imeOptions: Int): Boolean = !isNoPersonalizedLearning(imeOptions)

    fun fieldKey(info: EditorInfo?): FieldKey? = info?.let { FieldKey(it.fieldId, it.packageName) }

    /** Enter respects the field action (Send, Go, Search, ...); plain multi-line fields get a newline. */
    fun enterAction(imeOptions: Int): EnterAction {
        val action = imeOptions and EditorInfo.IME_MASK_ACTION
        val noEnterAction = imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION != 0
        return if (noEnterAction || action == EditorInfo.IME_ACTION_NONE || action == EditorInfo.IME_ACTION_UNSPECIFIED) {
            EnterAction.Newline
        } else {
            EnterAction.Editor(action)
        }
    }

    /** Leading space when the character before the cursor is not whitespace (and the transcript has none). */
    fun textToCommit(transcript: String, charBeforeCursor: CharSequence?): String {
        val text = transcript.trim()
        if (text.isEmpty()) return ""
        val before = charBeforeCursor?.lastOrNull()
        return if (before != null && !before.isWhitespace()) " $text" else text
    }

    /** Commit only if the very same field is still bound; otherwise the result is saved as "not inserted". */
    fun canCommit(started: FieldKey?, current: FieldKey?): Boolean =
        started != null && current != null && started == current

    /** Backspace removes the selection if there is one, else one code point before the cursor. */
    fun backspaceDeletesSelection(selectedText: CharSequence?): Boolean = !selectedText.isNullOrEmpty()
}
