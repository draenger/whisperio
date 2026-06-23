import SwiftUI
import Combine
import WhisperioKit

// App shell — custom screen routing + toast, mirroring WZPhone() in wz-iphone.jsx.
// (The concept uses a bespoke transition shell rather than NavigationStack.)

enum WZScreen { case onboarding, home, recording, detail, settings, models, keyboardSetup, keyboardReturn }

struct WZPhoneView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var dark = true
    @State private var screen: WZScreen = .home
    @State private var rec: DemoRecording = WZSample.recordings[0]
    @State private var toastMsg: String?
    // True when the current dictation was launched from the keyboard (bounce-to-app flow):
    // its transcript is written to the App Group and a swipe-back explainer is shown.
    @State private var fromKeyboard = false
    // Transcript awaiting the user's swipe back to the previous app (keyboard bounce flow).
    @State private var returnText = ""
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
            if let url = incomingURL { handle(url); incomingURL = nil }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { consumePending() }
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
            DetailView(r: rec, onBack: { go(.home) }, toast: showToast)
        case .settings:
            SettingsView(onBack: { go(.home) }, dark: $dark,
                         openModels: { go(.models) },
                         openKeyboardSetup: { go(.keyboardSetup) })
        case .models:
            ModelsView(onBack: { go(.settings) })
        case .keyboardSetup:
            KeyboardSetupView(onBack: { go(.settings) })
        case .keyboardReturn:
            KeyboardReturnView(text: returnText, onClose: { go(.home) })
        case .home:
            HomeView(openRec: { rec = $0; go(.detail) },
                     openRecording: { go(.recording) },
                     openSettings: { go(.settings) })
        }
    }

    private func go(_ s: WZScreen) { withAnimation { screen = s } }

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
    @State private var incomingURL: URL?

    var body: some Scene {
        WindowGroup {
            RootView(incomingURL: $incomingURL)
                .environmentObject(settings)
                .environmentObject(recordings)
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
