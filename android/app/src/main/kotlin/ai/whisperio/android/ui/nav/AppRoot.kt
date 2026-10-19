package ai.whisperio.android.ui.nav

import ai.whisperio.android.BuildConfig
import ai.whisperio.android.R
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.dictation.computeSetupStatus
import ai.whisperio.android.dictation.primaryProvider
import ai.whisperio.android.di.AppGraph
import ai.whisperio.android.dictate.WhisperioTileService
import ai.whisperio.android.graph
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.CustomCategories
import ai.whisperio.android.settings.KeyEnrollment
import ai.whisperio.android.settings.KeyUi
import ai.whisperio.android.ui.about.AboutScreen
import ai.whisperio.android.ui.common.confirmHaptic
import ai.whisperio.android.ui.common.copyPlainText
import ai.whisperio.android.ui.common.label
import ai.whisperio.android.ui.common.rememberCategoryOptions
import ai.whisperio.android.ui.history.HistoryDetailActions
import ai.whisperio.android.ui.history.HistoryDetailScreen
import ai.whisperio.android.ui.history.HistoryListScreen
import ai.whisperio.android.ui.history.PlayerAvailability
import ai.whisperio.android.ui.history.PlayerUi
import ai.whisperio.android.ui.history.RetryChoiceUi
import ai.whisperio.android.ui.history.RetryWithUi
import ai.whisperio.android.ui.history.playerAvailability
import ai.whisperio.android.ui.history.rememberAudioPlayer
import ai.whisperio.android.ui.history.shouldStopPlayback
import ai.whisperio.android.ui.common.errorText
import ai.whisperio.android.dictation.RetryOutcome
import ai.whisperio.android.dictation.retryChoices
import ai.whisperio.android.settings.toChainSettings
import java.io.File
import ai.whisperio.android.ui.history.rememberExporter
import ai.whisperio.android.ui.home.HomeActions
import ai.whisperio.android.ui.home.HomeScreen
import ai.whisperio.android.ui.home.HomeState
import ai.whisperio.android.ui.onboarding.OnboardingActions
import ai.whisperio.android.ui.onboarding.OnboardingScreen
import ai.whisperio.android.ui.onboarding.OnboardingState
import ai.whisperio.android.ui.onboarding.OnboardingStep
import ai.whisperio.android.ui.onboarding.TryItCommand
import ai.whisperio.android.ui.onboarding.TryItSession
import ai.whisperio.android.ui.onboarding.tryItCanStop
import ai.whisperio.android.ui.onboarding.tryItLeave
import ai.whisperio.android.ui.onboarding.tryItPendingStale
import ai.whisperio.android.ui.onboarding.tryItShouldAck
import ai.whisperio.android.ui.onboarding.tryItView
import ai.whisperio.android.ui.settings.CategoriesActions
import ai.whisperio.android.ui.settings.CategoriesScreen
import ai.whisperio.android.ui.recap.RecapScreen
import ai.whisperio.android.ui.recap.RecapShare
import ai.whisperio.android.ui.recap.toRecapItems
import ai.whisperio.android.ui.settings.KeyDialogState
import ai.whisperio.android.ui.settings.SettingsActions
import ai.whisperio.android.ui.settings.SettingsScreen
import ai.whisperio.android.ui.settings.SettingsUiState
import ai.whisperio.core.ExportFormat
import ai.whisperio.core.Recap
import ai.whisperio.core.ProviderId
import android.Manifest
import android.app.Activity
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import android.view.inputmethod.InputMethodManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon as M3Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private object Routes {
    const val HOME = "home"
    const val HISTORY = "history"
    const val SETTINGS = "settings"
    const val ABOUT = "about"
    const val CATEGORIES = "settings/categories"
    const val RECAP = "recap"
    const val DETAIL = "history/{id}"
    fun detail(id: String) = "history/$id"
}

@Composable
fun AppRoot() {
    val g = LocalContext.current.graph
    val settings by g.settings.flow.collectAsState(initial = null)
    val s = settings ?: return // first DataStore read; avoids flashing onboarding for returning users
    // Try-it bookkeeping lives here (not in OnboardingRoute) so it outlives onboarding: a transcription still in flight
    // when the user finishes is acknowledged silently instead of surfacing on Home.
    var tryActive by rememberSaveable { mutableStateOf(false) }
    var tryPending by rememberSaveable { mutableStateOf(false) }
    val tryIt = TryItSession(tryActive, tryPending)
    val dictation by g.dictation.state.collectAsState()
    LaunchedEffect(dictation, tryPending) {
        if (tryItShouldAck(dictation, tryIt)) {
            g.dictation.acknowledge()
            tryPending = false
        } else if (tryItPendingStale(dictation, tryIt)) {
            tryPending = false // never acknowledge: the controller is not transcribing anything of ours any more
        }
    }
    if (!s.onboardingDone) {
        OnboardingRoute(g, s, tryIt) { tryActive = it.active; tryPending = it.pendingAck }
    } else {
        MainShell(g)
    }
}

// region onboarding

@Composable
private fun OnboardingRoute(g: AppGraph, current: AppSettings, tryIt: TryItSession, setTryIt: (TryItSession) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var stepIndex by rememberSaveable { mutableStateOf(0) }
    var providerWire by rememberSaveable { mutableStateOf(ProviderId.OPENAI.wire) }
    var language by rememberSaveable { mutableStateOf(current.language) }
    var keyInput by remember { mutableStateOf("") } // never saved to instance state
    var baseUrl by remember { mutableStateOf("") }
    var keyUi by remember { mutableStateOf<KeyUi>(KeyUi.Idle) }
    var micGranted by remember { mutableStateOf(g.micGranted()) }
    var keyboardEnabled by remember { mutableStateOf(isKeyboardEnabled(ctx)) }
    val configured by g.secrets.configured.collectAsState(initial = emptySet())
    val provider = ProviderId.fromWire(providerWire) ?: ProviderId.OPENAI
    val enrollment = remember { KeyEnrollment(g.keyChecker, g.secrets, g.settings) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        micGranted = g.micGranted()
        keyboardEnabled = isKeyboardEnabled(ctx)
    }
    val dictation by g.dictation.state.collectAsState()
    var startAfterMic by remember { mutableStateOf(false) }
    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        micGranted = granted
        if (granted && startAfterMic) {
            setTryIt(TryItSession(active = true))
            g.dictation.start(StartOptions(RecordingSource.APP))
        }
        startAfterMic = false
    }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        // Same rule as Home: leaving the app ends a try-it recording; a rotation does not.
        val s = g.dictation.state.value
        val changing = (ctx as? Activity)?.isChangingConfigurations == true
        if (!changing && s is DictationState.Recording && s.source == RecordingSource.APP) g.dictation.cancel()
    }
    // Leaves nothing behind when the step is left or onboarding ends.
    fun clearTry() {
        val leave = tryItLeave(g.dictation.state.value, tryIt)
        when (leave.command) {
            TryItCommand.CANCEL -> g.dictation.cancel()
            TryItCommand.ACKNOWLEDGE -> g.dictation.acknowledge()
            TryItCommand.NONE -> Unit
        }
        setTryIt(leave.session)
    }

    val actions = object : OnboardingActions {
        override fun onNext() { stepIndex = (stepIndex + 1).coerceAtMost(OnboardingStep.entries.lastIndex) }
        override fun onBack() { clearTry(); stepIndex = (stepIndex - 1).coerceAtLeast(0) }
        override fun onConsent(value: Boolean) { scope.launch { g.settings.setConsent(value) } }
        override fun onProvider(id: ProviderId) {
            providerWire = id.wire
            keyInput = ""
            baseUrl = ""
            keyUi = KeyUi.Idle
        }
        override fun onKeyChange(value: String) { keyInput = value; keyUi = KeyUi.Idle }
        override fun onBaseUrlChange(value: String) { baseUrl = value; keyUi = KeyUi.Idle }
        override fun onSubmitKey() {
            scope.launch {
                keyUi = KeyUi.Validating
                keyUi = enrollment.validateAndSave(provider, keyInput, baseUrl)
                if (keyUi is KeyUi.Valid) {
                    // The provider the user just set up goes first.
                    val order = g.settings.current().order
                    g.settings.setOrder(order.sortedBy { if (it.id == provider) 0 else 1 })
                    keyInput = ""
                }
            }
        }
        override fun onLanguage(code: String) {
            language = code
            scope.launch { g.settings.setLanguage(code) }
        }
        override fun onGrantMic() { micLauncher.launch(Manifest.permission.RECORD_AUDIO) }
        override fun onOpenKeyboardSettings() { ctx.startActivity(Intent(AndroidSettings.ACTION_INPUT_METHOD_SETTINGS)) }
        override fun onAddTile() { requestAddTile(ctx) }
        override fun onTryDictate() {
            if (g.micGranted()) {
                setTryIt(TryItSession(active = true))
                g.dictation.start(StartOptions(RecordingSource.APP))
            } else {
                startAfterMic = true
                micLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
        override fun onTryStop() { if (tryItCanStop(g.dictation.state.value, tryIt)) g.dictation.stopAndTranscribe() }
        override fun onTryDismiss() { if (tryIt.active) g.dictation.acknowledge() }
        override fun onFinish() {
            clearTry()
            scope.launch { g.settings.setOnboardingDone(true) }
        }
    }
    OnboardingScreen(
        state = OnboardingState(
            step = OnboardingStep.entries[stepIndex],
            consent = current.cloudConsentGranted,
            provider = provider,
            keyInput = keyInput,
            baseUrl = baseUrl,
            keyUi = keyUi,
            language = language,
            micGranted = micGranted,
            keyboardEnabled = keyboardEnabled,
            canAddTile = Build.VERSION.SDK_INT >= 33,
            providerReady = provider in configured,
            dictation = tryItView(dictation, tryIt),
        ),
        actions = actions,
    )
}

private fun isKeyboardEnabled(ctx: android.content.Context): Boolean {
    val imm = ctx.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as InputMethodManager
    return imm.enabledInputMethodList.any { it.packageName == ctx.packageName }
}

private fun requestAddTile(ctx: android.content.Context) {
    if (Build.VERSION.SDK_INT < 33) return
    val sbm = ctx.getSystemService(StatusBarManager::class.java) ?: return
    sbm.requestAddTileService(
        ComponentName(ctx, WhisperioTileService::class.java),
        ctx.getString(R.string.tile_label),
        Icon.createWithResource(ctx, R.drawable.ic_tile_mic),
        ctx.mainExecutor,
    ) { }
}

// endregion

// region shell

private data class TopLevel(val route: String, val label: Int, val icon: ImageVector)

private val topLevel = listOf(
    TopLevel(Routes.HOME, R.string.nav_home, Icons.Filled.Home),
    TopLevel(Routes.HISTORY, R.string.nav_history, Icons.Filled.History),
    TopLevel(Routes.SETTINGS, R.string.nav_settings, Icons.Filled.Settings),
)

@Composable
private fun MainShell(g: AppGraph) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val snackbar = remember { SnackbarHostState() }
    // F9: a finished transcription ticks while this window is on screen (confirmHaptic ignores a detached view).
    val shellView = LocalView.current
    LaunchedEffect(Unit) { g.dictation.results.collect { r ->
        // Keyboard / DictateActivity sessions buzz in their own window; only this app's own results tick here.
        if (r.session == null && r.source == RecordingSource.APP) shellView.confirmHaptic()
    } }
    // CONTRACT-1.2 F5: going to the background commits a pending History delete. (ProcessLifecycleOwner is not a
    // dependency, so this is the activity's own ON_STOP; a rotation also stops the activity and is skipped.)
    val shellCtx = LocalContext.current
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        if ((shellCtx as? Activity)?.isChangingConfigurations != true) g.pendingDelete.flush()
    }
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (route in topLevel.map { it.route }) {
                NavigationBar {
                    topLevel.forEach { t ->
                        NavigationBarItem(
                            selected = route == t.route,
                            onClick = {
                                nav.navigate(t.route) {
                                    popUpTo(Routes.HOME) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { M3Icon(t.icon, contentDescription = null) },
                            label = { Text(stringResource(t.label)) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = Routes.HOME, modifier = Modifier.padding(padding)) {
            composable(Routes.HOME) { HomeRoute(g, nav) }
            composable(Routes.HISTORY) { HistoryRoute(g, nav, snackbar) }
            composable(Routes.DETAIL) { entry -> DetailRoute(g, nav, entry.arguments?.getString("id").orEmpty(), snackbar) }
            composable(Routes.SETTINGS) { SettingsRoute(g, nav) }
            composable(Routes.CATEGORIES) { CategoriesRoute(g, nav) }
            composable(Routes.RECAP) { RecapRoute(g, nav, snackbar) }
            composable(Routes.ABOUT) {
                val ctx = LocalContext.current
                AboutScreen(
                    versionName = BuildConfig.VERSION_NAME,
                    versionCode = BuildConfig.VERSION_CODE,
                    onBack = { nav.popBackStack() },
                    onOpenUrl = { url -> ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) },
                )
            }
        }
    }
}

@Composable
private fun HomeRoute(g: AppGraph, nav: NavHostController) {
    val ctx = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val dictation by g.dictation.state.collectAsState()
    val recent by g.history.observeRecent(5).collectAsState(initial = emptyList())
    val customCategories by g.settings.customCategories.collectAsState(initial = emptyList())
    val settings by g.settings.flow.collectAsState(initial = AppSettings(order = g.settings.defaultOrder()))
    val keys by g.secrets.configured.collectAsState(initial = emptySet())
    var mic by remember { mutableStateOf(g.micGranted()) }
    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        mic = granted
        if (granted) g.dictation.start(StartOptions(RecordingSource.APP))
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { mic = g.micGranted() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        // Leaving the app stops the recording (no foreground service); a rotation does not.
        val s = g.dictation.state.value
        val changing = (ctx as? Activity)?.isChangingConfigurations == true
        if (!changing && s is DictationState.Recording && s.source == RecordingSource.APP) g.dictation.cancel()
    }
    val setup = computeSetupStatus(settings, keys, mic)
    val primary = settings.primaryProvider(keys)
    Box(Modifier.statusBarsPadding(), contentAlignment = Alignment.TopCenter) {
        HomeScreen(
            state = HomeState(
                dictation = dictation,
                recent = recent,
                setupNeeded = !setup.ready,
                providerLabel = primary?.let { "${it.first.label(ctx)} - ${it.second}" }.orEmpty(),
                customCategories = customCategories,
            ),
            actions = object : HomeActions {
                override fun onDictate() {
                    if (g.micGranted()) g.dictation.start(StartOptions(RecordingSource.APP))
                    else micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
                override fun onStop() = g.dictation.stopAndTranscribe()
                override fun onCopy(text: String) {
                    scope.launch { copyPlainText(ctx, text, g.settings.current().transcriptsSensitive) }
                    view.confirmHaptic()
                }
                override fun onDismissResult() = g.dictation.acknowledge()
                override fun onOpen(id: String) = nav.navigate(Routes.detail(id))
                override fun onSeeAll() = nav.navigate(Routes.HISTORY)
                override fun onOpenSetup() {
                    if (!mic && setup.hasKey && setup.consent) {
                        micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    } else {
                        scope.launch { g.settings.setOnboardingDone(false) } // re-opens the guided setup
                    }
                }
            },
        )
    }
}

@Composable
private fun HistoryRoute(g: AppGraph, nav: NavHostController, snackbar: SnackbarHostState) {
    val items by g.history.observeAll().collectAsState(initial = emptyList())
    var exported by remember { mutableIntStateOf(0) }
    val export = rememberExporter(g.history, snackbar, onSuccess = { exported++ })
    val ctx = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val pending by g.pendingDelete.pendingId.collectAsState()
    // CONTRACT-1.2 F5: one "Deleted / Undo" snackbar per pending item. Keyed on the pending id so a second swipe
    // replaces it (the first was committed by the controller) and a rotation re-shows it.
    val deletedText = stringResource(R.string.deleted_message)
    val undoText = stringResource(R.string.action_undo)
    LaunchedEffect(pending) {
        val id = pending ?: return@LaunchedEffect
        // Undo must never queue behind another snackbar (e.g. "Copied").
        snackbar.currentSnackbarData?.dismiss()
        val result = snackbar.showSnackbar(deletedText, actionLabel = undoText, duration = SnackbarDuration.Long)
        if (result == SnackbarResult.ActionPerformed) g.pendingDelete.undo(id) else g.pendingDelete.settle(id)
    }
    // Leaving History (tab, detail) commits; a rotation keeps the Undo window.
    DisposableEffect(Unit) {
        onDispose { if ((ctx as? Activity)?.isChangingConfigurations != true) g.pendingDelete.flush() }
    }
    // Fixed per day so the day-header grouping is cached instead of recomputed on every recomposition.
    val today = LocalDate.now()
    val now = remember(today) { System.currentTimeMillis() }
    val customCategories by g.settings.customCategories.collectAsState(initial = emptyList())
    HistoryListScreen(
        items,
        customCategories = customCategories,
        onOpen = { nav.navigate(Routes.detail(it)) },
        onExport = { rows, format -> g.pendingDelete.flush(); export(rows, format) },
        now = now,
        clearSelectionToken = exported,
        hiddenId = pending,
        onSwipeDelete = { g.pendingDelete.swipe(it) },
        onCopy = { text ->
            scope.launch { copyPlainText(ctx, text, g.settings.current().transcriptsSensitive) }
            view.confirmHaptic()
            // A "Copied" snackbar would queue behind (or dismiss) the Undo window, so the tick alone confirms then.
            if (g.pendingDelete.pendingId.value == null) {
                scope.launch {
                    snackbar.currentSnackbarData?.dismiss()
                    snackbar.showSnackbar(ctx.getString(R.string.copied_toast), duration = SnackbarDuration.Short)
                }
            }
        },
        onDeleteDay = { ids -> g.pendingDelete.deleteDay(ids) },
        onSelectionStart = { g.pendingDelete.flush() },
        onOpenRecap = { nav.navigate(Routes.RECAP) },
    )
}

@Composable
private fun RecapRoute(g: AppGraph, nav: NavHostController, snackbar: SnackbarHostState) {
    val ctx = LocalContext.current
    val allItems by g.history.observeAll().collectAsState(initial = emptyList())
    // The History row waiting for Undo is not part of the recap (CONTRACT-1.2 F5).
    val pendingId by g.pendingDelete.pendingId.collectAsState()
    val items = remember(allItems, pendingId) { if (pendingId == null) allItems else allItems.filter { it.id != pendingId } }
    val customCategories by g.settings.customCategories.collectAsState(initial = emptyList())
    val categoryOptions = rememberCategoryOptions(customCategories)
    val zone = ZoneId.systemDefault()
    val now = remember(items) { System.currentTimeMillis() }
    val stats = remember(items, now, zone) { Recap.compute(items.toRecapItems(), now, zone) }
    val scope = rememberCoroutineScope()
    var sharing by remember { mutableStateOf(false) }
    val failedText = stringResource(R.string.recap_share_failed)
    RecapScreen(
        stats = stats,
        onBack = { nav.popBackStack() },
        sharing = sharing,
        onShare = {
            if (!sharing) {
                sharing = true
                scope.launch {
                    try {
                        ctx.startActivity(RecapShare.buildChooser(ctx, stats))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        snackbar.showSnackbar(failedText)
                    } finally {
                        sharing = false
                    }
                }
            }
        },
        providerLabel = { ProviderId.fromWire(it)?.label(ctx) ?: it },
        categoryLabel = { id -> categoryOptions.firstOrNull { it.id == id }?.label ?: id },
    )
}

@Composable
private fun DetailRoute(g: AppGraph, nav: NavHostController, id: String, snackbar: SnackbarHostState) {
    val ctx = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val rec by g.history.observe(id).collectAsState(initial = null)
    val export = rememberExporter(g.history, snackbar)
    val customCategories by g.settings.customCategories.collectAsState(initial = emptyList())

    // F4: the player. Hidden when the file is gone, disabled while recording, released when a recording starts.
    val dictation by g.dictation.state.collectAsState()
    val audioPath = rec?.audioPath
    val audioExists = remember(audioPath, rec?.status) { audioPath != null && File(audioPath).exists() }
    val availability = playerAvailability(audioExists, recording = dictation is DictationState.Recording)
    val player = rememberAudioPlayer(audioPath.orEmpty(), (rec?.durationMs ?: 0L).toInt(), stop = shouldStopPlayback(dictation))
    val playerUi = if (availability == PlayerAvailability.HIDDEN) null else PlayerUi(
        playing = player.playing,
        positionMs = player.positionMs,
        durationMs = player.durationMs,
        enabled = availability == PlayerAvailability.READY,
        onToggle = player::toggle,
        onSeek = player::seekTo,
    )

    // F5: only providers with a key (self-hosted: a URL), in the user's order. The key text is irrelevant here.
    val settings by g.settings.flow.collectAsState(initial = AppSettings(order = g.settings.defaultOrder()))
    val keys by g.secrets.configured.collectAsState(initial = emptySet())
    val choices = retryChoices(settings.toChainSettings(ProviderId.entries.associateWith { if (it in keys) "configured" else null }))
        .map { RetryChoiceUi(it.id, it.id.label(ctx), it.model) }
    val busy = dictation is DictationState.Recording || dictation is DictationState.Transcribing
    val retryUi = RetryWithUi(choices, audioAvailable = audioExists, busy = busy, retrying = busy && g.dictation.activeId() == id)

    var failure by remember { mutableStateOf<RetryOutcome.Failure?>(null) }
    LaunchedEffect(id) {
        g.dictation.retryOutcomes.collect { o ->
            if (o.recordingId != id) return@collect
            when (o) {
                is RetryOutcome.Success -> view.confirmHaptic()
                is RetryOutcome.Failure -> failure = o
            }
        }
    }
    val failureText = failure?.let { stringResource(R.string.retry_failed, errorText(it.error, it.detail)) }
    LaunchedEffect(failure) {
        if (failureText != null) {
            snackbar.showSnackbar(failureText)
            failure = null
        }
    }

    run {
        HistoryDetailScreen(
            rec = rec,
            customCategories = customCategories,
            player = playerUi,
            retryWith = retryUi,
            actions = object : HistoryDetailActions {
                override fun onBack() { nav.popBackStack() }
                override fun onCopy(text: String) {
                    scope.launch { copyPlainText(ctx, text, g.settings.current().transcriptsSensitive) }
                    view.confirmHaptic()
                }
                override fun onShare(text: String) {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                    ctx.startActivity(Intent.createChooser(send, null))
                }
                override fun onSetCategory(id: String, category: String?) { g.appScope.launch { g.history.setCategory(id, category) } }
                override fun onRetry(id: String) = g.dictation.retry(id)
                override fun onRetryWith(id: String, provider: ProviderId) = g.dictation.retryWith(id, provider)
                override fun onExport(rec: Recording, format: ExportFormat) = export(listOf(rec), format)
                override fun onDelete(id: String) {
                    scope.launch { g.history.delete(id) }
                    nav.popBackStack()
                }
            },
        )
    }
}

@Composable
private fun CategoriesRoute(g: AppGraph, nav: NavHostController) {
    val scope = rememberCoroutineScope()
    val customs by g.settings.customCategories.collectAsState(initial = emptyList())
    CategoriesScreen(
        customs = customs,
        actions = object : CategoriesActions {
            override fun onBack() { nav.popBackStack() }
            override fun onAdd(name: String) { g.appScope.launch { g.settings.addCustomCategory(name, CustomCategories.SEED_LABELS) } }
            override fun onDelete(id: String) { scope.launch { g.deleteCategory(id) } }
        },
    )
}

@Composable
private fun SettingsRoute(g: AppGraph, nav: NavHostController) {
    val scope = rememberCoroutineScope()
    val settings by g.settings.flow.collectAsState(initial = AppSettings(order = g.settings.defaultOrder()))
    val configured by g.secrets.configured.collectAsState(initial = emptySet())
    val lost by g.secrets.lost.collectAsState()
    val appLanguageCount by g.appLanguages.count.collectAsState(initial = 0)
    var dialog by remember { mutableStateOf<KeyDialogState?>(null) }
    var keyChecks by remember { mutableStateOf<Map<ProviderId, KeyUi>>(emptyMap()) }
    val enrollment = remember { KeyEnrollment(g.keyChecker, g.secrets, g.settings) }
    val models = remember { ProviderId.entries.associateWith { g.catalog.models(it) } }
    val openAiUrl = settings.baseUrls[ProviderId.OPENAI]

    LaunchedEffect(settings.autoDeleteDays) { g.runMaintenance() }

    val actions = object : SettingsActions {
        override fun onMove(id: ProviderId, delta: Int) { scope.launch { g.settings.move(id, delta) } }
        override fun onModel(id: ProviderId, model: String) { scope.launch { g.settings.setModel(id, model) } }
        override fun onOpenKeyDialog(id: ProviderId) {
            dialog = KeyDialogState(id, baseUrl = settings.baseUrls[id].orEmpty())
        }
        override fun onRemoveKey(id: ProviderId) {
            keyChecks = keyChecks - id
            scope.launch { g.secrets.remove(id) }
        }
        override fun onCheckKey(id: ProviderId) {
            scope.launch {
                keyChecks = keyChecks + (id to KeyUi.Validating)
                val result = try {
                    enrollment.recheck(id)
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    KeyUi.Network(e.message.orEmpty())
                }
                keyChecks = keyChecks + (id to result)
            }
        }
        override fun onKeyDialogKey(value: String) { dialog = dialog?.copy(key = value, ui = KeyUi.Idle) }
        override fun onKeyDialogUrl(value: String) { dialog = dialog?.copy(baseUrl = value, ui = KeyUi.Idle) }
        override fun onKeyDialogSubmit() {
            val d = dialog ?: return
            scope.launch {
                dialog = d.copy(ui = KeyUi.Validating)
                val result = enrollment.validateAndSave(d.provider, d.key, d.baseUrl)
                dialog = dialog?.copy(ui = result, key = if (result is KeyUi.Valid) "" else d.key)
                if (result is KeyUi.Valid) keyChecks = keyChecks - d.provider // a stale check result must not outlive the new key
            }
        }
        override fun onKeyDialogDismiss() { dialog = null }
        override fun onFallback(value: Boolean) { scope.launch { g.settings.setFallback(value) } }
        override fun onLanguage(code: String) { scope.launch { g.settings.setLanguage(code) } }
        override fun onPerAppLanguage(value: Boolean) { scope.launch { g.setPerAppLanguage(value) } }
        override fun onClearAppLanguages() { scope.launch { g.appLanguages.clear() } }
        override fun onVocabulary(value: String) { scope.launch { g.settings.setVocabulary(value) } }
        override fun onCleanup(value: Boolean) { scope.launch { g.settings.setCleanup(value) } }
        override fun onAutoStop(seconds: Int) { scope.launch { g.settings.setAutoStop(seconds) } }
        override fun onKeepAudio(value: Boolean) { scope.launch { g.settings.setKeepAudio(value) } }
        override fun onAutoDelete(days: Int?) { scope.launch { g.settings.setAutoDeleteDays(days) } }
        override fun onSensitive(value: Boolean) { scope.launch { g.settings.setSensitive(value) } }
        override fun onConsent(value: Boolean) { scope.launch { g.settings.setConsent(value) } }
        override fun onDeleteAllAudio() { scope.launch { g.history.deleteAllAudio() } }
        override fun onEraseAll() { scope.launch { g.eraseAllData() } }
        override fun onCategories() { nav.navigate(Routes.CATEGORIES) }
        override fun onAbout() { nav.navigate(Routes.ABOUT) }
    }
    run {
        SettingsScreen(
            state = SettingsUiState(
                settings = settings,
                configured = configured,
                lost = lost,
                models = models,
                customHost = !openAiUrl.isNullOrBlank() && !g.hostPolicy.isOfficialHost(openAiUrl),
                keyDialog = dialog,
                keyChecks = keyChecks,
                appLanguageCount = appLanguageCount,
            ),
            actions = actions,
        )
    }
}

// endregion
