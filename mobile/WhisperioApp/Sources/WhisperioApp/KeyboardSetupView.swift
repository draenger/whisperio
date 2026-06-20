import SwiftUI
import WhisperioKit
#if canImport(UIKit)
import UIKit
#endif

// Guided install workflow for the Whisperio keyboard. iOS gives no API to read whether a
// keyboard is enabled or has Full Access, so we detect what we reliably can:
//   • "added at least once" — the extension writes a heartbeat to the shared App Group
//     the first time it loads; we read it here.
// Everything else is presented as clear, checkable step state with deep links into Settings.
struct KeyboardSetupView: View {
    @Environment(\.wz) private var t
    @Environment(\.scenePhase) private var scenePhase
    var onBack: () -> Void

    @State private var keyboardSeen = SharedStore.keyboardEverLoaded

    private func refresh() { keyboardSeen = SharedStore.keyboardEverLoaded }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Whisperio keyboard", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        hero

                        VStack(alignment: .leading, spacing: 9) {
                            SectionLabel(text: "Set it up").padding(.leading, 4)
                            VStack(spacing: 0) {
                                step(1, "Open Keyboard settings",
                                     "Settings → General → Keyboard → Keyboards → Add New Keyboard → Whisperio.",
                                     done: keyboardSeen)
                                step(2, "Enable “Allow Full Access”",
                                     "Tap Whisperio in the keyboards list and turn on Allow Full Access — the mic key needs it to open the app.",
                                     done: false, last: true)
                            }
                            .padding(.horizontal, 16)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        GradButton(title: "Open Settings", icon: "settings") { openSettings() }

                        statusCard

                        VStack(alignment: .leading, spacing: 9) {
                            SectionLabel(text: "How the mic works").padding(.leading, 4)
                            VStack(alignment: .leading, spacing: 10) {
                                explainerRow("keyboard", "Tap the mic on the keyboard")
                                explainerRow("mic", "Whisperio opens and records on-device")
                                explainerRow("arrowUR", "Swipe back — the text is inserted for you")
                            }
                            .padding(16)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        Text("Honest by design: iOS never lets a keyboard paste silently into another app. Whisperio records in the app, then hands the text back when you return — nothing happens behind your back.")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
        .onAppear(perform: refresh)
        .onChange(of: scenePhase) { _, p in if p == .active { refresh() } }
    }

    private var hero: some View {
        HStack(spacing: 14) {
            WIcon("keyboard", size: 24).foregroundStyle(.white)
                .frame(width: 54, height: 54)
                .background(t.gradient, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("Dictate from any app").font(WZFont.display(18)).foregroundStyle(t.text)
                Text("A mic key on your keyboard, powered by on-device transcription.")
                    .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(2)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private var statusCard: some View {
        StateBanner(
            tone: keyboardSeen ? .ok : .warn,
            icon: keyboardSeen ? "check" : "keyboard",
            title: keyboardSeen ? "Keyboard detected" : "Keyboard not added yet",
            sub: keyboardSeen
                ? "Whisperio has run as a keyboard on this device. If the mic says “Allow Full Access”, finish step 2."
                : "Add it in Settings, then come back — this updates automatically."
        )
    }

    private func step(_ n: Int, _ title: String, _ sub: String, done: Bool, last: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 13) {
            ZStack {
                Circle().fill(done ? t.green.opacity(0.18) : t.surfaceUp)
                    .overlay(Circle().stroke(done ? t.green.opacity(0.5) : t.line, lineWidth: 1))
                    .frame(width: 30, height: 30)
                if done { WIcon("check", size: 14).foregroundStyle(t.green) }
                else { Text("\(n)").font(WZFont.mono(13, .semibold)).foregroundStyle(t.muted) }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                Text(sub).font(WZFont.ui(12.5)).foregroundStyle(t.muted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(t.lineSoft).frame(height: 1) } }
    }

    private func explainerRow(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 11) {
            WIcon(icon, size: 16, weight: .regular).foregroundStyle(t.accentLite)
                .frame(width: 32, height: 32)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(text).font(WZFont.ui(13.5)).foregroundStyle(t.text)
            Spacer(minLength: 0)
        }
    }

    private func openSettings() {
#if canImport(UIKit)
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
#endif
    }
}

// One-time explainer shown after the first keyboard-initiated dictation, telling the user
// to swipe back to the keyboard so the transcript gets inserted.
struct SwipeBackExplainer: View {
    @Environment(\.wz) private var t
    var onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.62).ignoresSafeArea().onTapGesture(perform: onDismiss)
            VStack(spacing: 16) {
                WIcon("arrowUR", size: 26).foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(t.gradient, in: Circle())
                Text("Swipe back to insert").font(WZFont.display(19)).foregroundStyle(t.text)
                Text("Your text is ready. Swipe back to the keyboard (or switch to the app you were typing in) and Whisperio drops it right where your cursor was.")
                    .font(WZFont.ui(14)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(3)
                GradButton(title: "Got it", icon: "check", action: onDismiss)
            }
            .padding(24)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(t.line, lineWidth: 1))
            .padding(.horizontal, 32)
        }
    }
}
