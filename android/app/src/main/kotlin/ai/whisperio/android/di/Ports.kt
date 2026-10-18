package ai.whisperio.android.di

import ai.whisperio.core.ChainSettings
import ai.whisperio.core.KeyValidation
import ai.whisperio.core.ProviderId
import ai.whisperio.core.TranscriptionRequest
import ai.whisperio.core.TranscriptionResult

/**
 * Seams between :app and :core. The app only depends on these; [CoreTranscriber] and friends in CoreAdapters.kt are
 * the single place that touches :core implementation classes, so tests substitute fakes and name drift is a
 * one-file fix.
 */
/** The recording exceeds the provider upload limit (enforced by :core, mapped here so :app never sees core errors). */
class UploadTooLargeException(message: String?) : Exception(message)

interface Transcriber {
    /** Throws on failure; the message is already redacted by :core (CONTRACT 4.2). Oversize audio throws [UploadTooLargeException]. */
    suspend fun transcribe(req: TranscriptionRequest, settings: ChainSettings): TranscriptionResult
}

interface KeyChecker {
    suspend fun validate(id: ProviderId, key: String?, baseUrl: String?): KeyValidation
}

interface ModelCatalog {
    fun defaultModel(id: ProviderId): String
    fun models(id: ProviderId): List<String>
}

fun interface TextTidy {
    fun tidy(text: String): String
}

fun interface HostPolicy {
    fun isOfficialHost(url: String): Boolean
}
