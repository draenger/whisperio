import SwiftUI
import Combine
import WhisperioKit

// App shell — custom screen routing + toast, mirroring WZPhone() in wz-iphone.jsx.
// (The concept uses a bespoke transition shell rather than NavigationStack.)

enum WZScreen { case onboarding, home, recording, detail, settings, models, keyboardSetup, keyboardReturn, presetEditor, journal, digestDay }

struct WZPhoneView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
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
    // The preset the editor screen is editing (a fresh draft for "new"), and the screen to
    // return to when the editor closes (Settings, or Detail for the Template Builder flow).
    @State private var editorPreset: RewritePreset = RewritePresetCatalog.seeds[0]
    @State private var editorReturn: WZScreen = .settings
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
        }
        .onChange(of: scenePhase) { _, phase in
            // Drop any stale keyboard-handoff transcript on every transition so dictated text
            // isn't retained in the shared container past its freshness window (a fresh one
            // awaiting swipe-back is kept).
            SharedStore.purgeStalePendingTranscript()
            if phase == .active { consumePending(); runAutoJournaling() }
            // Don't leave the app parked on the post-dictation return screen: once the
            // user leaves (backgrounds the app to go paste / swipe back), drop to home so
            // re-opening — or a Back Tap — lands on a fresh state instead of a dead end.
            else if phase == .background, screen == .keyboardReturn { screen = .home }
        }
        .onChange(of: incomingURL) { _, url in
            if let url { handle(url); incomingURL = nil }
        }
    }

    // whisperio://dictate?return=keyboard — the keyboard's bounce-to-app entry point.
    private func handle(_ url: URL) {
        guard url.scheme == "whisperio" else { return }
        if url.host == "dictate" {
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
            fromKeyboard = comps?.queryItems?.first { $0.name == "return" }?.value == "keyboard"
            go(.recording)
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
                         openPresetEditor: { openEditor($0 ?? Self.newPreset(), from: .settings) },
                         toast: showToast)
        case .models:
            ModelsView(onBack: { go(.settings) })
        case .presetEditor:
            PresetEditorView(preset: editorPreset, onBack: { go(editorReturn) }, toast: showToast)
        case .keyboardSetup:
            KeyboardSetupView(onBack: { go(.settings) })
        case .keyboardReturn:
            KeyboardReturnView(text: returnText, onClose: { go(.home) })
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
                                           using: client, model: model)
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
    @StateObject private var settings = SettingsStore()
    @StateObject private var recordings = RecordingsStore()
    @StateObject private var presets = PresetStore()
    @StateObject private var digests = DigestStore()
    @State private var incomingURL: URL?

    var body: some Scene {
        WindowGroup {
            RootView(incomingURL: $incomingURL)
                .environmentObject(settings)
                .environmentObject(recordings)
                .environmentObject(presets)
                .environmentObject(digests)
                .onAppear {
                    PhoneConnectivity.shared.recordings = recordings
                    PhoneConnectivity.shared.activate()
                }
                .onOpenURL { incomingURL = $0 }
        }
    }
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
