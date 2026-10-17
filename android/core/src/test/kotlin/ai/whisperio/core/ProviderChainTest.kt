package ai.whisperio.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertSame

/** Vectors ported from ProviderChainTests.swift plus the consent-gate rules (SettingsStore.swift:95-121). */
class ProviderChainTest {
    private class Fake(
        override val id: ProviderId,
        override val isConfigured: Boolean = true,
        private val outcome: Result<String>,
    ) : TranscriptionProvider {
        var calls = 0
        override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
            calls++
            return TranscriptionResult(outcome.getOrThrow(), id, "m")
        }
    }

    private val req = TranscriptionRequest(File("a.m4a"), "auto")
    private fun ok(t: String) = Result.success(t)
    private fun fail(msg: String = "boom") = Result.failure<String>(IllegalStateException(msg))

    @Test fun primarySucceeds() = runTest {
        val r = ProviderChain(listOf(Fake(ProviderId.OPENAI, outcome = ok("hello")))).transcribe(req)
        assertEquals("hello", r.text)
        assertEquals(ProviderId.OPENAI, r.provider)
    }

    @Test fun fallsBackToNextOnFailure() = runTest {
        val r = ProviderChain(
            listOf(Fake(ProviderId.OPENAI, outcome = fail()), Fake(ProviderId.GROQ, outcome = ok("cloud"))),
        ).transcribe(req)
        assertEquals(ProviderId.GROQ, r.provider)
    }

    @Test fun skipsUnconfiguredProviders() = runTest {
        val skipped = Fake(ProviderId.OPENAI, isConfigured = false, outcome = ok("never"))
        val r = ProviderChain(listOf(skipped, Fake(ProviderId.ELEVENLABS, outcome = ok("eleven")))).transcribe(req)
        assertEquals("eleven", r.text)
        assertEquals(0, skipped.calls)
    }

    @Test fun allFailSurfacesFirstError() = runTest {
        val first = IllegalStateException("first")
        val e = assertFailsWith<ProviderError.AllProvidersFailed> {
            ProviderChain(
                listOf(
                    Fake(ProviderId.OPENAI, outcome = Result.failure(first)),
                    Fake(ProviderId.GROQ, outcome = fail("second")),
                ),
            ).transcribe(req)
        }
        assertSame(first, e.first)
        assertEquals("first", e.message)
    }

    @Test fun noProvidersConfiguredTriesFirstAnyway() = runTest {
        val p = Fake(ProviderId.OPENAI, isConfigured = false, outcome = ok("forced"))
        assertEquals("forced", ProviderChain(listOf(p)).transcribe(req).text)
        assertEquals(1, p.calls)
    }

    @Test fun emptyChainReportsNotConfigured() = runTest {
        val e = assertFailsWith<ProviderError.NotConfigured> { ProviderChain(emptyList()).transcribe(req) }
        assertEquals(null, e.provider)
    }

    @Test fun fallbackCallbackFiresWithFailedAndNext() = runTest {
        val pairs = mutableListOf<Pair<ProviderId, ProviderId>>()
        ProviderChain(
            listOf(Fake(ProviderId.OPENAI, outcome = fail()), Fake(ProviderId.GROQ, outcome = ok("ok"))),
            onFallback = { a, b -> pairs += a to b },
        ).transcribe(req)
        assertEquals(listOf(ProviderId.OPENAI to ProviderId.GROQ), pairs)
    }

    @Test fun cancellationIsNotSwallowedAsFallback() = runTest {
        val second = Fake(ProviderId.GROQ, outcome = ok("x"))
        assertFailsWith<CancellationException> {
            ProviderChain(
                listOf(Fake(ProviderId.OPENAI, outcome = Result.failure(CancellationException("c"))), second),
            ).transcribe(req)
        }
        assertEquals(0, second.calls)
    }

    // ---- ChainFactory / consent gate

    private fun cfg(id: ProviderId) = ProviderConfig(id, "", "key")
    private val created = mutableListOf<ProviderId>()
    private fun factory(settings: ChainSettings) = ChainFactory(settings) {
        created += it.id
        Fake(it.id, outcome = ok("x"))
    }

    @Test fun fallbackOffUsesSlotZeroOnly() {
        val chain = factory(
            ChainSettings(listOf(cfg(ProviderId.OPENAI), cfg(ProviderId.GROQ)), fallbackEnabled = false, cloudConsentGranted = true),
        ).makeChain()
        assertEquals(listOf(ProviderId.OPENAI), chain.providers.map { it.id })
    }

    @Test fun fallbackOnKeepsOrder() {
        val chain = factory(
            ChainSettings(listOf(cfg(ProviderId.GROQ), cfg(ProviderId.OPENAI)), fallbackEnabled = true, cloudConsentGranted = true),
        ).makeChain()
        assertEquals(listOf(ProviderId.GROQ, ProviderId.OPENAI), chain.providers.map { it.id })
    }

    @Test fun cloudProvidersDroppedWithoutConsent() {
        val f = factory(ChainSettings(listOf(cfg(ProviderId.OPENAI), cfg(ProviderId.GROQ)), true, cloudConsentGranted = false))
        assertIs<ProviderError.ConsentRequired>(assertFailsWith<ProviderError> { f.makeChain() })
        assertEquals(emptyList(), created)
    }

    @Test fun selfHostedAlsoNeedsConsent() {
        val f = factory(ChainSettings(listOf(cfg(ProviderId.SELFHOSTED)), false, false))
        assertFailsWith<ProviderError.ConsentRequired> { f.makeChain() }
    }

    @Test fun singleEngineRetryHonorsConsent() {
        val denied = factory(ChainSettings(listOf(cfg(ProviderId.OPENAI)), false, false))
        assertFailsWith<ProviderError.ConsentRequired> { denied.makeSingleChain(cfg(ProviderId.GROQ)) }
        val granted = factory(ChainSettings(listOf(cfg(ProviderId.OPENAI)), false, true))
        assertEquals(listOf(ProviderId.GROQ), granted.makeSingleChain(cfg(ProviderId.GROQ)).providers.map { it.id })
    }

    @Test fun emptyOrderIsNotConfigured() {
        assertFailsWith<ProviderError.NotConfigured> { factory(ChainSettings(emptyList(), false, true)).makeChain() }
    }

    @Test fun defaultFactoryMapsEveryProvider() {
        for (id in ProviderId.entries) {
            assertEquals(id, DefaultProviders.create(ProviderConfig(id, "", "k", "http://localhost:1")).id)
        }
    }
}
