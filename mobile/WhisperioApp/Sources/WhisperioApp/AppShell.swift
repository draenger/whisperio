import SwiftUI

// App shell — custom screen routing + toast, mirroring WZPhone() in wz-iphone.jsx.
// (The concept uses a bespoke transition shell rather than NavigationStack.)

enum WZScreen { case onboarding, home, recording, detail, settings, models }

struct WZPhoneView: View {
    @State private var dark = true
    @State private var screen: WZScreen = .home
    @State private var rec: DemoRecording = WZSample.recordings[0]
    @State private var toastMsg: String?

    private var t: WZTheme { .of(dark) }

    init(initialScreen: WZScreen = .home, dark: Bool = true) {
        _screen = State(initialValue: initialScreen)
        _dark = State(initialValue: dark)
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
    }

    @ViewBuilder private var content: some View {
        switch screen {
        case .onboarding:
            OnboardingView { go(.home) }
        case .recording:
            RecordingView(onCancel: { go(.home) },
                          onDone: { rec = WZSample.recordings[0]; go(.detail) })
        case .detail:
            DetailView(r: rec, onBack: { go(.home) }, toast: showToast)
        case .settings:
            SettingsView(onBack: { go(.home) }, dark: $dark, openModels: { go(.models) })
        case .models:
            ModelsView(onBack: { go(.settings) })
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
    var body: some Scene {
        WindowGroup {
            // Start at onboarding on first run; swap to .home to preview the app directly.
            WZPhoneView(initialScreen: .home, dark: true)
        }
    }
}

#Preview("Home · dark") { WZPhoneView(initialScreen: .home, dark: true) }
#Preview("Onboarding") { WZPhoneView(initialScreen: .onboarding, dark: true) }
#Preview("Home · light") { WZPhoneView(initialScreen: .home, dark: false) }
