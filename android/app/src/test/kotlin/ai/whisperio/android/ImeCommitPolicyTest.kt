package ai.whisperio.android

import ai.whisperio.android.ime.EnterAction
import ai.whisperio.android.ime.FieldKey
import ai.whisperio.android.ime.ImeCommitPolicy
import ai.whisperio.android.ime.InputSession
import android.text.InputType
import android.view.inputmethod.EditorInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImeCommitPolicyTest {

    @Test fun leadingSpaceWhenPreviousCharIsNotWhitespace() {
        assertEquals(" hello", ImeCommitPolicy.textToCommit("hello", "a"))
        assertEquals(" hello", ImeCommitPolicy.textToCommit("  hello \n", "."))
    }

    @Test fun noLeadingSpaceAtStartOrAfterWhitespace() {
        assertEquals("hello", ImeCommitPolicy.textToCommit("hello", null))
        assertEquals("hello", ImeCommitPolicy.textToCommit("hello", ""))
        assertEquals("hello", ImeCommitPolicy.textToCommit("hello", " "))
        assertEquals("hello", ImeCommitPolicy.textToCommit("hello", "\n"))
    }

    @Test fun blankTranscriptCommitsNothing() {
        assertEquals("", ImeCommitPolicy.textToCommit("   ", "a"))
    }

    @Test fun passwordVariationsAreDetected() {
        val text = InputType.TYPE_CLASS_TEXT
        assertTrue(ImeCommitPolicy.isPasswordField(text or InputType.TYPE_TEXT_VARIATION_PASSWORD))
        assertTrue(ImeCommitPolicy.isPasswordField(text or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD))
        assertTrue(ImeCommitPolicy.isPasswordField(text or InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD))
        assertTrue(ImeCommitPolicy.isPasswordField(InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD))
    }

    @Test fun ordinaryFieldsAreNotPasswords() {
        assertFalse(ImeCommitPolicy.isPasswordField(InputType.TYPE_CLASS_TEXT))
        assertFalse(ImeCommitPolicy.isPasswordField(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS))
        assertFalse(ImeCommitPolicy.isPasswordField(InputType.TYPE_CLASS_NUMBER))
        assertFalse(ImeCommitPolicy.isPasswordField(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE))
    }

    @Test fun incognitoFieldsSkipHistory() {
        assertFalse(ImeCommitPolicy.shouldSaveToHistory(EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING))
        assertFalse(ImeCommitPolicy.shouldSaveToHistory(EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING))
        assertTrue(ImeCommitPolicy.shouldSaveToHistory(EditorInfo.IME_ACTION_SEND))
        assertTrue(ImeCommitPolicy.shouldSaveToHistory(0))
    }

    @Test fun enterUsesFieldActionOrNewline() {
        assertEquals(EnterAction.Editor(EditorInfo.IME_ACTION_SEND), ImeCommitPolicy.enterAction(EditorInfo.IME_ACTION_SEND))
        assertEquals(EnterAction.Editor(EditorInfo.IME_ACTION_SEARCH), ImeCommitPolicy.enterAction(EditorInfo.IME_ACTION_SEARCH))
        assertEquals(EnterAction.Newline, ImeCommitPolicy.enterAction(EditorInfo.IME_ACTION_NONE))
        assertEquals(EnterAction.Newline, ImeCommitPolicy.enterAction(EditorInfo.IME_ACTION_UNSPECIFIED))
        assertEquals(EnterAction.Newline, ImeCommitPolicy.enterAction(EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_ENTER_ACTION))
    }

    private val key = FieldKey(10, "com.example.chat")
    private val started = InputSession(5, key)

    @Test fun sameSessionCommits() {
        assertTrue(ImeCommitPolicy.canCommit(started, InputSession(5, FieldKey(10, "com.example.chat")), false, true))
    }

    @Test fun changedSessionNeverCommitsEvenWithSameFieldId() {
        assertFalse(ImeCommitPolicy.canCommit(started, InputSession(6, key), false, true))
    }

    @Test fun differentFieldKeyDoesNotCommit() {
        assertFalse(ImeCommitPolicy.canCommit(started, InputSession(5, FieldKey(11, "com.example.chat")), false, true))
        assertFalse(ImeCommitPolicy.canCommit(started, InputSession(5, FieldKey(10, "com.other")), false, true))
        assertFalse(ImeCommitPolicy.canCommit(started, InputSession(5, null), false, true))
        assertFalse(ImeCommitPolicy.canCommit(InputSession(5, null), InputSession(5, null), false, true))
        assertFalse(ImeCommitPolicy.canCommit(null, InputSession(5, key), false, true))
    }

    @Test fun passwordFieldNeverCommits() {
        assertFalse(ImeCommitPolicy.canCommit(started, InputSession(5, key), true, true))
    }

    @Test fun hiddenInputViewNeverCommits() {
        assertFalse(ImeCommitPolicy.canCommit(started, InputSession(5, key), false, false))
    }

    @Test fun backspaceDeletesSelectionFirst() {
        assertTrue(ImeCommitPolicy.backspaceDeletesSelection(2, 5))
        assertTrue(ImeCommitPolicy.backspaceDeletesSelection(5, 2))
        assertFalse(ImeCommitPolicy.backspaceDeletesSelection(3, 3))
        assertFalse(ImeCommitPolicy.backspaceDeletesSelection(-1, -1))
    }
}
