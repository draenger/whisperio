package ai.whisperio.android.security

import ai.whisperio.core.ProviderId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map

/**
 * Provider API keys (CONTRACT 7.2). Implementations must never log a key or put it in an exception message.
 */
interface SecretStore {
    suspend fun get(id: ProviderId): String?
    suspend fun put(id: ProviderId, value: String)
    suspend fun remove(id: ProviderId)
    suspend fun clear()

    /** Providers that currently have a stored key. */
    val configured: Flow<Set<ProviderId>>

    /** Providers whose stored key became unreadable (Keystore key invalidated) and was wiped: ask the user to paste again. */
    val lost: StateFlow<Set<ProviderId>>
}

/** Test double and contract reference for [SecretStore]. */
class InMemorySecretStore : SecretStore {
    private val map = MutableStateFlow<Map<ProviderId, String>>(emptyMap())
    private val lostState = MutableStateFlow<Set<ProviderId>>(emptySet())

    override suspend fun get(id: ProviderId): String? = map.value[id]

    override suspend fun put(id: ProviderId, value: String) {
        map.value = map.value + (id to value)
        lostState.value = lostState.value - id
    }

    override suspend fun remove(id: ProviderId) {
        map.value = map.value - id
        lostState.value = lostState.value - id
    }

    override suspend fun clear() {
        map.value = emptyMap()
        lostState.value = emptySet()
    }

    override val configured: Flow<Set<ProviderId>> = map.map { it.keys }

    override val lost: StateFlow<Set<ProviderId>> get() = lostState
}
