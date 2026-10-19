package ai.whisperio.android.screenshot

import ai.whisperio.android.dictate.DictateScreen
import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.ime.ImePanel
import ai.whisperio.android.ime.ImePanelActions
import ai.whisperio.android.ime.ImePanelState
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.KeyUi
import ai.whisperio.android.settings.ProviderSlot
import ai.whisperio.android.ui.common.KeyEntry
import ai.whisperio.android.ui.history.HistoryDetailActions
import ai.whisperio.android.ui.history.HistoryDetailScreen
import ai.whisperio.android.ui.history.HistoryFilters
import ai.whisperio.android.ui.history.HistoryListScreen
import ai.whisperio.android.ui.home.HomeActions
import ai.whisperio.android.ui.home.HomeScreen
import ai.whisperio.android.ui.home.HomeState
import ai.whisperio.android.ui.settings.KeyDialogState
import ai.whisperio.android.ui.settings.SettingsActions
import ai.whisperio.android.ui.settings.SettingsScreen
import ai.whisperio.android.ui.settings.SettingsUiState
import ai.whisperio.core.ProviderId
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.ZoneOffset

private const val PHONE = ScreenshotConfig.PHONE

@Composable
private fun DictateFixture(s: DictationState, setup: Boolean = false) =
    DictateScreen(s, {}, {}, {}, {}, {}, needsSetup = setup)

/** Fixed clock and zone: day headers (Today / Yesterday / date) must not depend on the wall clock. */
@Composable
private fun HistoryFixture(
    items: List<Recording> = Fx.all + Fx.notInserted,
    initial: HistoryFilters = HistoryFilters(),
    selection: Set<String> = emptySet(),
) = HistoryListScreen(
    items, onOpen = {}, now = Fx.NOW, zone = ZoneOffset.UTC, initial = initial, initialSelection = selection,
)

private val settingsFixture = AppSettings(
    order = listOf(
        ProviderSlot(ProviderId.OPENAI, "whisper-1"),
        ProviderSlot(ProviderId.GROQ, "whisper-large-v3-turbo"),
        ProviderSlot(ProviderId.SELFHOSTED, "whisper-1"),
    ),
    cloudConsentGranted = true,
    cleanupEnabled = true,
    autoStopSeconds = 10,
    vocabulary = "Whisperio, Kasprzyk",
    language = "pl",
    onboardingDone = true,
)

private val modelsFixture = mapOf(
    ProviderId.OPENAI to listOf("whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"),
    ProviderId.GROQ to listOf("whisper-large-v3-turbo", "whisper-large-v3"),
    ProviderId.SELFHOSTED to listOf("whisper-1"),
)

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class HomeSnapshotTest {
    @get:Rule val rule = createComposeRule()
    private val noop = object : HomeActions {}

    @Test @Config(qualifiers = PHONE)
    fun idle() = rule.snapshot("home_idle") {
        HomeScreen(HomeState(recent = Fx.all, providerLabel = "OpenAI - whisper-1"), noop)
    }

    @Test @Config(qualifiers = PHONE)
    fun idleDark() = rule.snapshot("home_idle", dark = true) {
        HomeScreen(HomeState(recent = Fx.all, providerLabel = "OpenAI - whisper-1"), noop)
    }

    @Test @Config(qualifiers = PHONE)
    fun recording() = rule.snapshot("home_recording") {
        HomeScreen(
            HomeState(DictationState.Recording(0.6f, 7_000, false, RecordingSource.APP), Fx.all, providerLabel = "OpenAI - whisper-1"),
            noop,
        )
    }

    @Test @Config(qualifiers = PHONE)
    fun done() = rule.snapshot("home_done") {
        HomeScreen(HomeState(DictationState.Done(Fx.done.transcript!!, "r1", RecordingSource.APP), Fx.all, providerLabel = "OpenAI - whisper-1"), noop)
    }

    @Test @Config(qualifiers = PHONE)
    fun setupNeeded() = rule.snapshot("home_setup_needed") {
        HomeScreen(HomeState(setupNeeded = true), noop)
    }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun idleTablet() = rule.snapshot("home_idle_tablet") {
        HomeScreen(HomeState(recent = Fx.all, providerLabel = "OpenAI - whisper-1"), noop)
    }

    @Test @Config(qualifiers = PHONE)
    fun idleFontScale2() = rule.snapshot("home_idle_font2", fontScale = 2f) {
        HomeScreen(HomeState(recent = Fx.all, providerLabel = "OpenAI - whisper-1"), noop)
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class HomeSnapshotPlTest : HomeSnapshotTest()

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class HistorySnapshotTest {
    @get:Rule val rule = createComposeRule()

    @Test @Config(qualifiers = PHONE)
    fun list() = rule.snapshot("history_list") { HistoryFixture() }

    @Test @Config(qualifiers = PHONE)
    fun listDark() = rule.snapshot("history_list", dark = true) { HistoryFixture() }

    @Test @Config(qualifiers = PHONE)
    fun empty() = rule.snapshot("history_empty") { HistoryFixture(items = emptyList()) }

    @Test @Config(qualifiers = PHONE)
    fun listSearch() = rule.snapshot("history_list_search") {
        HistoryFixture(initial = HistoryFilters(query = Loc.t("invoice", "fakturę")))
    }

    @Test @Config(qualifiers = PHONE)
    fun listSearchNoResults() = rule.snapshot("history_list_search_empty") {
        HistoryFixture(initial = HistoryFilters(query = "zzz"))
    }

    @Test @Config(qualifiers = PHONE)
    fun listChips() = rule.snapshot("history_list_chips") {
        HistoryFixture(initial = HistoryFilters(sources = setOf(RecordingSource.KEYBOARD, RecordingSource.TILE)))
    }

    @Test @Config(qualifiers = PHONE)
    fun listChipsFailedDark() = rule.snapshot("history_list_chips_failed", dark = true) {
        HistoryFixture(initial = HistoryFilters(failedOnly = true))
    }

    @Test @Config(qualifiers = PHONE)
    fun listSelection() = rule.snapshot("history_list_selection") { HistoryFixture(selection = setOf("r1", "r3")) }

    @Test @Config(qualifiers = PHONE)
    fun listSelectionDark() = rule.snapshot("history_list_selection", dark = true) { HistoryFixture(selection = setOf("r1", "r3")) }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun listSearchTablet() = rule.snapshot("history_list_search_tablet") {
        HistoryFixture(initial = HistoryFilters(query = Loc.t("invoice", "fakturę"), sources = setOf(RecordingSource.KEYBOARD)))
    }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun listSelectionTablet() = rule.snapshot("history_list_selection_tablet") { HistoryFixture(selection = setOf("r2")) }

    @Test @Config(qualifiers = PHONE)
    fun listChipsFontScale2() = rule.snapshot("history_list_chips_font2", fontScale = 2f) {
        HistoryFixture(initial = HistoryFilters(query = Loc.t("invoice", "fakturę"), sources = setOf(RecordingSource.KEYBOARD)))
    }

    @Test @Config(qualifiers = PHONE)
    fun listSelectionFontScale2() = rule.snapshot("history_list_selection_font2", fontScale = 2f) {
        HistoryFixture(selection = setOf("r1", "r3"))
    }

    @Test @Config(qualifiers = PHONE)
    fun detail() = rule.snapshot("history_detail") { HistoryDetailScreen(Fx.notInserted, object : HistoryDetailActions {}) }

    @Test @Config(qualifiers = PHONE)
    fun detailFailedDark() = rule.snapshot("history_detail_failed", dark = true) {
        HistoryDetailScreen(Fx.failed, object : HistoryDetailActions {})
    }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun listTablet() = rule.snapshot("history_list_tablet") { HistoryFixture() }

    @Test @Config(qualifiers = PHONE)
    fun listFontScale2() = rule.snapshot("history_list_font2", fontScale = 2f) { HistoryFixture() }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun detailTablet() = rule.snapshot("history_detail_tablet") { HistoryDetailScreen(Fx.notInserted, object : HistoryDetailActions {}) }

    @Test @Config(qualifiers = PHONE)
    fun detailFontScale2() = rule.snapshot("history_detail_font2", fontScale = 2f) {
        HistoryDetailScreen(Fx.notInserted, object : HistoryDetailActions {})
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class HistorySnapshotPlTest : HistorySnapshotTest()

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class SettingsSnapshotTest {
    @get:Rule val rule = createComposeRule()
    private val noop = object : SettingsActions {}

    private fun state(
        customHost: Boolean = false,
        dialog: KeyDialogState? = null,
    ) = SettingsUiState(
        settings = if (customHost) settingsFixture.copy(baseUrls = mapOf(ProviderId.OPENAI to "http://192.168.1.20:8000/v1")) else settingsFixture,
        configured = setOf(ProviderId.OPENAI),
        lost = setOf(ProviderId.GROQ),
        models = modelsFixture,
        customHost = customHost,
        keyDialog = dialog,
    )

    @Test @Config(qualifiers = PHONE)
    fun light() = rule.snapshot("settings") { SettingsScreen(state(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun dark() = rule.snapshot("settings", dark = true) { SettingsScreen(state(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun customHost() = rule.snapshot("settings_custom_host") { SettingsScreen(state(customHost = true), noop) }

    @Test @Config(qualifiers = PHONE)
    // AlertDialog opens a separate window that never idles under Robolectric and that onRoot()
    // cannot capture, so the dialog body (the same KeyEntry the dialog hosts) is rendered inline.
    fun keyDialog() = rule.snapshot("settings_key_dialog") {
        Card(Modifier.padding(24.dp)) {
            KeyEntry(
                provider = ProviderId.GROQ, key = "gsk_example", baseUrl = "", ui = KeyUi.Invalid,
                onKeyChange = {}, onBaseUrlChange = {}, onSubmit = {}, modifier = Modifier.padding(24.dp),
            )
        }
    }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun tablet() = rule.snapshot("settings_tablet") { SettingsScreen(state(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun fontScale2() = rule.snapshot("settings_font2", fontScale = 2f) { SettingsScreen(state(), noop) }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class SettingsSnapshotPlTest : SettingsSnapshotTest()

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class ImePanelSnapshotTest {
    @get:Rule val rule = createComposeRule()

    private val noop = ImePanelActions({}, {}, {}, {}, {}, {}, {})
    private fun st(
        d: DictationState = DictationState.Idle,
        password: Boolean = false,
        setup: Boolean = false,
    ) = ImePanelState(d, password, setup, "OpenAI - whisper-1")

    private val rec = DictationState.Recording(0.55f, 8_000, false, RecordingSource.KEYBOARD)

    @Test @Config(qualifiers = PHONE)
    fun idle() = rule.snapshot("ime_idle") { ImePanel(st(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun idleDark() = rule.snapshot("ime_idle", dark = true) { ImePanel(st(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun recording() = rule.snapshot("ime_recording") { ImePanel(st(rec), noop) }

    @Test @Config(qualifiers = PHONE)
    fun recordingDark() = rule.snapshot("ime_recording", dark = true) { ImePanel(st(rec), noop) }

    @Test @Config(qualifiers = PHONE)
    fun transcribing() = rule.snapshot("ime_transcribing") { ImePanel(st(DictationState.Transcribing(RecordingSource.KEYBOARD)), noop) }

    @Test @Config(qualifiers = PHONE)
    fun error() = rule.snapshot("ime_error") {
        ImePanel(st(DictationState.Error(DictationError.PROVIDER, "HTTP 401: Incorrect API key provided.")), noop)
    }

    @Test @Config(qualifiers = PHONE)
    fun silentMic() = rule.snapshot("ime_silent_mic") { ImePanel(st(DictationState.Error(DictationError.SILENT_MIC)), noop) }

    @Test @Config(qualifiers = PHONE)
    fun passwordField() = rule.snapshot("ime_password") { ImePanel(st(password = true), noop) }

    @Test @Config(qualifiers = PHONE)
    fun setupNeeded() = rule.snapshot("ime_setup_needed") { ImePanel(st(setup = true), noop) }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun tablet() = rule.snapshot("ime_tablet_idle") { ImePanel(st(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun fontScale2Idle() = rule.snapshot("ime_font2_idle", fontScale = 2f) { ImePanel(st(), noop) }

    @Test @Config(qualifiers = PHONE)
    fun fontScale2Error() = rule.snapshot("ime_font2_error", fontScale = 2f) {
        ImePanel(st(DictationState.Error(DictationError.NO_KEY)), noop)
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class ImePanelSnapshotPlTest : ImePanelSnapshotTest()

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class DictateSnapshotTest {
    @get:Rule val rule = createComposeRule()

    @Test @Config(qualifiers = PHONE)
    fun recording() = rule.snapshot("dictate_recording") {
        DictateFixture(DictationState.Recording(0.5f, 4_000, false, RecordingSource.TILE))
    }

    @Test @Config(qualifiers = PHONE)
    fun transcribing() = rule.snapshot("dictate_transcribing") { DictateFixture(DictationState.Transcribing(RecordingSource.TILE)) }

    @Test @Config(qualifiers = PHONE)
    fun done() = rule.snapshot("dictate_done") { DictateFixture(DictationState.Done(Fx.doneTile.transcript!!, "r2", RecordingSource.TILE)) }

    @Test @Config(qualifiers = PHONE)
    fun doneDark() = rule.snapshot("dictate_done", dark = true) {
        DictateFixture(DictationState.Done(Fx.doneTile.transcript!!, "r2", RecordingSource.TILE))
    }

    @Test @Config(qualifiers = PHONE)
    fun errorSetup() = rule.snapshot("dictate_error_setup") { DictateFixture(DictationState.Error(DictationError.NO_KEY), setup = true) }

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun tablet() = rule.snapshot("dictate_tablet") {
        DictateFixture(DictationState.Recording(0.5f, 4_000, false, RecordingSource.TILE))
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class DictateSnapshotPlTest : DictateSnapshotTest()
