package ai.whisperio.android.dictate

import ai.whisperio.android.MainActivity
import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.graph
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ui.common.confirmHaptic
import ai.whisperio.android.ui.theme.WhisperioTheme
import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch

/**
 * Translucent record-and-copy surface for the QS tile, the launcher shortcut and the home-screen widget (CONTRACT 6). All state lives in
 * the app-scoped DictationController, so rotation never restarts an upload.
 */
class DictateActivity : ComponentActivity() {

    private var source = RecordingSource.TILE

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        // Granted or not, start(): a refusal surfaces as the controller PERMISSION_MISSING error state.
        startDictation()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        source = sourceFor(intent?.getStringExtra(EXTRA_SOURCE))
        val controller = graph.dictation

        setContent {
            WhisperioTheme {
                val state by controller.state.collectAsState()
                DictateScreen(
                    state = state,
                    onStop = controller::stopAndTranscribe,
                    onCancel = { controller.cancel(); finish() },
                    onClose = { controller.acknowledge(); finish() },
                    onOpenApp = {
                        controller.acknowledge()
                        startActivity(Intent(this, MainActivity::class.java))
                        finish()
                    },
                    onRetry = { begin() },
                    needsSetup = state.let { it is DictationState.Error && it.error in SETUP_ERRORS },
                )
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                controller.results.collect { r ->
                    // The clipboard copy itself is done app-scoped (AppGraph.installDictateClipboard), so it also
                    // happens when this screen is already gone; the haptic only makes sense while we are visible.
                    if (r.session == SESSION_TAG) window.decorView.confirmHaptic()
                }
            }
        }

        // A recreation (rotation) must not start a second recording.
        if (savedInstanceState == null) begin()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        source = sourceFor(intent?.getStringExtra(EXTRA_SOURCE))
        if (graph.dictation.state.value.let { it is DictationState.Idle || it is DictationState.Done || it is DictationState.Error }) begin()
    }

    override fun onStop() {
        super.onStop()
        // Leaving the screen ends the recording (no foreground service, CONTRACT 6); a rotation does not.
        val s = graph.dictation.state.value
        if (!isChangingConfigurations && s is DictationState.Recording && s.source == source) graph.dictation.cancel()
    }

    private fun begin() {
        if (graph.micGranted()) startDictation() else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun startDictation() {
        graph.dictation.start(StartOptions(source = source, saveToHistory = true, session = SESSION_TAG))
    }

    companion object {
        const val EXTRA_SOURCE = "source"
        const val SESSION_TAG = "dictate-activity"

        /** Intent extra -> source; "shortcut" and "widget" are exact matches, anything else (tile, null, garbage) is the tile. */
        internal fun sourceFor(extra: String?): RecordingSource = when (extra) {
            "shortcut" -> RecordingSource.SHORTCUT
            "widget" -> RecordingSource.WIDGET
            else -> RecordingSource.TILE
        }

        private val SETUP_ERRORS = setOf(DictationError.CONSENT_MISSING, DictationError.NO_KEY, DictationError.PERMISSION_MISSING)
    }
}
