package ai.whisperio.android

import ai.whisperio.android.di.EncryptHistoryResult
import ai.whisperio.android.history.MigrationReport
import ai.whisperio.android.security.InMemorySecretStore
import ai.whisperio.android.settings.SettingsRepository
import ai.whisperio.android.ui.settings.EncryptNotice
import ai.whisperio.android.ui.settings.EncryptSwitch
import ai.whisperio.android.ui.settings.shouldOfferEncryptCard
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** A4 follow-up: the one-time "Encrypt history" card on Home (show-once logic) and the shared switch state holder. */
class EncryptCardTest {
    @get:Rule val tmp = TemporaryFolder()
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var files = 0

    @After fun tearDown() = ioScope.cancel()

    private fun repo() = SettingsRepository(
        PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "settings-${files++}.preferences_pb") },
        InMemorySecretStore(),
        FakeCatalog(),
    )

    private suspend fun offered(r: SettingsRepository) = shouldOfferEncryptCard(r.current())

    @Test fun notOfferedDuringOnboarding() = runBlocking {
        val r = repo()
        assertFalse(r.current().onboardingDone)
        assertFalse(offered(r))
    }

    @Test fun offeredAfterOnboardingWhenOffAndNotAnswered() = runBlocking {
        val r = repo()
        r.setOnboardingDone(true)
        assertTrue(offered(r))
    }

    @Test fun hiddenAfterNotNow() = runBlocking {
        val r = repo()
        r.setOnboardingDone(true)
        r.setEncryptCardHandled(true)
        assertFalse(offered(r))
    }

    @Test fun hiddenAfterTurnOn() = runBlocking {
        val r = repo()
        r.setOnboardingDone(true)
        // Home's "Turn on": the card is marked answered, then the same switch as in Settings runs.
        r.setEncryptCardHandled(true)
        val sw = EncryptSwitch(CoroutineScope(Dispatchers.Unconfined)) {
            r.setEncryptHistory(true)
            EncryptHistoryResult.Done(MigrationReport(converted = 1, unreadable = 0))
        }
        sw.request(true)
        assertTrue(r.current().encryptHistory)
        assertFalse(offered(r))
    }

    @Test fun staysHiddenAfterTurnOnFailedAndAfterTurningOffAgain() = runBlocking {
        val r = repo()
        r.setOnboardingDone(true)
        r.setEncryptCardHandled(true)
        r.setEncryptHistory(true)
        r.setEncryptHistory(false) // switched off later in Settings: the one-time offer does not come back
        assertFalse(offered(r))
    }

    @Test fun hiddenWhenEncryptionAlreadyOn() = runBlocking {
        val r = repo()
        r.setOnboardingDone(true)
        r.setEncryptHistory(true) // turned on in Settings before the card was ever answered
        assertFalse(r.current().encryptCardHandled)
        assertFalse(offered(r))
    }

    @Test fun eraseAllResetsTheFlagWithEverythingElse() = runBlocking {
        val r = repo()
        r.setOnboardingDone(true)
        r.setEncryptCardHandled(true)
        r.clear()
        assertFalse(r.current().encryptCardHandled)
        assertFalse("onboarding runs again after erase, so no card yet", offered(r))
    }

    @Test fun switchHoldsBusyUntilTheRunEndsAndIgnoresASecondRequest() = runBlocking {
        val gate = CompletableDeferred<EncryptHistoryResult>()
        var runs = 0
        val sw = EncryptSwitch(CoroutineScope(Dispatchers.Unconfined)) { runs++; gate.await() }
        assertNull(sw.busy.value)

        sw.request(true)
        assertEquals(true, sw.busy.value)
        sw.request(false)
        assertEquals("a second request while busy is ignored", 1, runs)
        assertEquals(true, sw.busy.value)

        gate.complete(EncryptHistoryResult.Done(MigrationReport(converted = 2, unreadable = 0)))
        assertNull(sw.busy.value)
        assertNull(sw.notice.value)
    }

    @Test fun switchKeepsTheNoticeUntilDismissed() = runBlocking {
        val sw = EncryptSwitch(CoroutineScope(Dispatchers.Unconfined)) { EncryptHistoryResult.KeystoreUnavailable }
        sw.request(true)
        assertNull(sw.busy.value)
        assertEquals(EncryptNotice.Unavailable, sw.notice.value)
        sw.dismissNotice()
        assertNull(sw.notice.value)
    }

    @Test fun switchClearsOldNoticeOnTheNextRun() = runBlocking {
        var next: EncryptHistoryResult = EncryptHistoryResult.Done(MigrationReport(converted = 0, unreadable = 3))
        val sw = EncryptSwitch(CoroutineScope(Dispatchers.Unconfined)) { next }
        sw.request(true)
        assertEquals(EncryptNotice.Unreadable(3), sw.notice.value)
        next = EncryptHistoryResult.Done(MigrationReport(converted = 3, unreadable = 0))
        sw.request(false)
        assertNull(sw.notice.value)
    }
}
