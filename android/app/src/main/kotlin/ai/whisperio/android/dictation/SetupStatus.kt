package ai.whisperio.android.dictation

import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.isProviderConfigured
import ai.whisperio.core.ProviderId

/** What must be true before any surface may record: mic grant, a usable provider, explicit cloud consent. */
data class SetupStatus(val micGranted: Boolean, val hasKey: Boolean, val consent: Boolean) {
    val ready: Boolean get() = micGranted && hasKey && consent
}

fun computeSetupStatus(settings: AppSettings, configuredKeys: Set<ProviderId>, micGranted: Boolean): SetupStatus {
    val hasUsable = settings.order.any { slot ->
        isProviderConfigured(
            slot.id,
            key = if (slot.id in configuredKeys) "set" else null,
            baseUrl = settings.baseUrls[slot.id],
        )
    }
    return SetupStatus(micGranted, hasUsable, settings.cloudConsentGranted)
}

/** First usable provider slot, for the "which provider gets my audio" chip. */
fun AppSettings.primaryProvider(configuredKeys: Set<ProviderId>): Pair<ProviderId, String>? =
    order.firstOrNull { isProviderConfigured(it.id, if (it.id in configuredKeys) "set" else null, baseUrls[it.id]) }
        ?.let { it.id to it.model }
