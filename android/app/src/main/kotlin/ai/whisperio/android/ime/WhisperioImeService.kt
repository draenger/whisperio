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
        if (s is DictationState.Recording && s.source == RecordingSource.KEYBOARD) graph.dictation.cancel()
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
    }

    override fun onDestroy() {
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
                if (f.password) return // mic is disabled in password fields
                micGranted.value = graph.micGranted()
                notInserted.value = false
                controller.start(
                    StartOptions(
                        source = RecordingSource.KEYBOARD,
                        saveToHistory = ImeCommitPolicy.shouldSaveToHistory(f.imeOptions),
                        session = f.key,
                    ),
                )
            }
        }
    }

    private fun handleResult(result: DictationResult) {
        if (result.source != RecordingSource.KEYBOARD) return
        val started = result.session as? FieldKey ?: return // retries from history carry no session
        val ic = currentInputConnection
        val current = ImeCommitPolicy.fieldKey(currentInputEditorInfo)
        if (ic != null && ImeCommitPolicy.canCommit(started, current)) {
            val text = ImeCommitPolicy.textToCommit(result.text, ic.getTextBeforeCursor(1, 0))
            ic.commitText(text, 1)
            result.recordingId?.let { graph.dictation.markInserted(it, true) }
            notInserted.value = false
            graph.dictation.acknowledge()
            if (isVoiceSubtype()) switchBackAfterVoice()
        } else {
            // Field changed (or IME hidden) while transcribing: the history row stays "not inserted".
            notInserted.value = true
        }
    }

    private fun onBackspace() {
        val ic = currentInputConnection ?: return
        if (ImeCommitPolicy.backspaceDeletesSelection(ic.getSelectedText(0))) {
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
