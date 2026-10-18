package ai.whisperio.android.settings

import ai.whisperio.android.di.KeyChecker
import ai.whisperio.android.security.SecretStore
import ai.whisperio.core.KeyValidation
import ai.whisperio.core.ProviderId

/** Outcome of a paste-and-check, in UI terms. */
sealed interface KeyUi {
    data object Idle : KeyUi
    data object Validating : KeyUi
    data object Valid : KeyUi
    data object Invalid : KeyUi
    data class Network(val message: String) : KeyUi
    data class Unexpected(val status: Int) : KeyUi
    data class InvalidUrl(val message: String) : KeyUi
}

/**
 * "A key is saved only after it validates" (CONTRACT 4.2). The key and URL are written only on [KeyValidation.Valid].
 */
class KeyEnrollment(
    private val checker: KeyChecker,
    private val secrets: SecretStore,
    private val settings: SettingsRepository,
) {
    suspend fun validateAndSave(id: ProviderId, rawKey: String, rawBaseUrl: String?): KeyUi {
        val key = rawKey.trim().ifEmpty { null }
        val url = rawBaseUrl?.trim()?.ifEmpty { null }
        // Self-hosted may run without a key; every other provider needs one.
        if (key == null && id != ProviderId.SELFHOSTED) return KeyUi.Invalid
        return when (val v = checker.validate(id, key, url)) {
            KeyValidation.Valid -> {
                if (key != null) secrets.put(id, key)
                if (id == ProviderId.OPENAI || id == ProviderId.SELFHOSTED) settings.setBaseUrl(id, url)
                KeyUi.Valid
            }
            else -> v.toKeyUi()
        }
    }

    /**
     * Re-validates the key already stored for [id] (CONTRACT 7.4). Read-only: whatever the outcome, nothing is written
     * or deleted - an invalid key is only reported.
     */
    suspend fun recheck(id: ProviderId): KeyUi {
        val key = secrets.get(id)?.trim()?.ifEmpty { null }
        if (key == null && id != ProviderId.SELFHOSTED) return KeyUi.Invalid
        val url = settings.current().baseUrls[id]?.trim()?.ifEmpty { null }
        return checker.validate(id, key, url).toKeyUi()
    }

    private fun KeyValidation.toKeyUi(): KeyUi = when (this) {
        KeyValidation.Valid -> KeyUi.Valid
        KeyValidation.InvalidKey -> KeyUi.Invalid
        is KeyValidation.Unexpected -> KeyUi.Unexpected(status)
        is KeyValidation.Network -> KeyUi.Network(message)
        is KeyValidation.InvalidUrl -> KeyUi.InvalidUrl(message)
    }
}
