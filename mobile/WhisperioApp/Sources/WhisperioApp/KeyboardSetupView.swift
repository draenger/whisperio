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
    @EnvironmentObject private var settings: SettingsStore
    // This screen runs in the main app, so unlike the keyboard extension it can read the real
    // engine chain directly — the copy below claims on-device only when the primary engine is.
    private var engineIsOnDevice: Bool {
        (settings.settings.providerChain.first ?? .onDevice) == .onDevice
    }
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
                                explainerRow("mic", engineIsOnDevice
                                    ? "Whisperio opens and records on-device"
                                    : "Whisperio opens and records — transcribed by your cloud engine")
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
                Text(engineIsOnDevice
                    ? "A mic key on your keyboard, powered by on-device transcription."
                    : "A mic key on your keyboard — dictations use your configured cloud engine.")
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
// Shown after a keyboard-initiated dictation finishes. iOS does NOT let an app return
// to the previous one programmatically, and the bottom-bar swipe is unreliable — so the
// transcript is ALWAYS put on the clipboard (guaranteed paste) and the screen leads with
// the two dependable ways back: the system "← [app]" pill (top-left, appears after a URL
// launch) and a manual paste. The keyboard also auto-inserts on its next viewWillAppear.
struct KeyboardReturnView: View {
    @Environment(\.wz) private var t
    var text: String
    var onClose: () -> Void
    @State private var nudge = false

    var body: some View {
        ScreenScaffold(bg: t.bg) {
            VStack(spacing: 0) {
                // Arrow pointing at the top-left, where iOS shows the "← [app]" back pill.
                HStack(spacing: 8) {
                    Image(systemName: "arrow.up.left")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(t.accentLite)
                        .offset(x: nudge ? -4 : 2, y: nudge ? -4 : 2)
                    Text("Go back via “← \(Text("app name").italic())” in the top-left corner")
                        .font(WZFont.ui(12.5, .medium)).foregroundStyle(t.muted)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 18).padding(.top, 4)

                Spacer(minLength: 14)

                WGhost(size: 56).padding(.bottom, 14)
                Text("Done — text is on the clipboard")
                    .font(WZFont.display(22, .semibold)).foregroundStyle(t.text)
                    .multilineTextAlignment(.center)
                Text("Return to your app — Whisperio will paste the text for you. If it doesn’t, **press and hold the field → Paste** (the text is on the clipboard).")
                    .font(WZFont.ui(14)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(3)
                    .padding(.horizontal, 30).padding(.top, 8)

                if !text.isEmpty {
                    ScrollView {
                        Text(text).font(WZFont.ui(15)).foregroundStyle(t.text)
                            .frame(maxWidth: .infinity, alignment: .leading).lineSpacing(4)
                    }
                    .frame(maxHeight: 140)
                    .padding(16)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.line, lineWidth: 1))
                    .padding(.horizontal, 22).padding(.top, 18)

                    HStack(spacing: 6) {
                        WIcon("check", size: 12).foregroundStyle(t.green)
                        Text("On the clipboard — ready to paste")
                            .font(WZFont.mono(11.5)).foregroundStyle(t.green)
                    }.padding(.top, 12)
                }

                Spacer()

                // Last-resort hint: the (flaky) bottom-bar swipe, over a faux home indicator.
                VStack(spacing: 12) {
                    Text("or swipe right along the bottom bar ↓")
                        .font(WZFont.ui(11.5)).foregroundStyle(t.faint)
                    Capsule().fill(t.text.opacity(0.5)).frame(width: 140, height: 5)
                        .offset(x: nudge ? 10 : -6)
                }
                .padding(.bottom, 8)

                Button(action: onClose) {
                    Text("Stay in Whisperio").font(WZFont.ui(13, .medium)).foregroundStyle(t.muted)
                }
                .padding(.top, 6).padding(.bottom, 16)
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true)) { nudge = true }
        }
    }
}
