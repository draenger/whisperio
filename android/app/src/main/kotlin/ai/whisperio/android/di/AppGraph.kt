package ai.whisperio.android.di

import ai.whisperio.android.audio.MediaRecorderAudioRecorder
import ai.whisperio.android.audio.SystemAudioFocusGate
import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.dictation.SetupStatus
import ai.whisperio.android.dictation.computeSetupStatus
import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.AudioMigration
import ai.whisperio.android.history.EncryptingHistoryStore
import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.MIGRATION_1_2
import ai.whisperio.android.history.MigrationReport
import ai.whisperio.android.history.RoomHistoryStore
import ai.whisperio.android.security.AndroidKeystoreCipher
import ai.whisperio.android.security.AudioCipher
import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.DataStoreWrappedKeyStore
import ai.whisperio.android.security.Decrypted
import ai.whisperio.android.security.KeystoreSecretStore
import ai.whisperio.android.security.SecretStore
import ai.whisperio.android.settings.AppLanguageStore
import ai.whisperio.android.settings.SettingsRepository
import ai.whisperio.android.ui.history.PendingDeleteController
import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private val Context.settingsDataStore by preferencesDataStore(name = "settings")
private val Context.secretsDataStore by preferencesDataStore(name = "secrets")
private val Context.appLanguagesDataStore by preferencesDataStore(name = "app_languages")
private val Context.dataKeyDataStore by preferencesDataStore(name = "data_key")

/** Outcome of [AppGraph.setEncryptHistory]. */
sealed interface EncryptHistoryResult {
    /** Flag saved and rows migrated; [report] counts rows rewritten and rows that could not be read. */
    data class Done(val report: MigrationReport) : EncryptHistoryResult

    /** Turning ON was refused because the data key could not be created or used (fail closed, flag stays OFF). */
    data object KeystoreUnavailable : EncryptHistoryResult
}

/** Manual DI (no Hilt, CONTRACT 3). One instance on [ai.whisperio.android.WhisperioApp]. */
@OptIn(ExperimentalCoroutinesApi::class)
class AppGraph private constructor(private val appOrNull: Application?, private val o: Overrides?) {

    /** Production path: everything is built lazily from the Application. */
    constructor(app: Application) : this(app, null)

    /** Test seam: injects the collaborators that need real Keystore / files; [app] is then never touched. */
    internal class Overrides(
        val appScope: CoroutineScope,
        val database: AppDatabase,
        val secrets: SecretStore,
        val settings: SettingsRepository,
        val recordingsDir: File,
        val dictation: DictationController,
        val appLanguages: AppLanguageStore? = null,
        val shareDir: File? = null,
        /** Null = plain history store (tests that do not exercise encryption). */
        val dataCipher: DataCipher? = null,
    )

    internal constructor(overrides: Overrides) : this(null, overrides)

    private val app: Application get() = checkNotNull(appOrNull) { "no Application in test graph" }

    /** Single-threaded so DictationController state changes are serialised; never cancelled. */
    val appScope: CoroutineScope =
        o?.appScope ?: CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))

    val recordingsDir: File by lazy { o?.recordingsDir ?: File(app.filesDir, "recordings") }

    /** `cacheDir/share/`: the recap card PNG (CONTRACT-1.2 F2); deleted by [eraseAllData]. Null only in a test graph without one. */
    private val shareDir: File? by lazy { o?.shareDir ?: appOrNull?.let { File(it.cacheDir, "share") } }

    val secrets: SecretStore by lazy { o?.secrets ?: KeystoreSecretStore(app.secretsDataStore, AndroidKeystoreCipher()) }
    val catalog: ModelCatalog by lazy { CoreModelCatalog() }
    val settings: SettingsRepository by lazy { o?.settings ?: SettingsRepository(app.settingsDataStore, secrets, catalog) }

    /** F7 per-app language map: private DataStore, never logged or exported. */
    val appLanguages: AppLanguageStore by lazy {
        o?.appLanguages ?: AppLanguageStore(app.appLanguagesDataStore)
    }

    /** The "Remember language per app" switch; turning it off deletes the map (CONTRACT-1.1 F7). */
    suspend fun setPerAppLanguage(enabled: Boolean) {
        appScope.launch {
            settings.setPerAppLanguage(enabled)
            if (!enabled) appLanguages.clear()
        }.join()
    }

    private val database: AppDatabase by lazy {
        o?.database ?: Room.databaseBuilder(app, AppDatabase::class.java, "whisperio.db").addMigrations(MIGRATION_1_2).build()
    }
    /** History DEK wrapped by its own Keystore key (opt-in encryption). Null only in a test graph without one. */
    private val dataCipher: DataCipher? by lazy {
        if (o != null) {
            o.dataCipher
        } else {
            DataCipher(dataKek!!, DataStoreWrappedKeyStore(app.dataKeyDataStore))
        }
    }

    /** Kept clips (`<id>.m4a.wea`); shares the history data key. Null only in a test graph without a cipher. */
    val audioCipher: AudioCipher? by lazy { dataCipher?.let(::AudioCipher) }

    private val audioMigration: AudioMigration? by lazy { audioCipher?.let { AudioMigration(database.recordings(), it) } }

    /** Seals/opens the kept clips after the row text; the active recording's own file is left for the next run. */
    private suspend fun migrateAudio(enabled: Boolean, report: MigrationReport): MigrationReport {
        val a = audioMigration?.migrate(enabled, dictation.activeId()) ?: return report
        return report.copy(audioConverted = a.converted, audioUnreadable = a.unreadable)
    }

    /** The Keystore key that wraps the history DEK; null in a test graph (no Android Keystore on the JVM). */
    private val dataKek: AndroidKeystoreCipher? by lazy {
        if (o != null) null else AndroidKeystoreCipher(DataStoreWrappedKeyStore.DATA_KEK_ALIAS)
    }

    /** Transcripts are sealed on write only while [AppSettings.encryptHistory] is ON; reads always decrypt what they find. */
    private val encryptingHistory: EncryptingHistoryStore? by lazy {
        dataCipher?.let { c ->
            EncryptingHistoryStore(RoomHistoryStore(database.recordings(), recordingsDir), database.recordings(), c) {
                settings.current().encryptHistory
            }
        }
    }

    val history: HistoryStore by lazy { encryptingHistory ?: RoomHistoryStore(database.recordings(), recordingsDir) }

    /** CONTRACT-1.2 F5: the one swiped-away History row waiting for its Undo window. */
    val pendingDelete: PendingDeleteController by lazy { PendingDeleteController(appScope, history) }

    val transcriber: Transcriber by lazy { CoreTranscriber() }
    val keyChecker: KeyChecker by lazy { CoreKeyChecker() }
    val textTidy: TextTidy by lazy { CoreTextTidy() }
    val hostPolicy: HostPolicy by lazy { CoreHostPolicy() }

    fun micGranted(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    val dictation: DictationController by lazy {
        o?.dictation ?: DictationController(
            scope = appScope,
            recorder = MediaRecorderAudioRecorder(app),
            focus = SystemAudioFocusGate(app),
            transcriber = transcriber,
            settings = settings,
            history = history,
            tidy = textTidy,
            recordingsDir = recordingsDir,
            micGranted = ::micGranted,
            nowMs = SystemClock::elapsedRealtime,
            audioCipher = audioCipher,
            encryptAudio = { settings.current().encryptHistory },
        )
    }

    /** Re-evaluated whenever settings or keys change; [micGranted] is passed by the caller because it can change at any time. */
    fun setupStatus(mic: Flow<Boolean>): Flow<SetupStatus> =
        combine(settings.flow, secrets.configured, mic) { s, keys, granted -> computeSetupStatus(s, keys, granted) }

    /**
     * The "Encrypt history" switch. ON: proves the data key works (fail closed), saves the flag so new rows are
     * sealed, then seals existing rows. OFF: saves the flag, then opens existing rows. Runs in [appScope] (never
     * cancelled); a run killed half-way leaves a readable mix that [runMaintenance] finishes on the next start.
     */
    suspend fun setEncryptHistory(enabled: Boolean): EncryptHistoryResult {
        var result: EncryptHistoryResult = EncryptHistoryResult.KeystoreUnavailable
        appScope.launch {
            // Suspending coroutines interleave even on a single-parallelism dispatcher, so switches and
            // maintenance are serialised by this lock instead.
            maintenanceLock.withLock {
                val store = encryptingHistory ?: return@withLock
                if (enabled && !dataKeyUsable()) return@withLock
                settings.setEncryptHistory(enabled)
                result = EncryptHistoryResult.Done(migrateAudio(enabled, store.migrate(enabled)))
            }
        }.join()
        return result
    }

    /** Held for the whole of [setEncryptHistory] and [runMaintenance]: no migration or sweep overlaps another. */
    private val maintenanceLock = Mutex()

    private suspend fun dataKeyUsable(): Boolean {
        val c = dataCipher ?: return false
        return try {
            c.openText(c.sealText(KEY_PROBE)) == Decrypted.Ok(KEY_PROBE)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
    }

    /** Startup sweep (CONTRACT 6) and retention (CONTRACT 7.3). Safe to call repeatedly. */
    fun runMaintenance() {
        appScope.launch {
            maintenanceLock.withLock {
                history.sweepInterrupted(dictation.activeId())
                history.sweepOrphanAudio(dictation.activeFile())
                settings.current().autoDeleteDays?.let { days ->
                    history.deleteOlderThan(System.currentTimeMillis() - days * 86_400_000L)
                }
                // Finish an encryption switch interrupted by process death, or seal rows written while the key failed
                // (no-op when every row is already in place). Last, so a slow pass never delays the sweeps above.
                encryptingHistory?.let { store ->
                    val on = settings.current().encryptHistory
                    if (!on || dataKeyUsable()) migrateAudio(on, store.migrate(on))
                }
            }
        }
    }

    /** CONTRACT-1.2 F3: deletes a custom category and sets every recording that carried it back to none. */
    suspend fun deleteCategory(id: String) {
        appScope.launch {
            history.clearCategory(id)
            settings.removeCustomCategory(id)
        }.join()
    }

    /** Best effort per step: a Keystore error must not stop Erase all from deleting the data itself. */
    private suspend fun shredDataKey() {
        var wrappedKeyLeft = false
        try {
            dataCipher?.shred()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            wrappedKeyLeft = true // the KEK deletion below still makes it unusable, but it must not stay behind
        }
        try {
            dataKek?.deleteKey()
        } catch (e: Exception) {
            // Keystore unavailable: the wrapped DEK is already gone (or will be with the DataStore files).
        }
        if (wrappedKeyLeft) {
            // A dead wrapped DEK left behind would make DataCipher refuse to mint a new key (it never replaces an
            // existing one), so the feature would stay "not available" for good. One more try, best effort.
            try {
                dataCipher?.shred()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Still failing: the rest of the erase goes on.
            }
        }
    }

    private companion object {
        const val KEY_PROBE = "whisperio-key-probe"
    }

    /**
     * "Erase all data" (CONTRACT 7.3): history, audio, keys and settings. Crypto-shred first (design 4.3): the wrapped
     * history key and its Keystore key go before any row or file, so even if the rest is interrupted or flash keeps
     * old blocks, everything that was encrypted stays unreadable.
     */
    suspend fun eraseAllData() {
        // Runs entirely in appScope (single-threaded, never cancelled) so leaving the screen cannot stop it midway;
        // abortAll() first guarantees no in-flight transcription writes a row after the wipe.
        appScope.launch {
            dictation.abortAll()
            pendingDelete.drop()
            // Waits for a running encryption switch / maintenance pass, so none writes a file after the wipe.
            maintenanceLock.withLock {
                shredDataKey()
                history.clear()
                secrets.clear()
                settings.clear()
                appLanguages.clear()
                shareDir?.deleteRecursively()
            }
        }.join()
    }
}
