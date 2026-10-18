package ai.whisperio.android.dictate

import ai.whisperio.android.MainActivity
import ai.whisperio.android.R
import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.graph
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ui.common.copyPlainText
import ai.whisperio.android.ui.theme.WhisperioTheme
import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
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
 * Translucent record-and-copy surface for the QS tile and the launcher shortcut (CONTRACT 6). All state lives in
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
        source = sourceFrom(intent)
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
                    if (r.session == SESSION_TAG) copyToClipboard(r.text)
                }
            }
        }

        // A recreation (rotation) must not start a second recording.
        if (savedInstanceState == null) begin()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        source = sourceFrom(intent)
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

    private fun copyToClipboard(text: String) {
        lifecycleScope.launch {
            val sensitive = graph.settings.current().transcriptsSensitive
            copyPlainText(this@DictateActivity, text, sensitive)
            // Android 13+ shows its own "copied" confirmation; older versions need ours.
            if (Build.VERSION.SDK_INT < 33) Toast.makeText(this@DictateActivity, R.string.copied_toast, Toast.LENGTH_SHORT).show()
        }
    }

    private fun sourceFrom(intent: Intent?): RecordingSource =
        if (intent?.getStringExtra(EXTRA_SOURCE) == "shortcut") RecordingSource.SHORTCUT else RecordingSource.TILE

    companion object {
        const val EXTRA_SOURCE = "source"
        const val SESSION_TAG = "dictate-activity"

        private val SETUP_ERRORS = setOf(DictationError.CONSENT_MISSING, DictationError.NO_KEY, DictationError.PERMISSION_MISSING)
    }
}
