package ai.whisperio.core

/** 25 MiB upload limit for OpenAI, Groq and Mistral (CONTRACT section 4.4). */
internal const val MAX_UPLOAD_BYTES: Long = 25L * 1024 * 1024

/** UI-facing description of one provider (CONTRACT section 4.1). */
data class ProviderInfo(
    val id: ProviderId,
    val displayName: String,
    val defaultModel: String,
    /** Model chips shown in settings; the first is the default. */
    val modelChips: List<String>,
    /** Default API base (self-hosted has none). */
    val defaultBaseUrl: String?,
    /** True when the custom vocabulary is sent to the provider. */
    val usesVocabulary: Boolean,
    /** Client-side upload limit in bytes; null means no limit (CONTRACT section 4.4). */
    val maxUploadBytes: Long? = null,
)

object ProviderCatalog {
    val all: List<ProviderInfo> = listOf(
        ProviderInfo(
            ProviderId.OPENAI, "OpenAI", "whisper-1",
            listOf("whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"),
            "https://api.openai.com/v1", usesVocabulary = true,
            maxUploadBytes = MAX_UPLOAD_BYTES,
        ),
        // iOS's retired distil-whisper-large-v3-en chip is dropped.
        ProviderInfo(
            ProviderId.GROQ, "Groq", "whisper-large-v3-turbo",
            listOf("whisper-large-v3-turbo", "whisper-large-v3"),
            "https://api.groq.com/openai/v1", usesVocabulary = true,
            maxUploadBytes = MAX_UPLOAD_BYTES,
        ),
        ProviderInfo(
            ProviderId.MISTRAL, "Mistral", "voxtral-small-latest",
            listOf("voxtral-small-latest", "voxtral-mini-latest"),
            "https://api.mistral.ai/v1", usesVocabulary = false,
            maxUploadBytes = MAX_UPLOAD_BYTES,
        ),
        ProviderInfo(
            ProviderId.ELEVENLABS, "ElevenLabs", "scribe_v1",
            listOf("scribe_v1", "scribe_v2"),
            "https://api.elevenlabs.io/v1", usesVocabulary = true, // as keyterms
            maxUploadBytes = 100L * 1024 * 1024,
        ),
        ProviderInfo(
            ProviderId.DEEPGRAM, "Deepgram", "nova-3",
            listOf("nova-3", "nova-2", "whisper-cloud"),
            "https://api.deepgram.com/v1", usesVocabulary = false,
            maxUploadBytes = 100L * 1024 * 1024,
        ),
        ProviderInfo(
            ProviderId.ASSEMBLYAI, "AssemblyAI", "universal",
            listOf("universal", "best"),
            "https://api.assemblyai.com/v2", usesVocabulary = false,
            maxUploadBytes = 100L * 1024 * 1024,
        ),
        ProviderInfo(
            ProviderId.SELFHOSTED, "Self-hosted server", "whisper-1",
            listOf("whisper-1"),
            null, usesVocabulary = false,
            maxUploadBytes = null,
        ),
    )

    fun info(id: ProviderId): ProviderInfo = all.first { it.id == id }
}

val ProviderId.displayName: String get() = ProviderCatalog.info(this).displayName
