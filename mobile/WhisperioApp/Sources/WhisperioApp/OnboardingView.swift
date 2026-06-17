import SwiftUI

// Privacy-first onboarding (port of Onboarding in wz-iphone.jsx): 5 slides ending in
// engine choice + permission CTA. The hero promise is "works fully offline."
struct OnboardingView: View {
    @Environment(\.wz) private var t
    var done: () -> Void
    @State private var i = 0
    @State private var engine = "apple"

    private var lastIndex: Int { 4 }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    if i < lastIndex {
                        Button("Skip", action: done)
                            .font(WZFont.ui(14, .semibold)).foregroundStyle(t.faint)
                    }
                }
                .frame(height: 20).padding(.bottom, 8)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) { slide }
                        .id(i)
                        .transition(.opacity)
                }
                .frame(maxHeight: .infinity)

                VStack(spacing: 18) {
                    HStack(spacing: 7) {
                        ForEach(0...lastIndex, id: \.self) { k in
                            Capsule().fill(k == i ? t.accent : t.line)
                                .frame(width: k == i ? 22 : 7, height: 7)
                        }
                    }
                    GradButton(title: i < lastIndex ? "Continue" : "Get started",
                               icon: i == lastIndex ? "check" : nil) {
                        if i < lastIndex { withAnimation(.easeInOut(duration: 0.35)) { i += 1 } }
                        else { done() }
                    }
                }
                .padding(.top, 18).padding(.bottom, 26)
            }
            .padding(.horizontal, 26).padding(.top, 12)
        }
    }

    @ViewBuilder private var slide: some View {
        switch i {
        case 0:
            art { glowGhost }
            eyebrow("Whisperio for iPhone")
            title("Speak anywhere.\nIt types for you.")
            bodyText("Talk, and Whisperio transcribes you and drops the text exactly where your cursor is — in any app.")
        case 1:
            art { glow(icon: "lock", color: t.green) }
            eyebrow("Private by design")
            title("Works fully offline.\nYour voice stays here.")
            bodyText("Every word is transcribed on-device with Apple Speech — no account, no upload, no servers. It even works in airplane mode.")
            chips([("lock", "Offline"), ("shield", "No account"), ("cpu", "Nothing uploaded")])
        case 2:
            art { triggerArt }
            eyebrow("Three ways to trigger")
            title("However you reach\nfor your phone.")
            triggerList
        case 3:
            art { glow(icon: "cpu", color: t.accentLite, tint: false) }
            eyebrow("Choose your engine")
            title("On-device by default.")
            bodyText("Keep everything on the iPhone, or opt in to Cloud for the toughest audio. Always your call — change it any time.")
            engineChoice
        default:
            art { glow(icon: "mic", color: t.accentLite, tint: false) }
            eyebrow("One quick step")
            title("Allow the mic,\nadd the keyboard.")
            bodyText("Grant microphone access and add the Whisperio keyboard in Settings. That’s the whole setup.")
        }
    }

    // MARK: building blocks
    private func art<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        content().frame(maxWidth: .infinity).frame(height: 180)
    }
    private var glowGhost: some View {
        ZStack {
            Circle().fill(t.accent).frame(width: 200, height: 200).blur(radius: 40).opacity(0.4)
            WGhost(size: 132)
        }
    }
    private func glow(icon: String, color: Color, tint: Bool = true) -> some View {
        ZStack {
            Circle().fill(color).frame(width: 150, height: 120).blur(radius: 46).opacity(0.16)
            WIcon(icon, size: 96, weight: .light).foregroundStyle(color)
        }
    }
    private var triggerArt: some View {
        HStack(spacing: 14) {
            ForEach(Array(["keyboard", "bolt", "command"].enumerated()), id: \.offset) { idx, k in
                WIcon(k, size: 28).foregroundStyle(t.accentLite)
                    .frame(width: 64, height: 64)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                    .scaleEffect(idx == 1 ? 1.18 : 0.92)
                    .shadow(color: idx == 1 ? t.accent.opacity(0.5) : .clear, radius: 10, y: 12)
            }
        }
    }
    private func eyebrow(_ s: String) -> some View {
        Text(s.uppercased()).font(WZFont.mono(12, .semibold)).tracking(1.7)
            .foregroundStyle(t.accentLite).padding(.top, 18)
    }
    private func title(_ s: String) -> some View {
        Text(s).font(WZFont.display(32)).foregroundStyle(t.text)
            .lineSpacing(2).padding(.top, 12).fixedSize(horizontal: false, vertical: true)
    }
    private func bodyText(_ s: String) -> some View {
        Text(s).font(WZFont.ui(16)).foregroundStyle(t.muted)
            .lineSpacing(3).padding(.top, 16).fixedSize(horizontal: false, vertical: true)
    }
    private func chips(_ items: [(String, String)]) -> some View {
        HStack(spacing: 9) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                HStack(spacing: 6) { WIcon(it.0, size: 14); Text(it.1) }
                    .font(WZFont.mono(12, .semibold)).foregroundStyle(t.green)
                    .padding(.horizontal, 13).padding(.vertical, 8)
                    .background(t.green.opacity(t.dark ? 0.10 : 0.08), in: Capsule())
                    .overlay(Capsule().stroke(t.green.opacity(t.dark ? 0.26 : 0.22), lineWidth: 1))
            }
        }
        .padding(.top, 20)
    }
    private var triggerList: some View {
        VStack(spacing: 12) {
            ForEach(Array([("keyboard", "Whisperio keyboard", "A mic key in any text field"),
                     ("bolt", "Action Button / Lock Screen", "Hold, speak — transcript on your clipboard"),
                     ("command", "Back-Tap", "Double- or triple-tap the back to capture")].enumerated()), id: \.offset) { _, it in
                HStack(spacing: 13) {
                    WIcon(it.0, size: 20).foregroundStyle(t.accentLite)
                        .frame(width: 44, height: 44)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(t.line, lineWidth: 1))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(it.1).font(WZFont.ui(15, .semibold)).foregroundStyle(t.text)
                        Text(it.2).font(WZFont.ui(13)).foregroundStyle(t.muted)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.top, 22)
    }
    private var engineChoice: some View {
        VStack(spacing: 10) {
            ForEach(Array([("apple", "cpu", "On-device", "Apple Speech · free, private, offline"),
                     ("cloud", "cloud", "Cloud (optional)", "OpenAI / ElevenLabs · max accuracy")].enumerated()), id: \.offset) { _, it in
                Button { engine = it.0 } label: {
                    HStack(spacing: 13) {
                        WIcon(it.1, size: 20).foregroundStyle(t.accentLite)
                            .frame(width: 42, height: 42)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.2).font(WZFont.ui(15, .semibold)).foregroundStyle(t.text)
                            Text(it.3).font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                        }
                        Spacer(minLength: 0)
                        ZStack {
                            Circle().stroke(engine == it.0 ? t.accent : t.line, lineWidth: 2)
                                .frame(width: 22, height: 22)
                            if engine == it.0 { Circle().fill(t.accent).frame(width: 11, height: 11) }
                        }
                    }
                    .padding(14)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(engine == it.0 ? t.accent : t.line, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 22)
    }
}
