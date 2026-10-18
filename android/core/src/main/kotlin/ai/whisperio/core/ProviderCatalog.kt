package ai.whisperio.core

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
)

object ProviderCatalog {
    val all: List<ProviderInfo> = listOf(
        ProviderInfo(
            ProviderId.OPENAI, "OpenAI", "whisper-1",
            listOf("whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"),
            "https://api.openai.com/v1", usesVocabulary = true,
        ),
        // iOS's retired distil-whisper-large-v3-en chip is dropped.
        ProviderInfo(
            ProviderId.GROQ, "Groq", "whisper-large-v3-turbo",
            listOf("whisper-large-v3-turbo", "whisper-large-v3"),
            "https://api.groq.com/openai/v1", usesVocabulary = true,
        ),
        ProviderInfo(
            ProviderId.MISTRAL, "Mistral", "voxtral-small-latest",
            listOf("voxtral-small-latest", "voxtral-mini-latest"),
            "https://api.mistral.ai/v1", usesVocabulary = false,
        ),
        ProviderInfo(
            ProviderId.ELEVENLABS, "ElevenLabs", "scribe_v1",
            listOf("scribe_v1", "scribe_v2"),
            "https://api.elevenlabs.io/v1", usesVocabulary = true, // as keyterms
        ),
        ProviderInfo(
            ProviderId.DEEPGRAM, "Deepgram", "nova-3",
            listOf("nova-3", "nova-2", "whisper-cloud"),
            "https://api.deepgram.com/v1", usesVocabulary = false,
        ),
        ProviderInfo(
            ProviderId.ASSEMBLYAI, "AssemblyAI", "universal",
            listOf("universal", "best"),
            "https://api.assemblyai.com/v2", usesVocabulary = false,
        ),
        ProviderInfo(
            ProviderId.SELFHOSTED, "Self-hosted server", "whisper-1",
            listOf("whisper-1"),
            null, usesVocabulary = false,
        ),
    )

    fun info(id: ProviderId): ProviderInfo = all.first { it.id == id }
}

val ProviderId.displayName: String get() = ProviderCatalog.info(this).displayName
