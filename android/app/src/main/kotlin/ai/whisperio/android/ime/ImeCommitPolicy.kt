package ai.whisperio.android.ime

import android.text.InputType
import android.view.inputmethod.EditorInfo

/** Identity of the bound text field: `EditorInfo.fieldId` + `packageName` (CONTRACT 5). */
data class FieldKey(val fieldId: Int, val packageName: String?)

/**
 * What a dictation was started in: the monotonic input-session counter (bumped on every new input start and on
 * finish, so it changes even when two fields share a `fieldId`, as in Compose screens / WebViews) plus the field key.
 */
data class InputSession(val counter: Long, val key: FieldKey?)

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

    /**
     * Commit only if the input session is unchanged (counter), the bound field is not a password field and the input
     * view is still shown; otherwise the result stays in history as "not inserted". `fieldId` alone is not trusted.
     */
    fun canCommit(started: InputSession?, current: InputSession, currentIsPassword: Boolean, inputViewShown: Boolean): Boolean =
        started != null &&
            started.counter == current.counter &&
            started.key != null && started.key == current.key &&
            !currentIsPassword &&
            inputViewShown

    /** Backspace removes the selection if there is one (selection tracked via onUpdateSelection), else one code point. */
    fun backspaceDeletesSelection(selStart: Int, selEnd: Int): Boolean = selStart >= 0 && selEnd >= 0 && selStart != selEnd
}
