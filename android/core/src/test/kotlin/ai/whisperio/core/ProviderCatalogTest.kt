package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProviderCatalogTest {
    @Test fun coversEveryProviderOnceWithDefaultFirstInChips() {
        assertEquals(ProviderId.entries.toSet(), ProviderCatalog.all.map { it.id }.toSet())
        assertEquals(ProviderId.entries.size, ProviderCatalog.all.size)
        for (info in ProviderCatalog.all) assertEquals(info.defaultModel, info.modelChips.first(), info.id.wire)
    }

    @Test fun contractDefaults() {
        assertEquals("whisper-1", ProviderCatalog.info(ProviderId.OPENAI).defaultModel)
        assertEquals("whisper-large-v3-turbo", ProviderCatalog.info(ProviderId.GROQ).defaultModel)
        assertEquals("voxtral-small-latest", ProviderCatalog.info(ProviderId.MISTRAL).defaultModel)
        assertEquals("scribe_v1", ProviderCatalog.info(ProviderId.ELEVENLABS).defaultModel)
        assertEquals("nova-3", ProviderCatalog.info(ProviderId.DEEPGRAM).defaultModel)
        assertEquals("universal", ProviderCatalog.info(ProviderId.ASSEMBLYAI).defaultModel)
        assertFalse(ProviderCatalog.info(ProviderId.GROQ).modelChips.any { it.startsWith("distil") })
    }

    @Test fun vocabularyFlagMatchesWhatProvidersSend() {
        val sends = ProviderCatalog.all.filter { it.usesVocabulary }.map { it.id }.toSet()
        assertEquals(setOf(ProviderId.OPENAI, ProviderId.GROQ, ProviderId.ELEVENLABS), sends)
    }

    @Test fun everyChipIsAcceptedByItsProviderAlias() {
        assertTrue(ProviderCatalog.info(ProviderId.DEEPGRAM).modelChips.contains("whisper-cloud"))
        assertEquals("whisper-large", DeepgramProvider("k", "whisper-cloud").apiModel())
    }
}
