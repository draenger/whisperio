package ai.whisperio.android.di

import ai.whisperio.android.audio.MediaRecorderAudioRecorder
import ai.whisperio.android.audio.SystemAudioFocusGate
import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.dictation.SetupStatus
import ai.whisperio.android.dictation.computeSetupStatus
import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.RoomHistoryStore
import ai.whisperio.android.security.AndroidKeystoreCipher
import ai.whisperio.android.security.KeystoreSecretStore
import ai.whisperio.android.security.SecretStore
import ai.whisperio.android.settings.SettingsRepository
import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

private val Context.settingsDataStore by preferencesDataStore(name = "settings")
private val Context.secretsDataStore by preferencesDataStore(name = "secrets")

/** Manual DI (no Hilt, CONTRACT 3). One instance on [ai.whisperio.android.WhisperioApp]. */
@OptIn(ExperimentalCoroutinesApi::class)
class AppGraph(private val app: Application) {

    /** Single-threaded so DictationController state changes are serialised; never cancelled. */
    val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))

    val recordingsDir: File by lazy { File(app.filesDir, "recordings") }

    val secrets: SecretStore by lazy { KeystoreSecretStore(app.secretsDataStore, AndroidKeystoreCipher()) }
    val catalog: ModelCatalog by lazy { CoreModelCatalog() }
    val settings: SettingsRepository by lazy { SettingsRepository(app.settingsDataStore, secrets, catalog) }

    private val database: AppDatabase by lazy {
        Room.databaseBuilder(app, AppDatabase::class.java, "whisperio.db").build()
    }
    val history: HistoryStore by lazy { RoomHistoryStore(database.recordings(), recordingsDir) }

    val transcriber: Transcriber by lazy { CoreTranscriber() }
    val keyChecker: KeyChecker by lazy { CoreKeyChecker() }
    val textTidy: TextTidy by lazy { CoreTextTidy() }
    val hostPolicy: HostPolicy by lazy { CoreHostPolicy() }

    fun micGranted(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    val dictation: DictationController by lazy {
        DictationController(
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
        )
    }

    /** Re-evaluated whenever settings or keys change; [micGranted] is passed by the caller because it can change at any time. */
    fun setupStatus(mic: Flow<Boolean>): Flow<SetupStatus> =
        combine(settings.flow, secrets.configured, mic) { s, keys, granted -> computeSetupStatus(s, keys, granted) }

    /** Startup sweep (CONTRACT 6) and retention (CONTRACT 7.3). Safe to call repeatedly. */
    fun runMaintenance() {
        appScope.launch {
            history.sweepInterrupted()
            settings.current().autoDeleteDays?.let { days ->
                history.deleteOlderThan(System.currentTimeMillis() - days * 86_400_000L)
            }
        }
    }

    /** "Erase all data" (CONTRACT 7.3): history, audio, keys and settings. */
    suspend fun eraseAllData() {
        dictation.cancel()
        history.clear()
        secrets.clear()
        settings.clear()
    }
}
