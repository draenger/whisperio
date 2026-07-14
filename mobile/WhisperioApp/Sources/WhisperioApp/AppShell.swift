import SwiftUI
import Combine
import WhisperioKit
#if os(iOS)
import UIKit
#endif

// App shell — custom screen routing + toast, mirroring WZPhone() in wz-iphone.jsx.
// (The concept uses a bespoke transition shell rather than NavigationStack.)

#if os(iOS)
// Registers for remote (silent) push notifications so NSPersistentCloudKitContainer can
// receive the CloudKit "database changed" push and wake background sync for
// RecordingSyncStore / DigestStore. A didReceiveRemoteNotification(fetchCompletionHandler:)
// handler is required below — without it iOS never opens a background execution window for
// the silent push, so the persistent container's import only runs while the app happens to
// already be foregrounded/active, not on the "device changed remotely while backgrounded" case
// this exists to solve.
@MainActor
final class WhisperioAppDelegate: NSObject, UIApplicationDelegate {
    // Created here — eagerly, at delegate-instantiation time — rather than by the SwiftUI
    // @StateObject in WhisperioApp.body, which only runs on first view render. A Watch dictation
    // can relaunch the app in the background purely to deliver a WCSessionFile; this guarantees
    // there's already a live store for PhoneConnectivity to add into before that ever happens.
    // WhisperioApp's own `recordings` StateObject wraps this same instance (see below) so there
    // is exactly one RecordingsStore for the process, not two out-of-sync copies.
    static let sharedRecordings = RecordingsStore()

    func application(_ application: UIApplication,
                      didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UIApplication.shared.registerForRemoteNotifications()
        // Activate the Watch bridge from the delegate, not from RootView.onAppear: a background
        // relaunch to deliver a WCSessionFile can invoke session(_:didReceive:) as soon as a
        // delegate exists. If activation instead waited for the SwiftUI view to appear, the
        // framework could call in — and delete the transferred file when the callback returns —
        // before the delegate was ever assigned, silently dropping the dictation with no retry.
        PhoneConnectivity.shared.recordings = Self.sharedRecordings
        PhoneConnectivity.shared.activate()
        return true
    }

    // Apple's NSPersistentCloudKitContainer sample pattern: implementing this handler — even
    // with a trivial body — is what makes iOS grant a background execution window for the
    // CloudKit "database changed" silent push in the first place. The persistent container's
    // remote-change import is already wired to run off that push; this just gives it the time
    // to do so while the app is backgrounded, instead of only importing on next foreground.
    func application(_ application: UIApplication,
                      didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                      fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        completionHandler(.newData)
    }
}
#endif

enum WZScreen { case onboarding, home, recording, detail, settings, models, keyboardSetup, keyboardReturn, keyboardRewrite, presetEditor, journal, digestDay, githubSync, digestPromptEditor }

struct WZPhoneView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @EnvironmentObject private var digestPrompts: DigestPromptStore
    @State private var dark = true
    @State private var screen: WZScreen = .home
    @State private var rec: DemoRecording = WZSample.recordings[0]
    // The day the journal detail screen is showing (.digestDay).
    @State private var digestDay: Date = Date()
    @State private var toastMsg: String?
    // True when the current dictation was launched from the keyboard (bounce-to-app flow):
    // its transcript is written to the App Group and a swipe-back explainer is shown.
    @State private var fromKeyboard = false
    // Transcript awaiting the user's swipe back to the previous app (keyboard bounce flow).
    @State private var returnText = ""
    // Recurring nudge timer for SyncMode.interval — runs only while scenePhase == .active,
    // invalidated the moment the app leaves the foreground. Reconfigured (stop+restart) whenever
    // the phase changes or the user edits syncMode/syncIntervalMinutes in Settings, so a mode
    // change takes effect immediately without a relaunch — see `SyncGating.nextNudgeInterval`.
    @State private var syncNudgeTimer: Timer?
    // The preset the editor screen is editing (a fresh draft for "new"), and the screen to
    // return to when the editor closes (Settings, or Detail for the Template Builder flow).
    @State private var editorPreset: RewritePreset = RewritePresetCatalog.seeds[0]
    @State private var editorReturn: WZScreen = .settings
    @State private var rewriteSource: String = ""
    @State private var rewritePresetID: String = ""
    // Incoming URL binding — set at App level so it fires even before setup completes.
    @Binding private var incomingURL: URL?

    private var t: WZTheme { .of(dark) }

    init(initialScreen: WZScreen = .home, dark: Bool = true, incomingURL: Binding<URL?> = .constant(nil)) {
        _screen = State(initialValue: initialScreen)
        _dark = State(initialValue: dark)
        _incomingURL = incomingURL
    }

    var body: some View {
        ZStack {
            t.bg.ignoresSafeArea()
            content
                .transition(.asymmetric(insertion: .opacity, removal: .opacity))
            if let toastMsg {
                toast(toastMsg)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 48)
            }
        }
        .environment(\.wz, t)
        .preferredColorScheme(dark ? .dark : .light)
        .animation(.easeInOut(duration: 0.28), value: screen)
        .onReceive(NotificationCenter.default.publisher(for: .whisperioStartDictation)) { _ in
            go(.recording)
        }
        .onAppear {
            SharedStore.recordAppHeartbeat()
            consumePending()
            runAutoJournaling()
            if let url = incomingURL { handle(url); incomingURL = nil }
            if scenePhase == .active { restartSyncNudgeTimer() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Drop any stale keyboard-handoff transcript on every transition so dictated text
            // isn't retained in the shared container past its freshness window (a fresh one
            // awaiting swipe-back is kept).
            SharedStore.purgeStalePendingTranscript()
            if phase == .active {
                consumePending()
                runAutoJournaling()
                // A CloudKit import can land silently while backgrounded (or without a push at
                // all, if remote-notification wasn't delivered) — re-check on every foreground so
                // a stalled sync always has recourse beyond waiting for a push. Every mode except
                // `.manual` wants this one-shot foreground nudge (automatic/onOpen/interval all
                // baseline on it) — see `SyncGating.shouldNudgeOnForeground`.
                if SyncGating.shouldNudgeOnForeground(settings.settings.syncMode) {
                    recordings.requestCloudRefresh()
                    digests.requestCloudRefresh()
                }
                restartSyncNudgeTimer()
            } else {
                // Leaving the foreground — a `.interval` timer has no business running while
                // backgrounded/inactive (there is nothing further to nudge, and iOS would suspend
                // it anyway); tearing it down here rather than relying on suspension keeps the
                // invariant explicit and testable-by-inspection.
                stopSyncNudgeTimer()
                // Don't leave the app parked on the post-dictation return screen: once the
                // user leaves (backgrounds the app to go paste / swipe back), drop to home so
                // re-opening — or a Back Tap — lands on a fresh state instead of a dead end.
                if phase == .background, screen == .keyboardReturn { screen = .home }
            }
        }
        .onChange(of: incomingURL) { _, url in
            if let url { handle(url); incomingURL = nil }
        }
        // Read live: a syncMode/interval edit in Settings reconfigures the nudge timer
        // immediately, without requiring the user to relaunch (unlike storageMode).
        .onChange(of: settings.settings.syncMode) { _, _ in
            if scenePhase == .active { restartSyncNudgeTimer() }
        }
        .onChange(of: settings.settings.syncIntervalMinutes) { _, _ in
            if scenePhase == .active { restartSyncNudgeTimer() }
        }
    }

    // Stop any existing timer, then — only in `.interval` mode, only while active — schedule a
    // fresh repeating nudge at the user's chosen cadence. A no-op interval (nil, from
    // `SyncGating.nextNudgeInterval`) for every other mode leaves no timer running: `.automatic`
    // is push-driven, `.onOpen` and `.manual` don't want a recurring timer at all.
    private func restartSyncNudgeTimer() {
        stopSyncNudgeTimer()
        guard let interval = SyncGating.nextNudgeInterval(
            mode: settings.settings.syncMode,
            minutes: settings.settings.syncIntervalMinutes
        ) else { return }
        syncNudgeTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            Task { @MainActor in
                recordings.requestCloudRefresh()
                digests.requestCloudRefresh()
            }
        }
    }

    private func stopSyncNudgeTimer() {
        syncNudgeTimer?.invalidate()
        syncNudgeTimer = nil
    }

    // whisperio://dictate?return=keyboard — the keyboard's bounce-to-app entry point.
    private func handle(_ url: URL) {
        guard url.scheme == "whisperio" else { return }
        if url.host == "dictate" {
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
            fromKeyboard = comps?.queryItems?.first { $0.name == "return" }?.value == "keyboard"
            go(.recording)
        } else if url.host == "rewrite" {
            rewriteSource = SharedStore.consumeRewriteSource() ?? ""
            rewritePresetID = SharedStore.consumeRewritePresetID() ?? "clean-up"
            go(.keyboardRewrite)
        }
    }

    // Pick up a command left by a trigger (widget / Back Tap / Siri), incl. cold launch.
    private func consumePending() {
        switch DictationLaunch.consume() {
        case .start: go(.recording)
        case .stop: NotificationCenter.default.post(name: .whisperioStopDictation, object: nil)
        case .none: break
        }
    }

    @ViewBuilder private var content: some View {
        switch screen {
        case .onboarding:
            OnboardingView { go(.home) }
        case .recording:
            RecordingView(fromKeyboard: fromKeyboard,
                          onCancel: { fromKeyboard = false; go(.home) },
                          onDone: { r in
                              if fromKeyboard {
                                  fromKeyboard = false
                                  returnText = r.transcription ?? ""
                                  go(.keyboardReturn)
                              } else {
                                  rec = DemoRecording(r); go(.detail)
                              }
                          })
        case .detail:
            DetailView(r: rec, onBack: { go(.home) }, toast: showToast,
                       openSettings: { go(.settings) },
                       openPresetEditor: { openEditor($0, from: .detail) })
        case .settings:
            SettingsView(onBack: { go(.home) }, dark: $dark,
                         openModels: { go(.models) },
                         openKeyboardSetup: { go(.keyboardSetup) },
                         openOnboarding: { go(.onboarding) },
                         openPresetEditor: { openEditor($0 ?? Self.newPreset(), from: .settings) },
                         openGitHubSync: { go(.githubSync) },
                         openDigestPrompts: { go(.digestPromptEditor) },
                         toast: showToast)
        case .models:
            ModelsView(onBack: { go(.settings) })
        case .presetEditor:
            PresetEditorView(preset: editorPreset, onBack: { go(editorReturn) }, toast: showToast)
        case .keyboardSetup:
            KeyboardSetupView(onBack: { go(.settings) })
        case .githubSync:
            GitHubSyncView(onBack: { go(.settings) }, toast: showToast)
        case .digestPromptEditor:
            DigestPromptEditorView(onBack: { go(.settings) }, toast: showToast)
        case .keyboardReturn:
            KeyboardReturnView(text: returnText, onClose: { go(.home) })
        case .keyboardRewrite:
            KeyboardRewriteView(source: rewriteSource, presetID: rewritePresetID,
                                onBack: { go(.home) },
                                onDone: { result in
                                    returnText = result
                                    go(.keyboardReturn)
                                })
        case .home:
            HomeView(openRec: { rec = $0; go(.detail) },
                     openRecording: { go(.recording) },
                     openSettings: { go(.settings) },
                     openJournal: { go(.journal) })
        case .journal:
            JournalView(onBack: { go(.home) },
                        openDay: { digestDay = $0; go(.digestDay) })
        case .digestDay:
            DigestDayView(day: digestDay,
                          onBack: { go(.journal) },
                          openRec: { rec = $0; go(.detail) },
                          openSettings: { go(.settings) },
                          toast: showToast)
        }
    }

    // Auto-journaling: when enabled (and the cloud client is configured), backfill summaries for
    // prior days once per day. Runs off the same foreground hook as consumePending().
    private func runAutoJournaling() {
        guard settings.settings.autoDailyDigest else { return }
        let client = settings.makeChatClient()
        guard client.isConfigured else { return }
        let model = settings.settings.chatModel
        Task {
            await digests.backfillIfNeeded(recordings: recordings, categories: WZCategories.all,
                                           using: client, model: model,
                                           promptConfig: digestPrompts.config)
        }
    }

    private func go(_ s: WZScreen) { withAnimation { screen = s } }

    // Open the rewrite-preset editor on `preset`, remembering where to return to on close.
    private func openEditor(_ preset: RewritePreset, from origin: WZScreen) {
        editorPreset = preset
        editorReturn = origin
        go(.presetEditor)
    }

    // A fresh, empty draft for the "New template" create flow.
    private static func newPreset() -> RewritePreset {
        RewritePreset(id: UUID().uuidString, name: "", prompt: "", icon: "spark")
    }

    private func showToast(_ m: String) {
        withAnimation { toastMsg = m }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.7) {
            withAnimation { toastMsg = nil }
        }
    }

    private func toast(_ m: String) -> some View {
        HStack(spacing: 8) {
            WIcon("check", size: 16).foregroundStyle(t.green)
            Text(m).font(WZFont.ui(13.5, .medium)).foregroundStyle(.white)
        }
        .padding(.horizontal, 18).padding(.vertical, 11)
        .background(t.dark ? Color.hex(0x221d33) : Color.hex(0x1b1830),
                    in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .shadow(color: .black.opacity(0.4), radius: 15, y: 12)
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }
}

@main
struct WhisperioApp: App {
#if os(iOS)
    @UIApplicationDelegateAdaptor(WhisperioAppDelegate.self) private var appDelegate
#endif
    @StateObject private var settings = SettingsStore()
#if os(iOS)
    // Same instance the AppDelegate already handed to PhoneConnectivity at launch (see
    // WhisperioAppDelegate.sharedRecordings) — one store for the process, created before this
    // StateObject would otherwise lazily construct its own on first render.
    @StateObject private var recordings = WhisperioAppDelegate.sharedRecordings
#else
    @StateObject private var recordings = RecordingsStore()
#endif
    @StateObject private var presets = PresetStore()
    @StateObject private var digests = DigestStore()
    @StateObject private var digestPrompts = DigestPromptStore()
    @State private var incomingURL: URL?

    var body: some Scene {
        WindowGroup {
            RootView(incomingURL: $incomingURL)
                .environmentObject(settings)
                .environmentObject(recordings)
                .environmentObject(presets)
                .environmentObject(digests)
                .environmentObject(digestPrompts)
                .onAppear {
                    // Both the store assignment and activation now happen in
                    // WhisperioAppDelegate.application(_:didFinishLaunchingWithOptions:), which
                    // runs before this view can ever appear. `recordings` here is already
                    // `WhisperioAppDelegate.sharedRecordings`, so this is a harmless no-op
                    // reassignment kept only as a defensive fallback; PhoneConnectivity.activate()
                    // itself no-ops on an already-activated session, so it's not called again here.
                    PhoneConnectivity.shared.recordings = recordings
                    #if DEBUG
                    seedCloudKitSchema()
                    #endif
                }
                .onOpenURL { incomingURL = $0 }
        }
    }

#if DEBUG
    /// One-time explicit CloudKit schema creation via `initializeCloudKitSchema(options:)`,
    /// covering both `RecordingEntity` and `DigestEntity`, in the DEVELOPMENT environment. Run
    /// this Debug build once on an iOS device/simulator signed into iCloud, then Deploy Schema
    /// Changes to Production in the CloudKit Console. No-ops after the first run. Never ships
    /// (#if DEBUG). Shares the `wz.cloudkit.schema.seeded` UserDefaults gate with the Mac target
    /// (`WhisperioMacApp.seedCloudKitSchema()`) so seeding on either platform satisfies both —
    /// the schema itself is per-container, not per-device.
    @MainActor private func seedCloudKitSchema() {
        let key = "wz.cloudkit.schema.seeded"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        do {
            try WhisperioCloudKit.initializeSchemaForDevelopment()
            UserDefaults.standard.set(true, forKey: key)
            NSLog("[Whisperio] CloudKit schema initialized (RecordingEntity + DigestEntity) — check CloudKit Console (Development).")
        } catch {
            NSLog("[Whisperio] CloudKit schema initialization failed: \(error)")
        }
    }
#endif
}

// Gate: first run shows the engine picker; afterwards the app.
// incomingURL is stored here so a deep link that arrives during setup is not dropped.
private struct RootView: View {
    @EnvironmentObject private var settings: SettingsStore
    @Binding var incomingURL: URL?

    var body: some View {
        if settings.didCompleteSetup {
            WZPhoneView(initialScreen: .home, incomingURL: $incomingURL)
        } else {
            SetupView()
                .environment(\.wz, WZTheme.of(true))
                .preferredColorScheme(.dark)
        }
    }
}

#Preview("Concept gallery") { GalleryView() }
#Preview("Home · dark") { WZPhoneView(initialScreen: .home, dark: true) }
#Preview("Onboarding") { WZPhoneView(initialScreen: .onboarding, dark: true) }
#Preview("Home · light") { WZPhoneView(initialScreen: .home, dark: false) }
