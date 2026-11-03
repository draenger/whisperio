package ai.whisperio.core

import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** Paths of [ProviderChain] not covered by ProviderChainTest: multi-hop fallback, skipped slots, error shapes. */
class ProviderChainEdgeCasesTest {
    private class Fake(
        override val id: ProviderId,
        override val isConfigured: Boolean = true,
        private val outcome: () -> String,
    ) : TranscriptionProvider {
        var calls = 0
        override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
            calls++
            return TranscriptionResult(outcome(), id, "m")
        }
    }

    private val req = TranscriptionRequest(File("a.m4a"), "auto")
    private fun ok(id: ProviderId, text: String = id.wire, configured: Boolean = true) = Fake(id, configured) { text }
    private fun failing(id: ProviderId, e: Throwable = IllegalStateException("${id.wire} down"), configured: Boolean = true) =
        Fake(id, configured) { throw e }

    @Test fun thirdProviderWinsAfterTwoFailures() = runTest {
        val a = failing(ProviderId.OPENAI)
        val b = failing(ProviderId.GROQ)
        val c = ok(ProviderId.DEEPGRAM, "third")
        val pairs = mutableListOf<Pair<ProviderId, ProviderId>>()
        val r = ProviderChain(listOf(a, b, c)) { f, n -> pairs += f to n }.transcribe(req)
        assertEquals("third", r.text)
        assertEquals(ProviderId.DEEPGRAM, r.provider)
        assertEquals(listOf(1, 1, 1), listOf(a.calls, b.calls, c.calls))
        assertEquals(listOf(ProviderId.OPENAI to ProviderId.GROQ, ProviderId.GROQ to ProviderId.DEEPGRAM), pairs)
    }

    @Test fun providersAfterSuccessAreNeverCalled() = runTest {
        val later = ok(ProviderId.GROQ)
        val pairs = mutableListOf<Pair<ProviderId, ProviderId>>()
        ProviderChain(listOf(ok(ProviderId.OPENAI), later)) { f, n -> pairs += f to n }.transcribe(req)
        assertEquals(0, later.calls)
        assertTrue(pairs.isEmpty(), "no fallback when the primary succeeds")
    }

    @Test fun fallbackCallbackSkipsUnconfiguredSlotsInTheMiddle() = runTest {
        val skipped = ok(ProviderId.GROQ, configured = false)
        val pairs = mutableListOf<Pair<ProviderId, ProviderId>>()
        val r = ProviderChain(listOf(failing(ProviderId.OPENAI), skipped, ok(ProviderId.MISTRAL))) { f, n -> pairs += f to n }
            .transcribe(req)
        assertEquals(ProviderId.MISTRAL, r.provider)
        assertEquals(0, skipped.calls)
        assertEquals(listOf(ProviderId.OPENAI to ProviderId.MISTRAL), pairs)
    }

    @Test fun noFallbackCallbackAfterTheLastProviderFails() = runTest {
        val pairs = mutableListOf<Pair<ProviderId, ProviderId>>()
        assertFailsWith<ProviderError.AllProvidersFailed> {
            ProviderChain(listOf(failing(ProviderId.OPENAI), failing(ProviderId.GROQ))) { f, n -> pairs += f to n }
                .transcribe(req)
        }
        assertEquals(listOf(ProviderId.OPENAI to ProviderId.GROQ), pairs)
    }

    @Test fun singleFailingProviderIsWrappedAndCauseIsKept() = runTest {
        val cause = ProviderError.http(ProviderId.OPENAI, 401, """{"error":{"message":"bad key"}}""")
        val e = assertFailsWith<ProviderError.AllProvidersFailed> {
            ProviderChain(listOf(failing(ProviderId.OPENAI, cause))).transcribe(req)
        }
        assertSame(cause, e.first)
        assertSame(cause, e.cause)
        assertEquals("OpenAI error: HTTP 401: bad key", e.message)
    }

    @Test fun whenNothingIsConfiguredOnlyTheFirstSlotIsTried() = runTest {
        val first = failing(ProviderId.OPENAI, configured = false)
        val second = ok(ProviderId.GROQ, configured = false)
        assertFailsWith<ProviderError.AllProvidersFailed> { ProviderChain(listOf(first, second)).transcribe(req) }
        assertEquals(1, first.calls)
        assertEquals(0, second.calls)
    }

    @Test fun unconfiguredFirstSlotIsSkippedWhenALaterOneIsConfigured() = runTest {
        val first = ok(ProviderId.OPENAI, configured = false)
        assertEquals(ProviderId.GROQ, ProviderChain(listOf(first, ok(ProviderId.GROQ))).transcribe(req).provider)
        assertEquals(0, first.calls)
    }

    @Test fun nonProviderFirstErrorWithKeyIsRedactedInMessage() = runTest {
        val e = assertFailsWith<ProviderError.AllProvidersFailed> {
            ProviderChain(
                listOf(
                    failing(ProviderId.OPENAI, java.io.IOException("refused Bearer sk-abcdef1234567890")),
                    failing(ProviderId.GROQ, IllegalStateException("second")),
                ),
            ).transcribe(req)
        }
        assertTrue("sk-abcdef1234567890" !in e.message!!, e.message)
        assertTrue(e.message!!.startsWith("refused Bearer ***"), e.message)
    }

    @Test fun firstErrorWithNullMessageBecomesUnknownError() = runTest {
        val e = assertFailsWith<ProviderError.AllProvidersFailed> {
            ProviderChain(listOf(failing(ProviderId.OPENAI, RuntimeException()))).transcribe(req)
        }
        assertEquals("Unknown error", e.message)
    }

    @Test fun jvmErrorsAreNotTreatedAsProviderFailures() = runTest {
        // Only Exceptions trigger fallback; an Error (e.g. OOM, assertion) escapes untouched.
        val second = ok(ProviderId.GROQ)
        assertFailsWith<AssertionError> {
            ProviderChain(listOf(failing(ProviderId.OPENAI, AssertionError("fatal")), second)).transcribe(req)
        }
        assertEquals(0, second.calls)
    }

    @Test fun cancellationFromALaterProviderAlsoPropagates() = runTest {
        assertFailsWith<kotlinx.coroutines.CancellationException> {
            ProviderChain(
                listOf(failing(ProviderId.OPENAI), failing(ProviderId.GROQ, kotlinx.coroutines.CancellationException("stop"))),
            ).transcribe(req)
        }
    }

    @Test fun chainIsReusableAcrossCalls() = runTest {
        var n = 0
        val flaky = Fake(ProviderId.OPENAI) { if (n++ == 0) throw IllegalStateException("once") else "ok" }
        val backup = ok(ProviderId.GROQ)
        val chain = ProviderChain(listOf(flaky, backup))
        assertEquals(ProviderId.GROQ, chain.transcribe(req).provider)
        assertEquals(ProviderId.OPENAI, chain.transcribe(req).provider)
        assertEquals(1, backup.calls)
    }
}
