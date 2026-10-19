package ai.whisperio.android

import ai.whisperio.android.dictation.computeSetupStatus
import ai.whisperio.android.security.InMemorySecretStore
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.KeyEnrollment
import ai.whisperio.android.settings.KeyUi
import ai.whisperio.android.settings.ProviderSlot
import ai.whisperio.android.settings.SettingsRepository
import ai.whisperio.android.settings.toChainSettings
import ai.whisperio.core.KeyValidation
import ai.whisperio.core.ProviderId
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SettingsMappingTest {
    private val order = listOf(
        ProviderSlot(ProviderId.OPENAI, "gpt-4o-transcribe"),
        ProviderSlot(ProviderId.GROQ, "whisper-large-v3"),
        ProviderSlot(ProviderId.SELFHOSTED, "whisper-1"),
    )

    @Test fun mapsOrderModelKeysAndFlags() {
        val s = AppSettings(order = order, fallbackEnabled = true, cloudConsentGranted = true)
        val chain = s.toChainSettings(mapOf(ProviderId.OPENAI to "sk-a", ProviderId.GROQ to "gsk-b"))
        assertEquals(listOf(ProviderId.OPENAI, ProviderId.GROQ), chain.order.map { it.id })
        assertEquals("gpt-4o-transcribe", chain.order[0].model)
        assertEquals("sk-a", chain.order[0].apiKey)
        assertTrue(chain.fallbackEnabled)
        assertTrue(chain.cloudConsentGranted)
    }

    @Test fun consentDefaultsToFalse() {
        assertFalse(AppSettings(order = order).toChainSettings(emptyMap()).cloudConsentGranted)
    }

    @Test fun baseUrlOnlyForOpenAiAndSelfHosted() {
        val s = AppSettings(
            order = order,
            baseUrls = mapOf(
                ProviderId.OPENAI to "https://proxy.example/v1",
                ProviderId.GROQ to "https://evil.example",
                ProviderId.SELFHOSTED to "http://192.168.1.5:8000",
            ),
        )
        val chain = s.toChainSettings(mapOf(ProviderId.OPENAI to "k", ProviderId.GROQ to "k"))
        assertEquals("https://proxy.example/v1", chain.order.first { it.id == ProviderId.OPENAI }.baseUrl)
        assertNull(chain.order.first { it.id == ProviderId.GROQ }.baseUrl)
        assertEquals("http://192.168.1.5:8000", chain.order.first { it.id == ProviderId.SELFHOSTED }.baseUrl)
    }

    @Test fun selfHostedWithoutKeyButWithUrlIsConfigured() {
        val s = AppSettings(order = order, baseUrls = mapOf(ProviderId.SELFHOSTED to "http://nas.local:9000"))
        assertEquals(listOf(ProviderId.SELFHOSTED), s.toChainSettings(emptyMap()).order.map { it.id })
    }

    @Test fun nothingConfiguredPassesFirstSlotSoTheUserSeesARealError() {
        val chain = AppSettings(order = order).toChainSettings(emptyMap())
        assertEquals(listOf(ProviderId.OPENAI), chain.order.map { it.id })
        assertNull(chain.order.single().apiKey)
    }

    @Test fun blankKeysAreTreatedAsMissing() {
        val chain = AppSettings(order = order).toChainSettings(mapOf(ProviderId.OPENAI to "  ", ProviderId.GROQ to "gsk"))
        assertEquals(listOf(ProviderId.GROQ), chain.order.map { it.id })
    }

    @Test fun setupStatusNeedsMicKeyAndConsent() {
        val s = AppSettings(order = order, cloudConsentGranted = true)
        assertTrue(computeSetupStatus(s, setOf(ProviderId.OPENAI), micGranted = true).ready)
        assertFalse(computeSetupStatus(s, setOf(ProviderId.OPENAI), micGranted = false).ready)
        assertFalse(computeSetupStatus(s, emptySet(), micGranted = true).ready)
        assertFalse(computeSetupStatus(s.copy(cloudConsentGranted = false), setOf(ProviderId.OPENAI), true).ready)
    }
}

class SettingsRepositoryTest {
    @get:Rule val tmp = TemporaryFolder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @After fun tearDown() = scope.cancel()

    private fun repo(secrets: InMemorySecretStore = InMemorySecretStore()) = SettingsRepository(
        PreferenceDataStoreFactory.create(scope = scope) { File(tmp.root, "settings.preferences_pb") },
        secrets,
        FakeCatalog(),
    )

    @Test fun defaultsMatchTheContract() = runBlocking {
        val s = repo().current()
        assertEquals("auto", s.language)
        assertTrue(s.keepAudio)
        assertNull(s.autoDeleteDays)
        assertFalse(s.transcriptsSensitive)
        assertFalse(s.onboardingDone)
        assertFalse(s.cloudConsentGranted)
        assertFalse(s.fallbackEnabled)
        assertEquals(0, s.autoStopSeconds)
        assertEquals(ProviderId.entries, s.order.map { it.id })
        assertEquals("model-openai", s.order.first().model)
    }

    @Test fun roundTripsEverySetting() = runBlocking {
        val r = repo()
        r.setLanguage("pl"); r.setVocabulary("Kasprzyk, Whisperio"); r.setCleanup(true); r.setAutoStop(15)
        r.setKeepAudio(false); r.setAutoDeleteDays(7); r.setSensitive(true); r.setConsent(true)
        r.setFallback(true); r.setOnboardingDone(true); r.setBaseUrl(ProviderId.OPENAI, " https://proxy.example/v1 ")
        r.setModel(ProviderId.GROQ, "alt-groq")
        val s = r.current()
        assertEquals("pl", s.language)
        assertEquals("Kasprzyk, Whisperio", s.vocabulary)
        assertTrue(s.cleanupEnabled)
        assertEquals(15, s.autoStopSeconds)
        assertFalse(s.keepAudio)
        assertEquals(7, s.autoDeleteDays)
        assertTrue(s.transcriptsSensitive && s.cloudConsentGranted && s.fallbackEnabled && s.onboardingDone)
        assertEquals("https://proxy.example/v1", s.baseUrls[ProviderId.OPENAI])
        assertEquals("alt-groq", s.order.first { it.id == ProviderId.GROQ }.model)
        r.setAutoDeleteDays(null)
        assertNull(r.current().autoDeleteDays)
    }

    @Test fun moveReordersAndPersists() = runBlocking {
        val r = repo()
        r.move(ProviderId.GROQ, -1)
        assertEquals(ProviderId.GROQ, r.current().order.first().id)
        r.move(ProviderId.GROQ, -5) // clamped
        assertEquals(ProviderId.GROQ, r.current().order.first().id)
    }

    @Test fun autoStopIsClampedToRange() = runBlocking {
        val r = repo()
        r.setAutoStop(999)
        assertEquals(120, r.current().autoStopSeconds)
    }

    @Test fun chainUsesStoredKeys() = runBlocking {
        val secrets = InMemorySecretStore().also { it.put(ProviderId.GROQ, "gsk-1") }
        val r = repo(secrets)
        r.setConsent(true)
        val chain = r.chain()
        assertEquals(listOf(ProviderId.GROQ), chain.order.map { it.id })
        assertEquals("gsk-1", chain.order.single().apiKey)
        assertTrue(chain.cloudConsentGranted)
    }

    @Test fun clearResetsToDefaults() = runBlocking {
        val r = repo()
        r.setConsent(true); r.setOnboardingDone(true)
        r.clear()
        assertFalse(r.current().cloudConsentGranted)
        assertFalse(r.current().onboardingDone)
        assertEquals(ProviderId.entries.size, r.flow.first().order.size)
    }
}

class KeyEnrollmentTest {
    @get:Rule val tmp = TemporaryFolder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var stores = 0

    @After fun tearDown() = scope.cancel()

    private fun parts(result: KeyValidation): Triple<KeyEnrollment, InMemorySecretStore, FakeKeyChecker> {
        val secrets = InMemorySecretStore()
        val checker = FakeKeyChecker(result)
        // One file per call: a test may build two enrollments, and two DataStores on one file throw.
        val file = File(tmp.root, "s${++stores}.preferences_pb")
        val settings = SettingsRepository(
            PreferenceDataStoreFactory.create(scope = scope) { file }, secrets, FakeCatalog(),
        )
        return Triple(KeyEnrollment(checker, secrets, settings), secrets, checker)
    }

    @Test fun savesOnlyAfterValid() = runBlocking {
        val (e, secrets, _) = parts(KeyValidation.Valid)
        assertEquals(KeyUi.Valid(), e.validateAndSave(ProviderId.OPENAI, "  sk-ok ", null))
        assertEquals("sk-ok", secrets.get(ProviderId.OPENAI))
    }

    @Test fun rejectedKeyIsNeverStored() = runBlocking {
        val (e, secrets, _) = parts(KeyValidation.InvalidKey)
        assertEquals(KeyUi.Invalid, e.validateAndSave(ProviderId.OPENAI, "sk-bad", null))
        assertNull(secrets.get(ProviderId.OPENAI))
    }

    @Test fun networkAndUnexpectedAreReportedNotStored() = runBlocking {
        val (e1, s1, _) = parts(KeyValidation.Network("timeout"))
        assertEquals(KeyUi.Network("timeout"), e1.validateAndSave(ProviderId.GROQ, "k", null))
        assertNull(s1.get(ProviderId.GROQ))
        val (e2, s2, _) = parts(KeyValidation.Unexpected(500))
        assertEquals(KeyUi.Unexpected(500), e2.validateAndSave(ProviderId.GROQ, "k", null))
        assertNull(s2.get(ProviderId.GROQ))
    }

    @Test fun blankKeyIsRejectedWithoutACall() = runBlocking {
        val (e, _, checker) = parts(KeyValidation.Valid)
        assertEquals(KeyUi.Invalid, e.validateAndSave(ProviderId.OPENAI, "  ", null))
        assertEquals(0, checker.calls)
    }

    @Test fun selfHostedMayRunWithoutKey() = runBlocking {
        val (e, secrets, checker) = parts(KeyValidation.Valid)
        assertEquals(KeyUi.Valid(serverOnly = true), e.validateAndSave(ProviderId.SELFHOSTED, "", "http://nas.local:9000"))
        assertEquals(1, checker.calls)
        assertNull(secrets.get(ProviderId.SELFHOSTED))
    }

    @Test fun selfHostedWithKeyUsesKeySuccess() = runBlocking {
        val (e, secrets, _) = parts(KeyValidation.Valid)
        assertEquals(KeyUi.Valid(), e.validateAndSave(ProviderId.SELFHOSTED, "  server-key ", "http://nas.local:9000"))
        assertEquals("server-key", secrets.get(ProviderId.SELFHOSTED))
        assertEquals(KeyUi.Valid(), e.recheck(ProviderId.SELFHOSTED))
    }

    @Test fun recheckReportsValidWithoutWriting() = runBlocking {
        val (e, secrets, checker) = parts(KeyValidation.Valid)
        secrets.put(ProviderId.GROQ, "gsk-stored")
        assertEquals(KeyUi.Valid(), e.recheck(ProviderId.GROQ))
        assertEquals(1, checker.calls)
        assertEquals("gsk-stored", secrets.get(ProviderId.GROQ))
    }

    @Test fun recheckInvalidKeyIsReportedAndNotDeleted() = runBlocking {
        val (e, secrets, _) = parts(KeyValidation.InvalidKey)
        secrets.put(ProviderId.OPENAI, "sk-revoked")
        assertEquals(KeyUi.Invalid, e.recheck(ProviderId.OPENAI))
        assertEquals("sk-revoked", secrets.get(ProviderId.OPENAI))
    }

    @Test fun recheckMapsNetworkAndUnexpectedAndKeepsKey() = runBlocking {
        val (e1, s1, _) = parts(KeyValidation.Network("offline"))
        s1.put(ProviderId.MISTRAL, "m-key")
        assertEquals(KeyUi.Network("offline"), e1.recheck(ProviderId.MISTRAL))
        assertEquals("m-key", s1.get(ProviderId.MISTRAL))
        val (e2, s2, _) = parts(KeyValidation.Unexpected(503))
        s2.put(ProviderId.MISTRAL, "m-key")
        assertEquals(KeyUi.Unexpected(503), e2.recheck(ProviderId.MISTRAL))
        assertEquals("m-key", s2.get(ProviderId.MISTRAL))
    }

    @Test fun recheckWithoutStoredKeyIsMissingWithoutACall() = runBlocking {
        val (e, _, checker) = parts(KeyValidation.Valid)
        assertEquals(KeyUi.Missing, e.recheck(ProviderId.OPENAI))
        assertEquals(0, checker.calls)
    }

    @Test fun recheckSelfHostedWithoutKeyStillChecksTheServer() = runBlocking {
        val (e, _, checker) = parts(KeyValidation.Valid)
        assertEquals(KeyUi.Valid(serverOnly = true), e.recheck(ProviderId.SELFHOSTED))
        assertEquals(1, checker.calls)
    }
}
