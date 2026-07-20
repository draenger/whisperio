import SwiftUI
import WhisperioKit
#if canImport(UIKit)
import UIKit
#endif

// First-run onboarding — port of wz2/mob-onboarding.jsx (OnboardingScene).
// Steps: 0 welcome (ghost, "Speak it. / Whisperio types.", "Get started")
//        1 privacy ("Your words stay yours", On-device card + optional cloud-provider card)
//        2 languages ("Confirm your languages", chips from keyboards, auto-detect note)
//        3 keyboard ("Turn on the Whisperio keyboard", Keyboards row + toggles card,
//          "Go to Settings" → busy → "Keyboard ready — let's try it")
//        4 back-tap ("Set up Back-Tap", 3 numbered Settings steps, honest "can't confirm" note)
//        5 first note ("Try whispering a note", Notes mock + mini keyboard, mic →
//          listening → "Inserted · on-device"; Next disabled until done)
//        6 capture anywhere ("Capture from anywhere", grid of trigger tiles)
//        7 more than a transcript (feature rows: group transcription, journal, rewrite, vocab)
//        8 ready ("You're ready", PrivacyBadge reflecting the real chosen provider)
// Progress bar: 8 segments, back chevron, Skip on steps 3-7.
struct OnboardingView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    var done: () -> Void

    private static let note = "Things to do today: pick up the dry cleaning, book a table for four on Friday."
    private static let allLangs: [(String, String)] = [
        ("pl", "Polski"), ("en", "English"), ("de", "Deutsch"), ("es", "Español"),
        ("fr", "Français"), ("it", "Italiano"), ("pt", "Português"), ("uk", "Українська")
    ]

    private enum TryState { case idle, listening, done }

    @State private var step = 0
    @State private var langs: [String] = ["pl", "en"]
    @State private var kbOn = false
    @State private var kbFA = false
    @State private var kbBusy = false
    @State private var tryState: TryState = .idle
    @State private var typed = ""
    @State private var typeTask: Task<Void, Never>?
    @State private var settingsTask: Task<Void, Never>?
    @State private var showProviderSheet = false
    @State private var providerPick: ProviderID = .elevenLabs
    @State private var providerKeyInput = ""
    @State private var providerBusy = false
    @State private var providerError: String? = nil
    @State private var btVisitedSettings = false
    @State private var btOpeningSettings = false

    private var kbReady: Bool { kbOn && kbFA }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                if step > 0 { progress }
                Group { stepBody }
                    .id(step)
                    .transition(.opacity)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                footer
            }
            .animation(.easeInOut(duration: 0.32), value: step)
        }
        .onDisappear { typeTask?.cancel(); settingsTask?.cancel() }
        .sheet(isPresented: $showProviderSheet) {
            ProviderConnectSheet(pick: $providerPick, keyInput: $providerKeyInput,
                                 busy: $providerBusy, error: $providerError,
                                 onConnected: { showProviderSheet = false })
                .environmentObject(settings)
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
    }

    private func next() { withAnimation(.easeInOut(duration: 0.32)) { step = min(step + 1, 8) } }
    private func back() { withAnimation(.easeInOut(duration: 0.32)) { step = max(step - 1, 0) } }

    // MARK: - Progress bar (back chevron · 8 segments · Skip on steps 3-7)
    private var progress: some View {
        HStack(spacing: 12) {
            Button(action: back) {
                WIcon("chevL", size: 19).foregroundStyle(t.text)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            HStack(spacing: 7) {
                ForEach(1...8, id: \.self) { i in
                    Capsule().fill(i <= step ? t.accent : t.surfaceUp)
                        .frame(height: 4)
                        .animation(.easeInOut(duration: 0.3), value: step)
                }
            }
            if step >= 3 && step < 8 {
                Button("Skip", action: next)
                    .font(WZFont.ui(14)).foregroundStyle(t.muted)
                    .buttonStyle(.plain)
            } else {
                Color.clear.frame(width: 28, height: 1)
            }
        }
        .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 4)
    }

    // MARK: - Shared pieces
    private func heading(_ title: String, sub: String? = nil) -> some View {
        VStack(spacing: 9) {
            Text(title)
                .font(WZFont.display(26, .semibold)).foregroundStyle(t.text)
                .multilineTextAlignment(.center).lineSpacing(3)
            if let sub {
                Text(sub)
                    .font(WZFont.ui(13.5)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(3)
            }
        }
        .padding(.top, 16).padding(.horizontal, 26).padding(.bottom, 6)
        .frame(maxWidth: .infinity)
    }

    private var ghostStrip: some View {
        WGhost(size: 64, tapFun: true)
            .frame(maxWidth: .infinity)
            .padding(.top, 14)
    }

    private func foot(_ label: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        GradButton(title: label, action: action)
            .opacity(disabled ? 0.4 : 1)
            .disabled(disabled)
            .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 30)
    }

    @ViewBuilder private var footer: some View {
        switch step {
        case 0: foot("Get started", action: next)
        case 1, 2: foot("Next", action: next)
        case 3:
            if kbReady { foot("Next", action: next) }
            else { foot(kbBusy ? "Opening Settings…" : "Go to Settings", disabled: kbBusy, action: goSettings) }
        case 4:
            if btVisitedSettings { foot("Next", action: next) }
            else { foot(btOpeningSettings ? "Opening Settings…" : "Go to Settings", disabled: btOpeningSettings, action: openBackTapSettings) }
        case 5: foot("Next", disabled: tryState != .done, action: next)
        case 6, 7: foot("Next", action: next)
        default: foot("Start Whispering", action: finish)
        }
    }

    @ViewBuilder private var stepBody: some View {
        switch step {
        case 0: welcome
        case 1: privacy
        case 2: languages
        case 3: keyboardSetup
        case 4: backTap
        case 5: firstNote
        case 6: captureAnywhere
        case 7: moreThanTranscript
        default: ready
        }
    }

    // MARK: - Step 0 · welcome
    private var welcome: some View {
        VStack(spacing: 22) {
            Spacer()
            WGhost(size: 104, tapFun: true)
                .frame(width: 148, height: 148)
                .background(t.dark ? Color.hex(0x0c1822) : Color.hex(0x0e2231),
                            in: RoundedRectangle(cornerRadius: 38, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 38, style: .continuous)
                    .stroke(t.accent.opacity(0.45), lineWidth: 1))
                .shadow(color: t.accent.opacity(0.55), radius: 22, y: 10)
            Text("Speak it.\nWhisperio types.")
                .font(WZFont.display(34, .semibold)).foregroundStyle(t.text)
                .multilineTextAlignment(.center).lineSpacing(2)
            Text("Dictate into any app — transcribed on this iPhone, never uploaded.")
                .font(WZFont.ui(15)).foregroundStyle(t.muted)
                .multilineTextAlignment(.center).lineSpacing(4)
            Spacer()
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Step 1 · privacy
    private var isCloudChosen: Bool { settings.settings.primaryProvider != .onDevice }

    /// The cloud provider the sheet should pre-seed with: the current primary if it's one of
    /// the 3 offered here, else ElevenLabs (the sheet's first option).
    private var currentCloudProviderOrDefault: ProviderID {
        let p = settings.settings.primaryProvider
        return [.elevenLabs, .openAI, .deepgram].contains(p) ? p : .elevenLabs
    }

    /// Tapping "On-device" while a cloud provider is primary reorders the model chain back to
    /// on-device-first — non-destructive: the connected key + consent are kept, not erased.
    private func chooseOnDevice() {
        guard isCloudChosen else { return }
        var s = settings.settings
        s.setPrimaryProvider(.onDevice)
        settings.settings = s
    }

    private func onbCard<Content: View>(on: Bool, action: @escaping () -> Void, @ViewBuilder content: () -> Content) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) { content() }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    private var privacy: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ghostStrip
                heading("Your words stay yours",
                        sub: "Everything is transcribed on this iPhone — unless you choose a third-party model provider.")
                VStack(spacing: 11) {
                    onbCard(on: !isCloudChosen, action: chooseOnDevice) {
                        HStack(spacing: 10) {
                            WIcon("lock", size: 17).foregroundStyle(t.green)
                                .frame(width: 36, height: 36)
                                .background(t.green.opacity(0.13),
                                            in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                            Text("On-device")
                                .font(WZFont.display(16.5, .semibold)).foregroundStyle(t.text)
                            Spacer(minLength: 0)
                            Text("DEFAULT")
                                .font(WZFont.mono(9.5, .semibold)).tracking(0.8)
                                .foregroundStyle(t.accentLite)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(t.accent.opacity(0.13), in: Capsule())
                                .overlay(Capsule().stroke(t.hair, lineWidth: 1))
                        }
                        Text("Audio is transcribed by the neural engine and never leaves this iPhone. Works in airplane mode.")
                            .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                        HStack(alignment: .top, spacing: 7) {
                            WIcon("people", size: 13).foregroundStyle(t.faint).padding(.top, 1)
                            Text("Doesn’t support group (multi-speaker) transcription yet.")
                                .font(WZFont.ui(12)).foregroundStyle(t.faint).lineSpacing(3)
                        }
                    }

                    onbCard(on: isCloudChosen, action: {
                        providerKeyInput = ""
                        providerError = nil
                        providerPick = currentCloudProviderOrDefault
                        showProviderSheet = true
                    }) {
                        HStack(spacing: 10) {
                            WIcon("cloud", size: 17).foregroundStyle(t.accentLite)
                                .frame(width: 36, height: 36)
                                .background(t.accent.opacity(0.12),
                                            in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                            Text("Your model provider")
                                .font(WZFont.display(16.5, .semibold)).foregroundStyle(t.text)
                            Spacer(minLength: 0)
                            Text("OPTIONAL")
                                .font(WZFont.mono(9.5, .semibold)).tracking(0.8)
                                .foregroundStyle(t.muted)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(t.surfaceUp, in: Capsule())
                                .overlay(Capsule().stroke(t.line, lineWidth: 1))
                        }
                        Text("Plug in your own key — unlocks group transcription with speaker labels. Audio goes only to your provider, only while you dictate.")
                            .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                        if isCloudChosen {
                            HStack(spacing: 7) {
                                WIcon("check", size: 13)
                                Text("\(settings.settings.primaryProvider.displayName) connected")
                            }
                            .font(WZFont.mono(11.5, .semibold)).foregroundStyle(t.green)
                        } else {
                            HStack(spacing: 6) {
                                Text("Choose a provider")
                                WIcon("chevR", size: 13)
                            }
                            .font(WZFont.ui(12.5, .semibold)).foregroundStyle(t.accentLite)
                        }
                    }

                    HStack(alignment: .top, spacing: 10) {
                        WIcon("shield", size: 16).foregroundStyle(t.green).padding(.top, 1)
                        Text("No analytics, no audio clips, no “help improve” switch — Whisperio has nothing to collect.")
                            .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(t.line, lineWidth: 1))
                }
                .padding(.horizontal, 22).padding(.vertical, 14)
            }
        }
    }

    // MARK: - Step 2 · languages
    private var languages: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ghostStrip
                heading("Confirm your languages",
                        sub: "Picked from your keyboards — tap to add or remove. Whisperio auto-detects which one you’re speaking.")
                WrapLayout(spacing: 9) {
                    ForEach(Self.allLangs, id: \.0) { code, name in
                        langChip(code: code, name: name)
                    }
                }
                .padding(.horizontal, 22).padding(.vertical, 16)
            }
        }
    }

    private func langChip(code: String, name: String) -> some View {
        let on = langs.contains(code)
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if on { if langs.count > 1 { langs.removeAll { $0 == code } } }
                else { langs.append(code) }
            }
        } label: {
            HStack(spacing: 7) {
                if on { WIcon("check", size: 14) }
                Text(name)
            }
            .font(WZFont.ui(14.5, .semibold))
            .foregroundStyle(on ? t.accentLite : t.muted)
            .padding(.horizontal, 16).padding(.vertical, 11)
            .background(on ? t.accent.opacity(t.dark ? 0.16 : 0.10) : t.surface,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Step 3 · keyboard setup
    private var keyboardSetup: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ghostStrip
                heading("Turn on the Whisperio keyboard",
                        sub: "One switch in Settings — we’ll take you straight there and back.")
                VStack(spacing: 11) {
                    HStack(spacing: 12) {
                        WIcon("keyboard", size: 16).foregroundStyle(t.muted)
                            .frame(width: 30, height: 30)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        Text("Keyboards").font(WZFont.ui(15)).foregroundStyle(t.text)
                        Spacer(minLength: 0)
                        WIcon("chevR", size: 16).foregroundStyle(t.faint)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 13)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(t.line, lineWidth: 1))

                    VStack(spacing: 0) {
                        settRow("Whisperio", on: kbOn, icon: nil)
                        Rectangle().fill(t.lineSoft).frame(height: 1)
                        settRow("Allow Full Access", on: kbFA, icon: "lock")
                    }
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(kbReady ? t.hair : t.line, lineWidth: 1))

                    if kbReady {
                        HStack(spacing: 7) {
                            WIcon("check", size: 14)
                            Text("Keyboard ready — let’s try it")
                        }
                        .font(WZFont.mono(12, .semibold)).foregroundStyle(t.green)
                        .padding(.top, 4)
                    } else {
                        Text("We never store or sell what you say. Full Access only lets Whisperio insert text across apps.")
                            .font(WZFont.ui(12.5)).foregroundStyle(t.faint)
                            .multilineTextAlignment(.center).lineSpacing(3)
                            .padding(.horizontal, 8).padding(.top, 4)
                    }
                }
                .padding(.horizontal, 22).padding(.vertical, 16)
            }
        }
    }

    private func settRow(_ label: String, on: Bool, icon: String?) -> some View {
        HStack(spacing: 12) {
            if let icon {
                WIcon(icon, size: 16).foregroundStyle(t.muted)
                    .frame(width: 30, height: 30)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            Text(label).font(WZFont.ui(15)).foregroundStyle(t.text)
            Spacer(minLength: 0)
            WToggle(on: .constant(on))
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
    }

    private func goSettings() {
        guard !kbBusy, !kbReady else { return }
        kbBusy = true
        settingsTask?.cancel()
        settingsTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 550_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) { kbOn = true }
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) { kbFA = true; kbBusy = false }
        }
    }

    // MARK: - Step 4 · Back-Tap
    private var backTap: some View {
        VStack(spacing: 0) {
            ghostStrip
            heading("Set up Back-Tap",
                    sub: "Double-tap the back of your iPhone to start dictating — in any app, even from the Home Screen.")
            VStack(spacing: 11) {
                backTapStep("1", "Settings → Accessibility → Touch")
                backTapStep("2", "Back Tap → Double Tap")
                backTapStep("3", "Choose “Whisperio”")
                if btVisitedSettings {
                    Text("We can’t confirm Back Tap from here — if you set it to “Whisperio,” you’re all set.")
                        .font(WZFont.ui(12.5)).foregroundStyle(t.faint)
                        .multilineTextAlignment(.center).lineSpacing(3)
                        .padding(.horizontal, 8).padding(.top, 2)
                } else {
                    Text("We’ll take you straight there and back.")
                        .font(WZFont.ui(12.5)).foregroundStyle(t.faint)
                        .multilineTextAlignment(.center).lineSpacing(3)
                        .padding(.horizontal, 8).padding(.top, 2)
                }
            }
            .padding(.horizontal, 22).padding(.vertical, 14)
        }
    }

    private func backTapStep(_ n: String, _ label: String) -> some View {
        HStack(spacing: 12) {
            Text(n)
                .font(WZFont.mono(12, .bold)).foregroundStyle(t.accentLite)
                .frame(width: 26, height: 26)
                .background(t.accent.opacity(0.13), in: Circle())
            Text(label).font(WZFont.ui(13.5, .semibold)).foregroundStyle(t.text)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(t.line, lineWidth: 1))
    }

    // We can't read Back Tap's configuration from any public API, and DictateIntent can't
    // attribute a firing to Back Tap specifically — so the real system open-completion flag
    // (not a timer) drives `btVisitedSettings`, and the copy above never claims Back Tap is on.
    private func openBackTapSettings() {
        #if canImport(UIKit) && os(iOS)
        guard !btOpeningSettings, !btVisitedSettings else { return }
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        btOpeningSettings = true
        UIApplication.shared.open(url) { success in
            Task { @MainActor in
                btOpeningSettings = false
                if success { withAnimation { btVisitedSettings = true } }
            }
        }
        #endif
    }

    // MARK: - Step 5 · first note
    private var firstNote: some View {
        VStack(spacing: 0) {
            heading("Try whispering a note",
                    sub: "Bring the phone close and speak quietly — whispering works.")
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    HStack {
                        WIcon("chevL", size: 14).foregroundStyle(t.faint)
                        Text("Notes")
                            .font(WZFont.ui(12, .semibold)).foregroundStyle(t.muted)
                            .frame(maxWidth: .infinity)
                        WIcon("more", size: 14).foregroundStyle(t.faint)
                    }
                    .padding(.horizontal, 13).padding(.vertical, 9)
                    .overlay(Rectangle().fill(t.lineSoft).frame(height: 1), alignment: .bottom)

                    Group {
                        if typed.isEmpty {
                            Text("Things to do today…").foregroundStyle(t.faint)
                        } else {
                            (Text(typed) + Text(tryState == .listening ? "|" : "").foregroundStyle(t.accent))
                                .foregroundStyle(t.text)
                        }
                    }
                    .font(WZFont.ui(14.5)).lineSpacing(4)
                    .frame(maxWidth: .infinity, minHeight: 108, alignment: .topLeading)
                    .padding(.horizontal, 14).padding(.vertical, 13)
                }
                .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(tryState == .done ? t.hair : t.line, lineWidth: 1))

                if tryState == .done {
                    HStack(spacing: 10) {
                        ListeningGhost(phase: .note, size: 54)
                        HStack(spacing: 7) {
                            WIcon("check", size: 14)
                            Text("Inserted · on-device")
                        }
                        .font(WZFont.mono(12, .semibold)).foregroundStyle(t.green)
                    }
                    .padding(.top, 12)
                    .transition(.opacity)
                }

                if tryState == .done {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("GOOD TO KNOW")
                            .font(WZFont.mono(10, .semibold)).tracking(1.4)
                            .foregroundStyle(t.faint)
                        HStack(spacing: 9) {
                            WIcon("copy", size: 14).foregroundStyle(t.accentLite)
                            Text("Double-tap any note to copy it")
                        }
                        .font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                        HStack(spacing: 9) {
                            WIcon("chevL", size: 14).foregroundStyle(t.accentLite)
                            Text("Swipe a note left to delete it")
                        }
                        .font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(t.line, lineWidth: 1))
                    .padding(.top, 12)
                    .transition(.opacity)
                }
            }
            .padding(.horizontal, 22).padding(.top, 12)
            Spacer(minLength: 0)
            keyboardMock
        }
    }

    private var keyboardMock: some View {
        VStack(spacing: 7) {
            if tryState == .listening {
                HStack(spacing: 14) {
                    ListeningGhost(phase: .listening, size: 58)
                    VStack(spacing: 8) {
                        Waveform(color: t.accentLite, active: true, bars: 22, height: 40)
                        HStack(spacing: 7) {
                            PulsingDot(color: t.red)
                            Text("Listening · on-device")
                        }
                        .font(WZFont.mono(11.5)).foregroundStyle(t.muted)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 4).padding(.bottom, 10)
            } else {
                HStack(spacing: 10) {
                    Text("Tap the mic to start speaking →")
                        .font(WZFont.ui(13.5)).foregroundStyle(t.muted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    Button(action: startTry) {
                        WIcon("mic", size: 20).foregroundStyle(t.primaryInk)
                            .frame(width: 44, height: 44)
                            .background(t.primary, in: Circle())
                            .shadow(color: t.accent.opacity(0.45), radius: 9, y: 4)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 10).padding(.top, 2)
                keyRow("qwertyuiop")
                keyRow("asdfghjkl", pad: true)
                keyRow("zxcvbnm", pad: true)
            }
        }
        .padding(.horizontal, 6).padding(.top, 10).padding(.bottom, 8)
        .background(t.dark ? Color.hex(0x0d0b16) : Color.hex(0xd4d2e2))
    }

    private func keyRow(_ s: String, pad: Bool = false) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(s), id: \.self) { c in
                Text(String(c))
                    .font(WZFont.ui(13))
                    .foregroundStyle(t.dark ? Color.hex(0xECEBF4) : Color.hex(0x1b1830))
                    .frame(maxWidth: .infinity)
                    .frame(height: 30)
                    .background(t.dark ? Color.white.opacity(0.13) : .white,
                                in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            }
        }
        .padding(.horizontal, pad ? 16 : 0)
    }

    private func startTry() {
        guard tryState != .listening else { return }
        withAnimation(.easeInOut(duration: 0.2)) { tryState = .listening }
        typed = ""
        typeTask?.cancel()
        typeTask = Task { @MainActor in
            var i = 0
            while i < Self.note.count {
                try? await Task.sleep(nanoseconds: 46_000_000)
                guard !Task.isCancelled else { return }
                i += 2
                typed = String(Self.note.prefix(i))
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.25)) { tryState = .done }
        }
    }

    // MARK: - Step 6 · capture anywhere
    private static let triggerTiles: [(String, String)] = [
        ("bolt", "Action Button"), ("lock", "Lock Screen"), ("keyboard", "Keyboard"),
        ("watch", "Apple Watch"), ("mic", "Control Center"), ("more", "Back-Tap")
    ]

    private var captureAnywhere: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ghostStrip
                heading("Capture from anywhere",
                        sub: "Set them up anytime in Settings → Triggers — every capture lands in the same library.")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(Self.triggerTiles, id: \.1) { icon, label in
                        HStack(spacing: 10) {
                            WIcon(icon, size: 16).foregroundStyle(t.accentLite)
                                .frame(width: 32, height: 32)
                                .background(t.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            Text(label).font(WZFont.ui(13.5, .semibold)).foregroundStyle(t.text)
                            Spacer(minLength: 0)
                        }
                        .padding(13)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(t.line, lineWidth: 1))
                    }
                }
                .padding(.horizontal, 22).padding(.vertical, 14)
            }
        }
    }

    // MARK: - Step 7 · more than a transcript
    private static let featureRows: [(String, String, String)] = [
        ("people", "Group transcription", "Records the whole room and separates speakers. Requires a diarizing cloud engine — ElevenLabs (up to 32 speakers), Deepgram or AssemblyAI."),
        ("book", "Journal & daily digest", "Notes bind themselves into days, weeks and topic books."),
        ("spark", "Rewrite templates", "Turn a rambling take into a standup update, email or list."),
        ("list", "Custom vocabulary", "Teach it your project names, tools and shorthand.")
    ]

    private var moreThanTranscript: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ghostStrip
                heading("More than a transcript",
                        sub: "All of it lives in the app — nothing to set up right now.")
                VStack(spacing: 10) {
                    ForEach(Self.featureRows, id: \.1) { icon, title, sub in
                        HStack(alignment: .top, spacing: 12) {
                            WIcon(icon, size: 17).foregroundStyle(t.accentLite)
                                .frame(width: 34, height: 34)
                                .background(t.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(title).font(WZFont.display(15, .semibold)).foregroundStyle(t.text)
                                Text(sub).font(WZFont.ui(12.5)).foregroundStyle(t.muted).lineSpacing(3)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 13)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(t.line, lineWidth: 1))
                    }
                }
                .padding(.horizontal, 22).padding(.vertical, 14)
            }
        }
    }

    // MARK: - Step 8 · ready
    private var ready: some View {
        VStack(spacing: 20) {
            Spacer()
            WGhost(size: 110, tapFun: true)
            Text("You’re ready")
                .font(WZFont.display(32, .semibold)).foregroundStyle(t.text)
                .multilineTextAlignment(.center)
            Text("Whisperio works in every app — keyboard, Action Button, Lock Screen and Watch.")
                .font(WZFont.ui(14.5)).foregroundStyle(t.muted)
                .multilineTextAlignment(.center).lineSpacing(4)
            PrivacyBadge(mode: settings.settings.primaryProvider != .onDevice ? .cloud : .device)
            Spacer()
        }
        .padding(.horizontal, 26)
    }

    private func finish() {
        // Language auto-detect is the promise of step 2 — keep the store on "auto" so
        // dictation detects among the confirmed keyboards, matching the design copy.
        var s = settings.settings
        s.language = "auto"
        settings.settings = s
        // Mirrors SetupView.swift's legacy completion flag so RootView's first-run gate
        // flips over to the real app the moment onboarding finishes — replaying onboarding
        // from Settings (openOnboarding) already has didCompleteSetup == true, so this is a
        // harmless no-op reassignment there.
        settings.didCompleteSetup = true
        done()
    }
}

// MARK: - Pulsing recording dot (design's `mpulse`)
// Shared "live" indicator (design's mpulse keyframe) — used by onboarding's listening row and
// Scratchpad's in-flight take.
struct PulsingDot: View {
    let color: Color
    @State private var pulse = false
    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7)
            .opacity(pulse ? 0.35 : 1)
            .scaleEffect(pulse ? 0.8 : 1)
            .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = true }
    }
}

// MARK: - Wrapping chip layout (design's flex-wrap language grid)
private struct WrapLayout: Layout {
    var spacing: CGFloat = 9

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0; y += rowHeight + spacing; rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: proposal.width ?? x, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Provider connect sheet (step 1's "Your model provider" card)
// Real key verification before anything is persisted — no fabricated masked key placeholder
// is ever shown, and nothing is written to Settings/Keychain until ProviderKeyValidator
// actually confirms the key against the provider's own API (see SettingsStore.connectProvider).
private struct ProviderConnectSheet: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @Binding var pick: ProviderID
    @Binding var keyInput: String
    @Binding var busy: Bool
    @Binding var error: String?
    var onConnected: () -> Void

    private static let providers: [(ProviderID, String)] = [
        (.elevenLabs, "Scribe · group up to 32 speakers"),
        (.openAI, "Transcribe · Whisper API"),
        (.deepgram, "Nova · fast streaming")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 4) {
                Text("Choose your provider")
                    .font(WZFont.display(18, .semibold)).foregroundStyle(t.text)
                Text("You bring the key — Whisperio never proxies your audio.")
                    .font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(3)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 12)

            VStack(spacing: 9) {
                ForEach(Self.providers, id: \.0) { id, sub in
                    providerRow(id, sub)
                }
            }
            .padding(.bottom, 12)

            keyField
                .padding(.bottom, 12)

            if let error {
                Text(error)
                    .font(WZFont.ui(12.5)).foregroundStyle(t.red)
                    .lineSpacing(3)
                    .padding(.bottom, 10)
            }

            GradButton(title: busy ? "Verifying key…" : "Connect \(pick.displayName)", action: connect)
                .opacity(canConnect ? 1 : 0.4)
                .disabled(!canConnect)
        }
        .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 26)
    }

    private var canConnect: Bool {
        !busy && !keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func providerRow(_ id: ProviderID, _ sub: String) -> some View {
        let on = pick == id
        return Button {
            pick = id
            error = nil
        } label: {
            HStack(spacing: 11) {
                Text(String(id.displayName.prefix(1)))
                    .font(WZFont.display(14, .bold)).foregroundStyle(t.accentLite)
                    .frame(width: 32, height: 32)
                    .background(t.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(id.displayName).font(WZFont.display(14.5, .semibold)).foregroundStyle(t.text)
                    Text(sub).font(WZFont.ui(11.5)).foregroundStyle(t.muted)
                }
                Spacer(minLength: 0)
                if on { WIcon("check", size: 16).foregroundStyle(t.accentLite) }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    private var keyField: some View {
        let hasKey = !keyInput.isEmpty
        return HStack(spacing: 10) {
            WIcon("lock", size: 15).foregroundStyle(hasKey ? t.green : t.faint)
            SecureField("Paste your API key…", text: $keyInput)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .font(WZFont.mono(12.5)).foregroundStyle(t.text)
                .onChange(of: keyInput) { _, _ in error = nil }
            if hasKey { WIcon("check", size: 15).foregroundStyle(t.green) }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(hasKey ? t.green : t.line,
                        style: StrokeStyle(lineWidth: 1, dash: hasKey ? [] : [4, 3]))
        )
    }

    private func connect() {
        guard canConnect else { return }
        busy = true
        Task { @MainActor in
            let result = await settings.connectProvider(pick, key: keyInput)
            busy = false
            switch result {
            case .success:
                keyInput = ""
                onConnected()
            case .failure(.invalidKey):
                error = "That key didn’t verify with \(pick.displayName) — check it and try again."
            case .failure(.network(let msg)):
                error = "Couldn’t reach \(pick.displayName): \(msg)"
            case .failure(.unexpected(let code)):
                error = "\(pick.displayName) returned an unexpected response (\(code))."
            }
        }
    }
}
