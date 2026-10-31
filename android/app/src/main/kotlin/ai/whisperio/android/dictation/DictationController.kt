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
import ai.whisperio.android.security.AudioCipher
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.SettingsSource
import ai.whisperio.android.settings.isProviderConfigured
import ai.whisperio.core.ChainSettings
import ai.whisperio.core.ProviderError
import ai.whisperio.core.ProviderId
import ai.whisperio.core.TranscriptionRequest
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
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
    /** One-shot language override (per-app language, F7); null = the global setting. */
    val language: String? = null,
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
    /** Encrypts kept clips to `<id>.m4a.wea` (opt-in setting); null = clips stay plain. */
    private val audioCipher: AudioCipher? = null,
    /** Asked once per kept clip: is "Encrypt history and recordings" ON right now? */
    private val encryptAudio: suspend () -> Boolean = { false },
) {
    private val _state = MutableStateFlow<DictationState>(DictationState.Idle)
    val state: StateFlow<DictationState> = _state.asStateFlow()

    private val _results = MutableSharedFlow<DictationResult>(extraBufferCapacity = 8)
    val results: SharedFlow<DictationResult> = _results.asSharedFlow()

    private val _retryOutcomes = MutableSharedFlow<RetryOutcome>(extraBufferCapacity = 8)

    /** Result of every [retryWith] attempt (the history detail shows failures as a snackbar). */
    val retryOutcomes: SharedFlow<RetryOutcome> = _retryOutcomes.asSharedFlow()

    private var session: Job? = null
    private var stopRequested = false
    private var currentId: String? = null
    @Volatile private var currentFile: File? = null
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

    /** The audio file of the active session, if any (maintenance sweeps must not touch it). */
    fun activeFile(): File? = currentFile

    /** Id of the history row of the active recording/transcription, null when idle (or no-history mode). */
    fun activeId(): String? = if (busy && currentPersist) currentId else null

    /**
     * Hard stop for "Erase all data": in ANY busy state cancels the session job (which cancels the in-flight upload),
     * waits for it to finish so no later history write can happen, deletes the current file and returns to Idle.
     * Must be called from [scope] (single-threaded) so it is serialised with every other state change.
     */
    suspend fun abortAll() {
        val job = session
        session = null
        job?.cancelAndJoin()
        recorder.release()
        focus.abandon()
        currentFile?.delete()
        currentFile = null
        currentId = null
        _state.value = DictationState.Idle
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
            // An encrypted clip is uploaded from a short-lived plaintext copy; the stored `.wea` row stays as it is.
            val encrypted = AudioCipher.isEncrypted(file.path)
            val upload = if (encrypted) retryTemp(recordingId) else file
            currentId = recordingId
            currentFile = upload
            currentPersist = true
            currentSessionTag = null
            // Busy before the launch so a queued start() cannot slip past the busy check. APP: a retried KEYBOARD/TILE
            // row must not show up as transcribing in the keyboard / DictateActivity (the stored source is unchanged).
            _state.value = DictationState.Transcribing(RecordingSource.APP)
            session = scope.launch {
                try {
                    if (encrypted && !decryptForRetry(recordingId, file, upload)) {
                        _state.value = DictationState.Error(DictationError.NO_AUDIO, recordingId = recordingId)
                        return@launch
                    }
                    transcribe(row, upload, row.durationMs, s, RecordingSource.APP, retained = file.takeIf { encrypted })
                } finally {
                    if (encrypted) upload.delete()
                }
            }
        }
    }

    /**
     * CONTRACT-1.1 F5: re-runs a saved clip with ONE chosen provider (no fallback chain; same consent gate and the
     * provider upload limit as a normal run). On success the transcript, provider and model are replaced; on any
     * failure the stored row (text, status, audio) is left exactly as it was and only [retryOutcomes] reports it.
     */
    fun retryWith(recordingId: String, providerId: ProviderId) {
        scope.launch {
            if (busy) return@launch
            val row = history.get(recordingId) ?: return@launch
            val file = row.audioPath?.let(::File)?.takeIf { it.exists() }
                ?: return@launch retryFailed(recordingId, DictationError.NO_AUDIO)
            val s = settings.current()
            if (!s.cloudConsentGranted) return@launch retryFailed(recordingId, DictationError.CONSENT_MISSING)
            val single = singleProviderChain(settings.chain(), providerId)
                ?: return@launch retryFailed(recordingId, DictationError.NO_KEY)
            val encrypted = AudioCipher.isEncrypted(file.path)
            val upload = if (encrypted) retryTemp(recordingId) else file
            currentId = recordingId
            currentFile = upload
            currentPersist = true
            currentSessionTag = null
            _state.value = DictationState.Transcribing(RecordingSource.APP) // before the launch, see retry()
            session = scope.launch {
                try {
                    if (encrypted && !decryptForRetry(recordingId, file, upload)) {
                        _state.value = DictationState.Idle
                        return@launch retryFailed(recordingId, DictationError.NO_AUDIO)
                    }
                    transcribeWith(row, upload, s, single)
                } finally {
                    if (encrypted) upload.delete()
                }
            }
        }
    }

    private fun retryTemp(recordingId: String) = File(recordingsDir, "$recordingId.retry.m4a")

    /** Plaintext copy of an encrypted clip for one upload. False (nothing left behind) when the key is gone or the clip is unreadable. */
    private suspend fun decryptForRetry(recordingId: String, stored: File, temp: File): Boolean {
        val cipher = audioCipher ?: return false
        return try {
            recordingsDir.mkdirs()
            cipher.decryptToFile(stored, temp, recordingId)
            true
        } catch (e: CancellationException) {
            temp.delete()
            throw e
        } catch (e: Exception) {
            temp.delete()
            false
        }
    }

    private suspend fun retryFailed(recordingId: String, error: DictationError, detail: String? = null) {
        _retryOutcomes.emit(RetryOutcome.Failure(recordingId, error, detail))
    }

    private suspend fun transcribeWith(row: Recording, file: File, s: AppSettings, single: ChainSettings) {
        try {
            val res = transcriber.transcribe(TranscriptionRequest(file, row.language, s.vocabulary), single)
            var text = res.text.trim()
            if (s.cleanupEnabled && text.isNotEmpty()) text = tidy.tidy(text).trim()
            if (text.isEmpty()) {
                _state.value = DictationState.Idle
                return retryFailed(row.id, DictationError.NO_SPEECH)
            }
            // Re-read right before writing: the entry may have been deleted (or changed) while the upload ran.
            val fresh = history.get(row.id)
            if (fresh == null) {
                _state.value = DictationState.Idle
                return
            }
            history.upsert(
                fresh.copy(status = RecordingStatus.DONE, provider = res.provider.wire, model = res.model, transcript = text, error = null),
            )
            _state.value = DictationState.Idle
            _retryOutcomes.emit(RetryOutcome.Success(row.id))
        } catch (e: CancellationException) {
            throw e
        } catch (_: UploadTooLargeException) {
            _state.value = DictationState.Idle
            retryFailed(row.id, DictationError.TOO_LARGE)
        } catch (t: Throwable) {
            _state.value = DictationState.Idle
            retryFailed(row.id, DictationError.PROVIDER, t.message?.let { ProviderError.redactSecrets(it) }?.take(MAX_ERROR_CHARS))
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
        val s = settings.current().let { base -> options.language?.let { base.copy(language = it) } ?: base }
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
            // Re-read before writing so a category set meanwhile (or a row deleted meanwhile) is not clobbered.
            writeBack(row) { it.copy(status = RecordingStatus.FAILED, durationMs = elapsed, error = error.name, audioPath = null) }
        }
        _state.value = DictationState.Error(error, recordingId = if (persist) row.id else null)
    }

    private suspend fun transcribe(
        row: Recording,
        file: File,
        durationMs: Long,
        s: AppSettings,
        src: RecordingSource = row.source,
        /** The stored `.wea` clip when [file] is only its temporary plaintext copy (retry). */
        retained: File? = null,
    ) {
        val persist = currentPersist
        _state.value = DictationState.Transcribing(src)
        if (persist) writeBack(row) { it.copy(status = RecordingStatus.TRANSCRIBING, durationMs = durationMs, error = null) }
        val rid = if (persist) row.id else null
        try {
            val chain = settings.chain()
            val res = transcriber.transcribe(TranscriptionRequest(file, s.language, s.vocabulary), chain)
            var text = res.text.trim()
            if (s.cleanupEnabled && text.isNotEmpty()) text = tidy.tidy(text).trim()
            if (text.isEmpty()) return failTranscription(row, durationMs, DictationError.NO_SPEECH, null, persist, file, retained)
            val keep = persist && s.keepAudio
            val keptPath = settleAudio(row.id, file, retained, keep)
            if (persist) {
                writeBack(row) {
                    it.copy(
                        status = RecordingStatus.DONE,
                        durationMs = durationMs,
                        provider = res.provider.wire,
                        model = res.model,
                        transcript = text,
                        error = null,
                        audioPath = settledAudioPath(row, it, keptPath),
                    )
                }
            }
            _state.value = DictationState.Done(text, rid, src)
            _results.emit(DictationResult(rid, text, src, currentSessionTag))
        } catch (e: CancellationException) {
            throw e
        } catch (_: UploadTooLargeException) {
            // The size limit is enforced by :core; the port maps it so the UI keeps its dedicated message.
            failTranscription(row, durationMs, DictationError.TOO_LARGE, null, persist, file, retained)
        } catch (t: Throwable) {
            failTranscription(row, durationMs, DictationError.PROVIDER, t.message?.let { ProviderError.redactSecrets(it) }?.take(MAX_ERROR_CHARS), persist, file, retained)
        }
    }

    private suspend fun failTranscription(
        row: Recording,
        durationMs: Long,
        error: DictationError,
        detail: String?,
        persist: Boolean,
        file: File,
        retained: File? = null,
    ) {
        val keepFile = persist && settings.current().keepAudio
        val keptPath = if (retained != null) {
            file.delete()
            if (keepFile && retained.exists()) retained.path else { retained.delete(); null }
        } else {
            if (!keepFile) file.delete()
            if (keepFile && file.exists()) sealClip(row.id, file) else null
        }
        if (persist) {
            // Keep the audio on failure (only when the user keeps audio) so they can retry from history.
            writeBack(row) {
                it.copy(
                    status = RecordingStatus.FAILED,
                    durationMs = durationMs,
                    error = detail ?: error.name,
                    audioPath = settledAudioPath(row, it, keptPath),
                )
            }
        }
        _state.value = DictationState.Error(error, detail, if (persist) row.id else null)
    }

    /** The path to store for a finished clip: [retained] when it is a retry, else the clip itself (sealed if ON), or null (not kept). */
    private suspend fun settleAudio(id: String, file: File, retained: File?, keep: Boolean): String? {
        if (retained != null) {
            file.delete()
            if (!keep) { retained.delete(); return null }
            return retained.path
        }
        if (!keep) { file.delete(); return null }
        return sealClip(id, file)
    }

    /**
     * Encrypts a kept clip to `<id>.m4a.wea` and deletes the plaintext, only when the setting is ON. If that fails
     * for any reason (Keystore) the plaintext clip stays and is what the row points at: audio is never lost, and
     * maintenance seals it later.
     */
    private suspend fun sealClip(id: String, file: File): String {
        val cipher = audioCipher ?: return file.path
        return try {
            if (!encryptAudio()) return file.path
            val enc = AudioCipher.encryptedFor(file)
            cipher.encryptFile(file, enc, id)
            file.delete()
            enc.path
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            file.path
        }
    }

    /**
     * The audio path to store when a run finishes. [started] is the row as the run began; if a migration re-pointed the
     * clip meanwhile ([fresh] no longer has the path the run started from) the fresh path wins, so a dead path is never
     * written. A null [kept] (clip not kept) always clears it. A file this run produced that is then unreferenced is
     * left for the orphan sweep.
     */
    private fun settledAudioPath(started: Recording, fresh: Recording, kept: String?): String? =
        if (kept == null) null else if (fresh.audioPath == started.audioPath) kept else fresh.audioPath

    /** Applies [change] to the CURRENT stored row; a row deleted meanwhile is never resurrected. */
    private suspend fun writeBack(row: Recording, change: (Recording) -> Recording) {
        val fresh = history.get(row.id) ?: return
        history.upsert(change(fresh))
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
