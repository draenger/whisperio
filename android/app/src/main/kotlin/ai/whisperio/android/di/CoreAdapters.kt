package ai.whisperio.android.di

import ai.whisperio.core.BaseUrlPolicy
import ai.whisperio.core.ChainFactory
import ai.whisperio.core.ChainSettings
import ai.whisperio.core.KeyValidation
import ai.whisperio.core.KeyValidator
import ai.whisperio.core.ProviderCatalog
import ai.whisperio.core.ProviderId
import ai.whisperio.core.TextCleaner
import ai.whisperio.core.TranscriptionRequest
import ai.whisperio.core.TranscriptionResult
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** The ONLY file in :app that calls :core implementation classes (everything else uses Api.kt). */
class CoreTranscriber : Transcriber {
    override suspend fun transcribe(req: TranscriptionRequest, settings: ChainSettings): TranscriptionResult =
        ChainFactory(settings).makeChain().transcribe(req)
}

class CoreKeyChecker : KeyChecker {
    override suspend fun validate(id: ProviderId, key: String?, baseUrl: String?): KeyValidation =
        when {
            // Self-hosted has no vendor key check: core validates the server URL instead.
            id == ProviderId.SELFHOSTED -> KeyValidator().validate(id, baseUrl ?: key.orEmpty())
            // A custom OpenAI-compatible base URL is checked against that host, not api.openai.com.
            !baseUrl.isNullOrBlank() -> KeyValidator(baseUrls = mapOf(id to baseUrl)).validate(id, key.orEmpty())
            else -> KeyValidator().validate(id, key.orEmpty())
        }
}

class CoreModelCatalog : ModelCatalog {
    override fun defaultModel(id: ProviderId): String = ProviderCatalog.info(id).defaultModel
    override fun models(id: ProviderId): List<String> = ProviderCatalog.info(id).modelChips
}

class CoreTextTidy : TextTidy {
    override fun tidy(text: String): String = TextCleaner.tidy(text)
}

class CoreHostPolicy : HostPolicy {
    override fun isOfficialHost(url: String): Boolean = url.toHttpUrlOrNull()?.let { BaseUrlPolicy.isOfficialHost(ProviderId.OPENAI, it) } ?: false
}
