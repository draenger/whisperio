package ai.whisperio.core

import java.io.File

/**
 * Public surface of :core that :app codes against (docs/android/CONTRACT.md §4).
 * Implementations live next to this file; this file is the frozen interface between lanes.
 */

enum class ProviderId(val wire: String, val isCloud: Boolean) {
    OPENAI("openai", true),
    GROQ("groq", true),
    MISTRAL("mistral", true),
    ELEVENLABS("elevenlabs", true),
    DEEPGRAM("deepgram", true),
    ASSEMBLYAI("assemblyai", true),
    // Self-hosted counts as cloud for the consent gate: audio still leaves the device.
    SELFHOSTED("selfhosted", true);

    companion object {
        fun fromWire(value: String): ProviderId? = entries.firstOrNull { it.wire == value }
    }
}

/** One configured slot in the provider order (iOS `modelOrder`). */
data class ProviderConfig(
    val id: ProviderId,
    val model: String,
    /** API key; null/blank = not configured (self-hosted may legitimately run without one). */
    val apiKey: String?,
    /** OpenAI custom base URL or self-hosted URL; null = provider default. */
    val baseUrl: String? = null,
)

data class TranscriptionRequest(
    val audio: File,
    /** ISO code, or "auto"/blank to let the provider detect. */
    val language: String,
    /** Comma-separated custom vocabulary (iOS `vocabulary`); blank = none. */
    val vocabulary: String = "",
)

data class TranscriptionResult(
    val text: String,
    val provider: ProviderId,
    val model: String,
)

interface TranscriptionProvider {
    val id: ProviderId
    /** False when the provider lacks its key/URL; the chain skips such slots (iOS `isConfigured`). */
    val isConfigured: Boolean get() = true

    /** Throws [ProviderError] on any failure. */
    suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult
}

sealed class KeyValidation {
    data object Valid : KeyValidation()
    data object InvalidKey : KeyValidation()
    data class Unexpected(val status: Int) : KeyValidation()
    data class Network(val message: String) : KeyValidation()
    data class InvalidUrl(val message: String) : KeyValidation()
}

/** Settings slice the chain needs; :app maps its persisted settings onto this. */
data class ChainSettings(
    val order: List<ProviderConfig>,
    val fallbackEnabled: Boolean = false,
    val cloudConsentGranted: Boolean = false,
)
