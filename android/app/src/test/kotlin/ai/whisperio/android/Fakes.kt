package ai.whisperio.android

import ai.whisperio.android.audio.AudioFocusGate
import ai.whisperio.android.audio.AudioRecorder
import ai.whisperio.android.di.KeyChecker
import ai.whisperio.android.di.ModelCatalog
import ai.whisperio.android.di.Transcriber
import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.security.SecretCipher
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.ProviderSlot
import ai.whisperio.android.settings.SettingsSource
import ai.whisperio.android.settings.toChainSettings
import ai.whisperio.core.ChainSettings
import ai.whisperio.core.KeyValidation
import ai.whisperio.core.ProviderId
import ai.whisperio.core.TranscriptionRequest
import ai.whisperio.core.TranscriptionResult
import java.io.File
import java.security.SecureRandom
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

class FakeRecorder(var amplitude: () -> Int = { 4000 }) : AudioRecorder {
    var started = 0
    var released = 0
    var failOnStart = false
    var usable = true
    private var file: File? = null

    override fun start(file: File) {
        if (failOnStart) error("mic busy")
        started++
        file.parentFile?.mkdirs()
        file.writeBytes(ByteArray(2048) { 1 })
        this.file = file
    }

    override fun maxAmplitude(): Int = amplitude()
    override fun stop(): Boolean = usable
    override fun release() { released++ }
}

class FakeFocus(var grant: Boolean = true) : AudioFocusGate {
    var onLost: (() -> Unit)? = null
    var abandoned = 0
    override fun request(onLost: () -> Unit): Boolean { this.onLost = onLost; return grant }
    override fun abandon() { abandoned++ }
}

class FakeTranscriber(
    var text: String = "hello world",
    var failure: Throwable? = null,
    var latencyMs: Long = 0,
) : Transcriber {
    val calls = mutableListOf<Pair<TranscriptionRequest, ChainSettings>>()
    override suspend fun transcribe(req: TranscriptionRequest, settings: ChainSettings): TranscriptionResult {
        calls += req to settings
        if (latencyMs > 0) kotlinx.coroutines.delay(latencyMs)
        failure?.let { throw it }
        return TranscriptionResult(text, settings.order.first().id, settings.order.first().model)
    }
}

class FakeSettings(
    var settings: AppSettings = defaultSettings(),
    var keys: Map<ProviderId, String?> = mapOf(ProviderId.OPENAI to "sk-test"),
) : SettingsSource {
    override suspend fun current() = settings
    override suspend fun chain(): ChainSettings = settings.toChainSettings(keys)

    companion object {
        fun defaultSettings() = AppSettings(
            order = listOf(ProviderSlot(ProviderId.OPENAI, "whisper-1"), ProviderSlot(ProviderId.GROQ, "whisper-large-v3-turbo")),
            cloudConsentGranted = true,
        )
    }
}

class FakeHistory : HistoryStore {
    val rows = MutableStateFlow<Map<String, Recording>>(emptyMap())
    override fun observeAll(): Flow<List<Recording>> = rows.map { it.values.sortedByDescending { r -> r.createdAt } }
    override fun observeRecent(limit: Int): Flow<List<Recording>> = observeAll().map { it.take(limit) }
    override fun observe(id: String): Flow<Recording?> = rows.map { it[id] }
    override suspend fun get(id: String) = rows.value[id]
    override suspend fun upsert(recording: Recording) { rows.value = rows.value + (recording.id to recording) }
    override suspend fun setInserted(id: String, inserted: Boolean) {
        rows.value[id]?.let { upsert(it.copy(inserted = inserted)) }
    }
    override suspend fun delete(id: String) {
        rows.value[id]?.audioPath?.let { File(it).delete() }
        rows.value = rows.value - id
    }
    override suspend fun sweepInterrupted(): Int {
        var n = 0
        rows.value = rows.value.mapValues { (_, r) ->
            if (r.status == RecordingStatus.RECORDING || r.status == RecordingStatus.TRANSCRIBING) {
                n++
                r.copy(status = RecordingStatus.FAILED, error = HistoryStore.INTERRUPTED)
            } else r
        }
        return n
    }
    override suspend fun deleteOlderThan(cutoffEpochMs: Long): Int {
        val old = rows.value.values.filter { it.createdAt < cutoffEpochMs }
        old.forEach { delete(it.id) }
        return old.size
    }
    override suspend fun deleteAllAudio() {
        rows.value.values.forEach { r -> r.audioPath?.let { File(it).delete() }; upsert(r.copy(audioPath = null)) }
    }
    override suspend fun clear() { rows.value.keys.toList().forEach { delete(it) } }
}

class FakeKeyChecker(var result: KeyValidation = KeyValidation.Valid) : KeyChecker {
    var calls = 0
    override suspend fun validate(id: ProviderId, key: String?, baseUrl: String?): KeyValidation { calls++; return result }
}

class FakeCatalog : ModelCatalog {
    override fun defaultModel(id: ProviderId) = "model-${id.wire}"
    override fun models(id: ProviderId) = listOf(defaultModel(id), "alt-${id.wire}")
}

/** Reversible cipher without a Keystore; [fail] makes every decrypt throw (invalidated key). */
class TestCipher(var fail: Boolean = false) : SecretCipher {
    private val rnd = SecureRandom()
    override fun encrypt(plain: ByteArray): ByteArray {
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        return iv + plain.map { (it.toInt() xor 0x5A).toByte() }.toByteArray()
    }
    override fun decrypt(blob: ByteArray): ByteArray {
        if (fail) error("key invalidated")
        return blob.copyOfRange(12, blob.size).map { (it.toInt() xor 0x5A).toByte() }.toByteArray()
    }
}
