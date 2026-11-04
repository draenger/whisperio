package ai.whisperio.core

import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** [ChainFactory] consent gate and [DefaultProviders] wiring beyond the vectors in ProviderChainTest. */
class ConsentGateTest {
    private class Fake(override val id: ProviderId, private val fail: Boolean = false) : TranscriptionProvider {
        override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
            if (fail) throw IllegalStateException("down")
            return TranscriptionResult("ok", id, "m")
        }
    }

    private fun cfg(id: ProviderId) = ProviderConfig(id, "", "key")
    private val created = mutableListOf<ProviderId>()
    private fun factory(settings: ChainSettings, failing: Set<ProviderId> = emptySet()) = ChainFactory(settings) {
        created += it.id
        Fake(it.id, it.id in failing)
    }

    @Test fun everyProviderCountsAsCloudForTheGate() {
        // Including self-hosted: audio still leaves the device.
        assertTrue(ProviderId.entries.all { it.isCloud })
    }

    @Test fun eachSingleCloudSlotIsBlockedWithoutConsent() {
        for (id in ProviderId.entries) {
            for (fallback in listOf(true, false)) {
                val f = factory(ChainSettings(listOf(cfg(id)), fallbackEnabled = fallback, cloudConsentGranted = false))
                assertFailsWith<ProviderError.ConsentRequired>("$id fallback=$fallback") { f.makeChain() }
            }
        }
        assertEquals(emptyList(), created, "no provider may be built before consent")
    }

    @Test fun fullOrderWithoutConsentIsBlocked() {
        val f = factory(ChainSettings(ProviderId.entries.map(::cfg), fallbackEnabled = true, cloudConsentGranted = false))
        assertFailsWith<ProviderError.ConsentRequired> { f.makeChain() }
        assertEquals(emptyList(), created)
    }

    @Test fun emptyOrderReportsNotConfiguredEvenWithoutConsent() {
        // Empty check runs before the consent gate: the user is told to add a provider first.
        val e = assertFailsWith<ProviderError.NotConfigured> {
            factory(ChainSettings(emptyList(), fallbackEnabled = true, cloudConsentGranted = false)).makeChain()
        }
        assertEquals(null, e.provider)
    }

    @Test fun defaultChainSettingsAreDenyByDefault() {
        val s = ChainSettings(listOf(cfg(ProviderId.OPENAI)))
        assertFalse(s.cloudConsentGranted)
        assertFalse(s.fallbackEnabled)
        assertFailsWith<ProviderError.ConsentRequired> { factory(s).makeChain() }
    }

    @Test fun consentMessageIsUserReadable() {
        val m = ProviderError.ConsentRequired().message!!
        assertTrue(m.startsWith("Cloud transcription is off."), m)
        assertTrue("Settings" in m, m)
    }

    @Test fun grantedConsentBuildsEveryProviderInOrder() {
        val chain = factory(ChainSettings(ProviderId.entries.map(::cfg), fallbackEnabled = true, cloudConsentGranted = true))
            .makeChain()
        assertEquals(ProviderId.entries.toList(), chain.providers.map { it.id })
        assertEquals(ProviderId.entries.toList(), created)
    }

    @Test fun fallbackOffBuildsOnlySlotZero() {
        factory(ChainSettings(listOf(cfg(ProviderId.DEEPGRAM), cfg(ProviderId.GROQ)), false, true)).makeChain()
        assertEquals(listOf(ProviderId.DEEPGRAM), created)
    }

    @Test fun makeChainForwardsTheFallbackCallback() = runTest {
        val pairs = mutableListOf<Pair<ProviderId, ProviderId>>()
        val chain = factory(
            ChainSettings(listOf(cfg(ProviderId.OPENAI), cfg(ProviderId.GROQ)), fallbackEnabled = true, cloudConsentGranted = true),
            failing = setOf(ProviderId.OPENAI),
        ).makeChain { a, b -> pairs += a to b }
        assertEquals(ProviderId.GROQ, chain.transcribe(TranscriptionRequest(File("a.m4a"), "auto")).provider)
        assertEquals(listOf(ProviderId.OPENAI to ProviderId.GROQ), pairs)
    }

    @Test fun singleChainBlocksEveryEngineWithoutConsent() {
        val f = factory(ChainSettings(listOf(cfg(ProviderId.OPENAI)), true, cloudConsentGranted = false))
        for (id in ProviderId.entries) {
            assertFailsWith<ProviderError.ConsentRequired>(id.name) { f.makeSingleChain(cfg(id)) }
        }
        assertEquals(emptyList(), created)
    }

    @Test fun singleChainIgnoresOrderAndFallbackSettings() {
        val f = factory(ChainSettings(emptyList(), fallbackEnabled = true, cloudConsentGranted = true))
        val chain = f.makeSingleChain(cfg(ProviderId.ASSEMBLYAI))
        assertEquals(listOf(ProviderId.ASSEMBLYAI), chain.providers.map { it.id })
    }

    // ---- DefaultProviders wiring (no network: only isConfigured / id)

    @Test fun defaultProvidersAreUnconfiguredWithoutAKey() {
        for (id in ProviderId.entries - ProviderId.SELFHOSTED) {
            assertFalse(DefaultProviders.create(ProviderConfig(id, "", null)).isConfigured, "$id null key")
            assertFalse(DefaultProviders.create(ProviderConfig(id, "", "   ")).isConfigured, "$id blank key")
            assertTrue(DefaultProviders.create(ProviderConfig(id, "", "k")).isConfigured, "$id with key")
        }
    }

    @Test fun selfHostedIsConfiguredByUrlNotKey() {
        fun sh(url: String?, key: String? = null) = DefaultProviders.create(ProviderConfig(ProviderId.SELFHOSTED, "", key, url))
        assertTrue(sh("http://192.168.1.5:8000").isConfigured)
        assertTrue(sh("192.168.1.5:8000").isConfigured, "bare LAN host is accepted")
        assertFalse(sh(null, key = "k").isConfigured)
        assertFalse(sh("").isConfigured)
        assertFalse(sh("http://example.com").isConfigured, "plain http to a public host fails the policy")
    }

    @Test fun openAiWithCustomBaseUrlIsStillKeyGated() {
        assertTrue(DefaultProviders.create(ProviderConfig(ProviderId.OPENAI, "", "k", "http://localhost:1/v1")).isConfigured)
        assertFalse(DefaultProviders.create(ProviderConfig(ProviderId.OPENAI, "", null, "http://localhost:1/v1")).isConfigured)
    }
}
