import SwiftUI

// Custom keyboard extension — the honest "bounce to app" flow (wz-scenes.jsx).
// iOS keyboards can't use the mic, so the mic key opens Whisperio to record, then returns
// with the text inserted. One-time explainer; no fake seamless inline loop.
struct KeyboardScene: View {
    @Environment(\.wz) private var t
    private let target = "Running ten late — grab us a table by the window if you can."
    @State private var stage = "idle"     // idle | explain | recording | done
    @State private var seen = false
    @State private var typed = ""
    @State private var inserted = ""
    @State private var showToast = false
    @State private var typer: Timer?

    var body: some View {
        ZStack {
            t.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                // Messages header
                VStack(spacing: 4) {
                    Circle().fill(t.gradient).frame(width: 44, height: 44)
                        .overlay(Text("S").font(WZFont.display(16)).foregroundStyle(.white))
                    Text("Sam").font(WZFont.ui(13, .semibold)).foregroundStyle(t.text)
                }
                .frame(maxWidth: .infinity).padding(.top, 50).padding(.bottom, 8)
                .background(t.surface.opacity(0.7))
                .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }

                // thread
                VStack(alignment: .leading, spacing: 8) {
                    bubble("Heading over now?", me: false)
                    bubble("Almost — finishing one thing", me: true)
                    if showToast {
                        HStack(spacing: 7) {
                            WIcon("check", size: 13); Text("Back in Messages · text inserted")
                        }
                        .font(WZFont.mono(11)).foregroundStyle(t.green)
                        .frame(maxWidth: .infinity)
                    }
                    Spacer()
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)

                // input field
                HStack {
                    Text(inserted.isEmpty ? "iMessage" : inserted)
                        .font(WZFont.ui(14.5)).foregroundStyle(inserted.isEmpty ? t.faint : t.text)
                    Spacer()
                }
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(t.surface, in: Capsule())
                .overlay(Capsule().stroke(inserted.isEmpty ? t.line : t.accent, lineWidth: 1))
                .padding(.horizontal, 12).padding(.vertical, 8)
                .overlay(alignment: .top) { Rectangle().fill(t.lineSoft).frame(height: 1) }

                keyboard
            }
            if stage == "explain" { explainer }
            if stage == "recording" { takeover }
        }
        .onDisappear { typer?.invalidate() }
    }

    private func bubble(_ txt: String, me: Bool) -> some View {
        Text(txt).font(WZFont.ui(14.5)).foregroundStyle(me ? .white : t.text)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(me ? t.accent : t.surfaceUp, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
            .frame(maxWidth: .infinity, alignment: me ? .trailing : .leading)
    }

    // MARK: keyboard
    private var keyboard: some View {
        VStack(spacing: 8) {
            // top bar with Dictate
            HStack(spacing: 8) {
                WIcon("globe", size: 17, weight: .regular).foregroundStyle(t.muted)
                    .frame(width: 30, height: 30)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                HStack(spacing: 6) {
                    WGhost(size: 15)
                    Text("Whisperio").font(WZFont.display(13)).foregroundStyle(t.text)
                    Text("· mic opens app ›").font(WZFont.mono(10)).foregroundStyle(t.faint)
                }
                Spacer()
                Button(action: tapMic) {
                    HStack(spacing: 7) { WIcon("mic", size: 16); Text("Dictate") }
                        .font(WZFont.ui(13, .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).frame(height: 34)
                        .background(t.gradient, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            keyRow(Array("qwertyuiop").map(String.init))
            keyRow(Array("asdfghjkl").map(String.init)).padding(.horizontal, 16)
            HStack(spacing: 5) {
                specialKey { WIcon("chevD", size: 18).rotationEffect(.degrees(180)) }.frame(width: 40)
                ForEach(Array("zxcvbnm").map(String.init), id: \.self) { keyCap($0) }
                specialKey { WIcon("x", size: 16) }.frame(width: 40)
            }
            HStack(spacing: 5) {
                specialKey { Text("123") }.frame(width: 64)
                keyCap("space")
                Text("return").font(WZFont.ui(15, .semibold)).foregroundStyle(.white)
                    .frame(width: 78, height: 42)
                    .background(t.accent, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
        }
        .padding(.horizontal, 4).padding(.top, 7).padding(.bottom, 8)
        .background((t.dark ? Color.hex(0x0d0b16) : Color.hex(0xd4d2e2)).ignoresSafeArea(edges: .bottom))
    }

    private func keyRow(_ chars: [String]) -> some View {
        HStack(spacing: 5) { ForEach(chars, id: \.self) { keyCap($0) } }
    }
    private func keyCap(_ s: String) -> some View {
        Text(s).font(WZFont.ui(18)).foregroundStyle(t.dark ? Color.hex(0xECEBF4) : Color.hex(0x1b1830))
            .frame(maxWidth: .infinity).frame(height: 42)
            .background(t.dark ? Color.white.opacity(0.13) : .white,
                        in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
    private func specialKey<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        content().foregroundStyle(t.dark ? Color.hex(0xECEBF4) : Color.hex(0x1b1830))
            .frame(height: 42).frame(maxWidth: .infinity)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }

    // MARK: overlays
    private var explainer: some View {
        BottomSheet(onClose: { stage = "idle" }) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    WIcon("arrowUR", size: 20).foregroundStyle(t.accentLite)
                        .frame(width: 40, height: 40)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Text("Dictation opens Whisperio").font(WZFont.display(18)).foregroundStyle(t.text)
                }
                .padding(.bottom, 10)
                Text("iOS keyboards can’t use the microphone on their own, so the mic key opens Whisperio to record — then drops you right back here with the text inserted. One tap each way.")
                    .font(WZFont.ui(14)).foregroundStyle(t.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true).padding(.bottom, 8)
                HStack(spacing: 7) { WIcon("lock", size: 13); Text("Still transcribed on-device") }
                    .font(WZFont.mono(11.5)).foregroundStyle(t.green).padding(.bottom, 18)
                GradButton(title: "Got it — start dictating", action: startRec)
            }
        }
    }

    private var takeover: some View {
        ZStack {
            t.bg2.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Button(action: finish) {
                        HStack(spacing: 3) { WIcon("chevL", size: 20); Text("Messages") }
                            .font(WZFont.ui(15, .semibold)).foregroundStyle(t.accentLite)
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    EngineChip(label: "On-device", icon: "cpu")
                }
                .padding(.horizontal, 18).padding(.top, 52).padding(.bottom, 10)

                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) { WGhost(size: 20); SectionLabel(text: "Listening…") }
                    (Text(typed) + Text(" |").foregroundColor(t.accent))
                        .font(WZFont.display(24, .medium)).foregroundStyle(t.text)
                        .lineSpacing(6).frame(minHeight: 130, alignment: .topLeading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading).padding(.horizontal, 26)

                Waveform(color: t.accent, bars: 32, height: 64)
                Button(action: finish) {
                    HStack(spacing: 9) { WIcon("check", size: 18); Text("Insert & return to Messages") }
                        .font(WZFont.ui(15, .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 26).padding(.vertical, 14)
                        .background(t.gradient, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain).padding(.top, 14).padding(.bottom, 40)
            }
        }
    }

    // MARK: logic
    private func tapMic() { withAnimation { stage = seen ? "recording" : "explain" }; if seen { startRec() } }
    private func startRec() {
        seen = true; typed = ""
        withAnimation { stage = "recording" }
        var i = 0
        typer?.invalidate()
        typer = Timer.scheduledTimer(withTimeInterval: 0.048, repeats: true) { tm in
            i += 2; typed = String(target.prefix(i))
            if i >= target.count { tm.invalidate() }
        }
    }
    private func finish() {
        typer?.invalidate(); inserted = target
        withAnimation { stage = "idle"; showToast = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { withAnimation { showToast = false } }
    }
}

// Reusable bottom sheet shell (dim + slide-up card).
struct BottomSheet<Content: View>: View {
    @Environment(\.wz) private var t
    var onClose: () -> Void
    @ViewBuilder var content: Content
    var body: some View {
        ZStack(alignment: .bottom) {
            Color.hex(0x06050c).opacity(0.55).ignoresSafeArea().onTapGesture(perform: onClose)
            VStack(spacing: 0) {
                Capsule().fill(t.line).frame(width: 38, height: 5).padding(.vertical, 14)
                content
            }
            .padding(.horizontal, 22).padding(.bottom, 28)
            .frame(maxWidth: .infinity)
            .background(t.surface, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
            .transition(.move(edge: .bottom))
        }
    }
}
