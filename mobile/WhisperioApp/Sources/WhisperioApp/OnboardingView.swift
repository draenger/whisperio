import SwiftUI

// First-run onboarding — port of wz2/mob-onboarding.jsx (OnboardingScene).
// Steps: 0 welcome (ghost, "Speak it. / Whisperio types.", PrivacyBadge, "Get started")
//        1 privacy ("Your words stay yours", On-device only ALWAYS card, shield note)
//        2 languages ("Confirm your languages", chips from keyboards, auto-detect note)
//        3 keyboard ("Turn on the Whisperio keyboard", Keyboards row + toggles card,
//          "Go to Settings" → busy → "Keyboard ready — let's try it")
//        4 first note ("Try whispering a note", Notes mock + mini keyboard, mic →
//          listening → "Inserted · on-device"; Next disabled until done)
//        5 streak ("You're ready", 1-day streak card with 5 day circles, "Start Whispering")
// Progress bar: 5 segments, back chevron, Skip on steps 3-4.
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
    }

    private func next() { withAnimation(.easeInOut(duration: 0.32)) { step = min(step + 1, 5) } }
    private func back() { withAnimation(.easeInOut(duration: 0.32)) { step = max(step - 1, 0) } }

    // MARK: - Progress bar (back chevron · 5 segments · Skip on steps 3-4)
    private var progress: some View {
        HStack(spacing: 12) {
            Button(action: back) {
                WIcon("chevL", size: 19).foregroundStyle(t.text)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            HStack(spacing: 7) {
                ForEach(1...5, id: \.self) { i in
                    Capsule().fill(i <= step ? t.accent : t.surfaceUp)
                        .frame(height: 4)
                        .animation(.easeInOut(duration: 0.3), value: step)
                }
            }
            if step >= 3 && step < 5 {
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
            .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 12)
    }

    @ViewBuilder private var footer: some View {
        switch step {
        case 0: foot("Get started", action: next)
        case 1, 2: foot("Next", action: next)
        case 3:
            if kbReady { foot("Next", action: next) }
            else { foot(kbBusy ? "Opening Settings…" : "Go to Settings", disabled: kbBusy, action: goSettings) }
        case 4: foot("Next", disabled: tryState != .done, action: next)
        default: foot("Start Whispering", action: finish)
        }
    }

    @ViewBuilder private var stepBody: some View {
        switch step {
        case 0: welcome
        case 1: privacy
        case 2: languages
        case 3: keyboardSetup
        case 4: firstNote
        default: streak
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
            PrivacyBadge(mode: .device)
            Spacer()
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Step 1 · privacy
    private var privacy: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ghostStrip
                heading("Your words stay yours",
                        sub: "Everything is transcribed on this iPhone. There’s nothing to opt out of.")
                VStack(spacing: 11) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            WIcon("lock", size: 17).foregroundStyle(t.green)
                                .frame(width: 36, height: 36)
                                .background(t.green.opacity(0.13),
                                            in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                            Text("On-device only")
                                .font(WZFont.display(16.5, .semibold)).foregroundStyle(t.text)
                            Spacer(minLength: 0)
                            Text("ALWAYS")
                                .font(WZFont.mono(9.5, .semibold)).tracking(0.8)
                                .foregroundStyle(t.accentLite)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(t.accent.opacity(0.13), in: Capsule())
                                .overlay(Capsule().stroke(t.hair, lineWidth: 1))
                        }
                        Text("Audio is transcribed by the neural engine and never leaves this iPhone. Works in airplane mode.")
                            .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(t.accent, lineWidth: 2))

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

    // MARK: - Step 4 · first note
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
                        WIcon("mic", size: 20).foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(t.gradient, in: Circle())
                            .shadow(color: t.accent.opacity(0.55), radius: 9, y: 4)
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

    // MARK: - Step 5 · streak
    private var streak: some View {
        VStack(spacing: 20) {
            Spacer()
            WGhost(size: 110, tapFun: true)
            Text("You’re ready")
                .font(WZFont.display(32, .semibold)).foregroundStyle(t.text)
                .multilineTextAlignment(.center)
            Text("Whisperio works in every app — keyboard, Action Button, Lock Screen and Watch.")
                .font(WZFont.ui(14.5)).foregroundStyle(t.muted)
                .multilineTextAlignment(.center).lineSpacing(4)
            VStack(spacing: 14) {
                Text("1-day streak")
                    .font(WZFont.display(19, .semibold)).foregroundStyle(t.text)
                HStack(spacing: 14) {
                    ForEach(1...5, id: \.self) { d in
                        VStack(spacing: 6) {
                            WIcon("check", size: 16)
                                .foregroundStyle(d == 1 ? .white : t.faint)
                                .frame(width: 40, height: 40)
                                .background {
                                    if d == 1 { Circle().fill(t.gradient) }
                                    else { Circle().fill(t.surfaceUp)
                                        .overlay(Circle().stroke(t.line, lineWidth: 1)) }
                                }
                            Text("Day \(d)")
                                .font(WZFont.mono(9.5))
                                .foregroundStyle(d == 1 ? t.accentLite : t.faint)
                        }
                    }
                }
                Text("Dictate 5 days in a row so Whisperio adapts to you.")
                    .font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(3)
            }
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(t.line, lineWidth: 1))
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
        done()
    }
}

// MARK: - Pulsing recording dot (design's `mpulse`)
private struct PulsingDot: View {
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
