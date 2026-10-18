package ai.whisperio.android.ime

import ai.whisperio.android.MainActivity
import ai.whisperio.android.dictation.DictationResult
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.dictation.primaryProvider
import ai.whisperio.android.graph
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ui.common.label
import ai.whisperio.android.ui.theme.WhisperioTheme
import android.content.Intent
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.coroutineScope
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.launch

/**
 * Dictation panel (CONTRACT 5). Records inside the IME process, hands the result to the app-scoped
 * DictationController and commits it only if the same field is still bound.
 *
 * A ComposeView inside an InputMethodService has no ViewTree owners by default, which crashes composition
 * ("ViewTreeLifecycleOwner not found"); the service therefore is its own Lifecycle/ViewModelStore/SavedState owner and
 * installs itself on the window decor view, which is the root the ComposeView walks up to.
 */
class WhisperioImeService : InputMethodService(), LifecycleOwner, ViewModelStoreOwner, SavedStateRegistryOwner {

    private val lifecycleRegistry = LifecycleRegistry(this)
    private val store = ViewModelStore()
    private val savedStateController = SavedStateRegistryController.create(this)

    override val lifecycle: Lifecycle get() = lifecycleRegistry
    override val viewModelStore: ViewModelStore get() = store
    override val savedStateRegistry: SavedStateRegistry get() = savedStateController.savedStateRegistry

    private data class FieldState(
        val key: FieldKey? = null,
        val password: Boolean = false,
        val imeOptions: Int = 0,
    )

    private val field = MutableStateFlow(FieldState())
    private val micGranted = MutableStateFlow(false)
    private val notInserted = MutableStateFlow(false)
    private val sessionCounter = InputSessionCounter()
    private var selStart = -1
    private var selEnd = -1
    private lateinit var panelState: StateFlow<ImePanelState>

    override fun onCreate() {
        super.onCreate()
        savedStateController.performAttach()
        savedStateController.performRestore(null)
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
        micGranted.value = graph.micGranted()

        val g = graph
        val statusFlow = g.setupStatus(micGranted)
        panelState = combine(
            g.dictation.state,
            field,
            statusFlow,
            g.settings.flow,
            combine(g.secrets.configured, notInserted) { keys, ni -> keys to ni },
        ) { dictation, f, status, settings, (keys, ni) ->
            val primary = settings.primaryProvider(keys) ?: settings.order.first().let { it.id to it.model }
            ImePanelState(
                dictation = dictation,
                passwordField = f.password,
                setupNeeded = !status.ready,
                providerLabel = "${primary.first.label(this)} - ${primary.second}",
                notInserted = ni,
            )
        }.stateIn(
            lifecycle.coroutineScope,
            SharingStarted.Eagerly,
            ImePanelState(DictationState.Idle, passwordField = false, setupNeeded = true, providerLabel = ""),
        )

        lifecycle.coroutineScope.launch {
            g.dictation.results.collect { handleResult(it) }
        }
    }

    override fun onCreateInputView(): View {
        // Pitfall: owners must be on the decor view, not only on the ComposeView.
        val decor = window.window!!.decorView
        decor.setViewTreeLifecycleOwner(this)
        decor.setViewTreeViewModelStoreOwner(this)
        decor.setViewTreeSavedStateRegistryOwner(this)
        return ComposeView(this).apply {
            setViewTreeLifecycleOwner(this@WhisperioImeService)
            setViewTreeViewModelStoreOwner(this@WhisperioImeService)
            setViewTreeSavedStateRegistryOwner(this@WhisperioImeService)
            setContent {
                WhisperioTheme {
                    val ui by panelState.collectAsState()
                    ImePanel(ui, actions)
                }
            }
        }
    }

    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        sessionCounter.onStartInput(restarting)
        if (!restarting) {
            selStart = -1
            selEnd = -1
        }
    }

    override fun onFinishInput() {
        sessionCounter.onFinishInput()
        super.onFinishInput()
    }

    override fun onUpdateSelection(
        oldSelStart: Int, oldSelEnd: Int, newSelStart: Int, newSelEnd: Int, candidatesStart: Int, candidatesEnd: Int,
    ) {
        super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
        selStart = newSelStart
        selEnd = newSelEnd
    }

    private fun currentSession() = InputSession(sessionCounter.value, ImeCommitPolicy.fieldKey(currentInputEditorInfo))

    override fun onEvaluateFullscreenMode(): Boolean = false

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        lifecycleRegistry.currentState = Lifecycle.State.RESUMED
        micGranted.value = graph.micGranted()
        field.value = FieldState(
            key = ImeCommitPolicy.fieldKey(info),
            password = info != null && ImeCommitPolicy.isPasswordField(info.inputType),
            imeOptions = info?.imeOptions ?: 0,
        )
        if (!restarting) {
            notInserted.value = false
            graph.dictation.acknowledge()
        }
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        super.onFinishInputView(finishingInput)
        // Focus lost / IME hidden while recording: stop and discard, no background recording (CONTRACT 5).
        val s = graph.dictation.state.value
        if (shouldCancelKeyboardRecording(s)) graph.dictation.cancel()
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
    }

    override fun onDestroy() {
        val s = graph.dictation.state.value
        if (s is DictationState.Recording && s.source == RecordingSource.KEYBOARD) graph.dictation.cancel()
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
        store.clear()
        super.onDestroy()
    }

    private val actions = ImePanelActions(
        onMic = ::onMic,
        onBackspace = ::onBackspace,
        onSpace = { currentInputConnection?.commitText(" ", 1) },
        onEnter = ::onEnter,
        onSwitchKeyboard = ::switchKeyboard,
        onOpenSetup = ::openSetup,
        onProviderChip = ::openSetup,
    )

    private fun onMic() {
        val controller = graph.dictation
        when (controller.state.value) {
            is DictationState.Recording -> controller.stopAndTranscribe()
            is DictationState.Transcribing -> Unit
            else -> {
                val f = field.value
                val options = keyboardStartOptions(f.password, f.imeOptions, currentSession()) ?: return // mic disabled in password fields
                micGranted.value = graph.micGranted()
                notInserted.value = false
                controller.start(options)
            }
        }
    }

    private fun handleResult(result: DictationResult) {
        val outcome = commitKeyboardResult(
            result, currentInputConnection, currentInputEditorInfo, currentSession(), isInputViewShown,
            markInserted = { graph.dictation.markInserted(it, true) },
            acknowledge = { graph.dictation.acknowledge() },
        ) ?: return
        notInserted.value = !outcome
        if (outcome && isVoiceSubtype()) switchBackAfterVoice()
    }

    private fun onBackspace() {
        val ic = currentInputConnection ?: return
        if (ImeCommitPolicy.backspaceDeletesSelection(selStart, selEnd)) {
            ic.commitText("", 1)
        } else if (!ic.deleteSurroundingTextInCodePoints(1, 0)) {
            sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL)
        }
    }

    private fun onEnter() {
        val ic = currentInputConnection ?: return
        when (val a = ImeCommitPolicy.enterAction(field.value.imeOptions)) {
            EnterAction.Newline -> sendDownUpKeyEvents(KeyEvent.KEYCODE_ENTER)
            is EnterAction.Editor -> ic.performEditorAction(a.code)
        }
    }

    private fun switchKeyboard() {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        if (Build.VERSION.SDK_INT >= 28) {
            if (!switchToPreviousInputMethod()) imm.showInputMethodPicker()
        } else {
            imm.showInputMethodPicker()
        }
    }

    private fun isVoiceSubtype(): Boolean {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        return imm.currentInputMethodSubtype?.mode == "voice"
    }

    @Suppress("DEPRECATION")
    private fun switchBackAfterVoice() {
        if (Build.VERSION.SDK_INT >= 28) {
            switchToPreviousInputMethod()
        } else {
            val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
            window.window?.attributes?.token?.let { imm.switchToLastInputMethod(it) }
        }
    }

    private fun openSetup() {
        startActivity(
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        )
    }
}

/** Input-session counter: bumped by a non-restarting start and by every finish (testable without a service host). */
internal class InputSessionCounter {
    var value = 0L
        private set

    fun onStartInput(restarting: Boolean) { if (!restarting) value++ }
    fun onFinishInput() { value++ }
}

/** Focus lost / IME hidden while the keyboard is recording: stop and discard (CONTRACT 5). */
internal fun shouldCancelKeyboardRecording(s: DictationState): Boolean =
    s is DictationState.Recording && s.source == RecordingSource.KEYBOARD

/**
 * Commits a keyboard transcript if [ImeCommitPolicy.canCommit] allows. Returns null when the result is not ours
 * (other source / retry without a session), true when committed, false when it must stay "not inserted".
 */
internal fun commitKeyboardResult(
    result: DictationResult,
    ic: InputConnection?,
    info: EditorInfo?,
    current: InputSession,
    inputViewShown: Boolean,
    markInserted: (String) -> Unit,
    acknowledge: () -> Unit,
): Boolean? {
    if (result.source != RecordingSource.KEYBOARD) return null
    val started = result.session as? InputSession ?: return null // retries from history carry no session
    val password = info == null || ImeCommitPolicy.isPasswordField(info.inputType)
    if (ic == null || !ImeCommitPolicy.canCommit(started, current, password, inputViewShown)) return false
    ic.commitText(ImeCommitPolicy.textToCommit(result.text, ic.getTextBeforeCursor(1, 0)), 1)
    result.recordingId?.let(markInserted)
    acknowledge()
    return true
}

/** Mic start options for the bound field; null in password fields (mic disabled). */
internal fun keyboardStartOptions(password: Boolean, imeOptions: Int, session: InputSession): StartOptions? =
    if (password) null else StartOptions(
        source = RecordingSource.KEYBOARD,
        saveToHistory = ImeCommitPolicy.shouldSaveToHistory(imeOptions),
        session = session,
    )
