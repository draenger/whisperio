package ai.whisperio.android.dictation

import ai.whisperio.android.audio.AudioFocusGate
import ai.whisperio.android.audio.AudioRecorder
import ai.whisperio.android.audio.Levels
import ai.whisperio.android.di.TextTidy
import ai.whisperio.android.di.Transcriber
import ai.whisperio.android.di.UploadTooLargeException
import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.SettingsSource
import ai.whisperio.android.settings.isProviderConfigured
import ai.whisperio.core.TranscriptionRequest
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class DictationError {
    PERMISSION_MISSING,
    CONSENT_MISSING,
    NO_KEY,
    SILENT_MIC,
    NO_SPEECH,
    TOO_LARGE,
    RECORDER_FAILED,
    NO_AUDIO,
    PROVIDER,
}

sealed interface DictationState {
    data object Idle : DictationState

    /** [level] is 0..1; [nearLimit] is true from minute 55 of the 60-minute cap. */
    data class Recording(
        val level: Float,
        val elapsedMs: Long,
        val nearLimit: Boolean,
        val source: RecordingSource,
    ) : DictationState

    data class Transcribing(val source: RecordingSource) : DictationState

    data class Done(val text: String, val recordingId: String?, val source: RecordingSource) : DictationState

    /** [detail] is the provider message (already redacted by :core) for [DictationError.PROVIDER]. */
    data class Error(val error: DictationError, val detail: String? = null, val recordingId: String? = null) : DictationState
}

data class StartOptions(
    val source: RecordingSource,
    /** false = no history row and no kept audio (IME_FLAG_NO_PERSONALIZED_LEARNING fields). */
    val saveToHistory: Boolean = true,
    /** Opaque caller tag (the IME stores the bound field here) echoed in [DictationResult]. */
    val session: Any? = null,
)

data class DictationResult(
    val recordingId: String?,
    val text: String,
    val source: RecordingSource,
    val session: Any?,
)

/**
 * App-scoped dictation state machine: Idle -> Recording -> Transcribing -> Done / Error. Lives in [AppGraph], so
 * rotation, IME re-binds and Activity death never restart or lose an upload (CONTRACT 5, 6). All state changes run on
 * [scope], which must be single-threaded (production: Default.limitedParallelism(1)).
 */
class DictationController(
    private val scope: CoroutineScope,
    private val recorder: AudioRecorder,
    private val focus: AudioFocusGate,
    private val transcriber: Transcriber,
    private val settings: SettingsSource,
    private val history: HistoryStore,
    private val tidy: TextTidy,
    private val recordingsDir: File,
    private val micGranted: () -> Boolean,
    /** Monotonic milliseconds (tests: virtual time). */
    private val nowMs: () -> Long,
    private val wallClockMs: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val pollMs: Long = POLL_MS,
) {
    private val _state = MutableStateFlow<DictationState>(DictationState.Idle)
    val state: StateFlow<DictationState> = _state.asStateFlow()

    private val _results = MutableSharedFlow<DictationResult>(extraBufferCapacity = 8)
    val results: SharedFlow<DictationResult> = _results.asSharedFlow()

    private var session: Job? = null
    private var stopRequested = false
    private var currentId: String? = null
    private var currentFile: File? = null
    private var currentPersist = true

    /** The caller tag of the active session (the IME stores the bound field here); null for retries. */
    private var currentSessionTag: Any? = null

    private val busy get() = _state.value.let { it is DictationState.Recording || it is DictationState.Transcribing }

    fun start(options: StartOptions) {
        scope.launch { startInternal(options) }
    }

    /** Ends the recording and transcribes it. No-op unless recording. */
    fun stopAndTranscribe() {
        scope.launch { if (_state.value is DictationState.Recording) stopRequested = true }
    }

    /** Stops the recording and throws everything away (focus lost, Activity left). Transcription in flight is kept. */
    fun cancel() {
        scope.launch {
            if (_state.value !is DictationState.Recording) return@launch
            session?.cancel()
            session = null
            recorder.release()
            focus.abandon()
            val id = currentId
            currentFile?.delete()
            if (id != null && currentPersist) history.delete(id)
            _state.value = DictationState.Idle
        }
    }

    /** Dismisses a terminal Done / Error state. */
    fun acknowledge() {
        scope.launch {
            if (_state.value is DictationState.Done || _state.value is DictationState.Error) _state.value = DictationState.Idle
        }
    }

    fun markInserted(recordingId: String, inserted: Boolean) {
        scope.launch { history.setInserted(recordingId, inserted) }
    }

    /** Re-runs transcription for a saved clip (history "Retry"). */
    fun retry(recordingId: String) {
        scope.launch {
            if (busy) return@launch
            val row = history.get(recordingId) ?: return@launch
            val file = row.audioPath?.let(::File)?.takeIf { it.exists() }
            if (file == null) {
                _state.value = DictationState.Error(DictationError.NO_AUDIO, recordingId = recordingId)
                return@launch
            }
            val s = settings.current()
            precheck(s)?.let { _state.value = DictationState.Error(it, recordingId = recordingId); return@launch }
            currentId = recordingId
            currentFile = file
            currentPersist = true
            currentSessionTag = null
            session = scope.launch { transcribe(row, file, row.durationMs, s) }
        }
    }

    private suspend fun precheck(s: AppSettings): DictationError? {
        if (!micGranted()) return DictationError.PERMISSION_MISSING
        if (!s.cloudConsentGranted) return DictationError.CONSENT_MISSING
        val first = settings.chain().order.firstOrNull()
        if (first == null || !isProviderConfigured(first.id, first.apiKey, first.baseUrl)) return DictationError.NO_KEY
        return null
    }

    private suspend fun startInternal(options: StartOptions) {
        if (busy) return
        val s = settings.current()
        // Retry does not need the mic; recording does. precheck() covers both, so check the mic only here.
        if (!micGranted()) return fail(DictationError.PERMISSION_MISSING)
        precheck(s)?.let { return fail(it) }
        val first = settings.chain().order.first()

        val id = newId()
        val file = File(recordingsDir, "$id.m4a")
        recordingsDir.mkdirs()
        if (!focus.request { onFocusLost() }) return fail(DictationError.RECORDER_FAILED)
        try {
            recorder.start(file)
        } catch (_: Throwable) {
            focus.abandon()
            file.delete()
            return fail(DictationError.RECORDER_FAILED)
        }
        recorder.maxAmplitude() // first read is always 0; discard it

        currentId = id
        currentFile = file
        currentPersist = options.saveToHistory
        currentSessionTag = options.session
        stopRequested = false
        val row = Recording(
            id = id,
            createdAt = wallClockMs(),
            durationMs = 0,
            status = RecordingStatus.RECORDING,
            provider = first.id.wire,
            model = first.model,
            language = s.language,
            audioPath = file.path,
            source = options.source,
            inserted = if (options.source == RecordingSource.KEYBOARD) false else null,
        )
        if (options.saveToHistory) history.upsert(row)
        _state.value = DictationState.Recording(0f, 0, false, options.source)

        session = scope.launch { recordLoop(row, s, options) }
    }

    private fun onFocusLost() {
        // Audio focus loss: finish what we have and transcribe it (iOS default behaviour is "stop").
        scope.launch { if (_state.value is DictationState.Recording) stopRequested = true }
    }

    private suspend fun recordLoop(row: Recording, s: AppSettings, options: StartOptions) {
        val file = File(row.audioPath!!)
        val t0 = nowMs()
        var sawSignal = false
        var heardSpeech = false
        var lastActive = t0
        var elapsed = 0L
        while (true) {
            delay(pollMs)
            val now = nowMs()
            elapsed = now - t0
            val amp = recorder.maxAmplitude()
            if (amp > 0) sawSignal = true
            val db = Levels.dbfs(amp)
            if (db > ACTIVE_DB) {
                heardSpeech = true
                lastActive = now
            }
            _state.value = DictationState.Recording(Levels.normalized(db), elapsed, elapsed >= WARN_MS, options.source)
            if (!sawSignal && elapsed >= SILENT_GUARD_MS) break
            if (elapsed >= CAP_MS) break
            if (s.autoStopSeconds > 0 && heardSpeech && now - lastActive >= s.autoStopSeconds * 1000L) break
            if (stopRequested) break
        }
        val usable = recorder.stop()
        focus.abandon()
        when {
            !sawSignal -> failRecording(row, file, elapsed, DictationError.SILENT_MIC, options.saveToHistory)
            !usable -> failRecording(row, file, elapsed, DictationError.NO_SPEECH, options.saveToHistory)
            else -> transcribe(row, file, elapsed, s)
        }
    }

    /** No upload happens for a silent or unusable clip; the audio is discarded. */
    private suspend fun failRecording(row: Recording, file: File, elapsed: Long, error: DictationError, persist: Boolean) {
        file.delete()
        if (persist) {
            history.upsert(
                row.copy(status = RecordingStatus.FAILED, durationMs = elapsed, error = error.name, audioPath = null),
            )
        }
        _state.value = DictationState.Error(error, recordingId = if (persist) row.id else null)
    }

    private suspend fun transcribe(row: Recording, file: File, durationMs: Long, s: AppSettings) {
        val persist = currentPersist
        val src = row.source
        _state.value = DictationState.Transcribing(src)
        if (persist) history.upsert(row.copy(status = RecordingStatus.TRANSCRIBING, durationMs = durationMs, error = null))
        val rid = if (persist) row.id else null
        try {
            val chain = settings.chain()
            val res = transcriber.transcribe(TranscriptionRequest(file, s.language, s.vocabulary), chain)
            var text = res.text.trim()
            if (s.cleanupEnabled && text.isNotEmpty()) text = tidy.tidy(text).trim()
            if (text.isEmpty()) return failTranscription(row, durationMs, DictationError.NO_SPEECH, null, persist, file)
            val keep = persist && s.keepAudio
            if (!keep) file.delete()
            if (persist) {
                history.upsert(
                    row.copy(
                        status = RecordingStatus.DONE,
                        durationMs = durationMs,
                        provider = res.provider.wire,
                        model = res.model,
                        transcript = text,
                        error = null,
                        audioPath = if (keep) file.path else null,
                    ),
                )
            }
            _state.value = DictationState.Done(text, rid, src)
            _results.emit(DictationResult(rid, text, src, currentSessionTag))
        } catch (e: CancellationException) {
            throw e
        } catch (_: UploadTooLargeException) {
            // The size limit is enforced by :core; the port maps it so the UI keeps its dedicated message.
            failTranscription(row, durationMs, DictationError.TOO_LARGE, null, persist, file)
        } catch (t: Throwable) {
            failTranscription(row, durationMs, DictationError.PROVIDER, t.message?.take(MAX_ERROR_CHARS), persist, file)
        }
    }

    private suspend fun failTranscription(
        row: Recording,
        durationMs: Long,
        error: DictationError,
        detail: String?,
        persist: Boolean,
        file: File,
    ) {
        if (persist) {
            // Keep the audio on failure so the user can retry from history.
            history.upsert(
                row.copy(
                    status = RecordingStatus.FAILED,
                    durationMs = durationMs,
                    error = detail ?: error.name,
                    audioPath = file.path.takeIf { file.exists() },
                ),
            )
        } else {
            file.delete()
        }
        _state.value = DictationState.Error(error, detail, if (persist) row.id else null)
    }

    private fun fail(error: DictationError) {
        _state.value = DictationState.Error(error)
    }

    companion object {
        const val POLL_MS = 50L
        const val SILENT_GUARD_MS = 3_000L
        const val WARN_MS = 55 * 60_000L
        const val CAP_MS = 60 * 60_000L
        /** dBFS above which the mic counts as active speech (iOS meter threshold region). */
        const val ACTIVE_DB = -45f
        const val MAX_ERROR_CHARS = 200
    }
}
