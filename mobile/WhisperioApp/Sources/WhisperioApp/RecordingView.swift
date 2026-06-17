import SwiftUI

// Live recording — on-device partial results streaming in, then an Apple-Intelligence
// "tidying up" pass. Port of Recording() in wz-iphone.jsx.
struct RecordingView: View {
    @Environment(\.wz) private var t
    var onCancel: () -> Void
    var onDone: () -> Void

    private let partial = "Refactor the auth module to use JWT tokens and add refresh-token rotation"
    @State private var phase = "listening"   // listening | processing
    @State private var secs = 0
    @State private var shownCount = 0
    @State private var caret = true

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private let typer = Timer.publish(every: 0.055, on: .main, in: .common).autoconnect()

    private var clock: String {
        String(format: "%d:%02d", secs / 60, secs % 60)
    }
    private var shown: String { String(partial.prefix(shownCount)) }

    var body: some View {
        ScreenScaffold(bg: t.bg2) {
            VStack(spacing: 0) {
                HStack {
                    EngineChip(label: phase == "processing" ? "Apple Intelligence" : "Apple Speech · on-device",
                               icon: phase == "processing" ? "spark" : "cpu")
                    Spacer()
                    Text(clock).font(WZFont.mono(15)).foregroundStyle(t.text)
                        .monospacedDigit()
                }
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 14) {
                    SectionLabel(text: phase == "processing" ? "Tidying up…" : "Listening…")
                    (Text(shown) + caretText)
                        .font(WZFont.display(25, .medium)).foregroundStyle(t.text)
                        .lineSpacing(6).frame(minHeight: 160, alignment: .topLeading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(.horizontal, 24)

                Group {
                    if phase == "listening" {
                        Waveform(color: t.accent, bars: 34, height: 70)
                    } else {
                        HStack(spacing: 10) {
                            ProgressView().tint(t.accent)
                            Text("Cleaning punctuation & casing")
                                .font(WZFont.mono(13)).foregroundStyle(t.accentLite)
                        }
                        .frame(height: 70)
                    }
                }
                .padding(.bottom, 8)

                HStack(spacing: 30) {
                    circleButton(icon: "x", bg: t.surfaceUp, fg: t.muted, size: 56, action: onCancel)
                        .overlay(Circle().stroke(t.line, lineWidth: 1))
                    Button(action: stop) {
                        WIcon("stop", size: 30).foregroundStyle(.white)
                            .frame(width: 84, height: 84)
                            .background(phase == "listening" ? t.red : t.elevated, in: Circle())
                            .overlay(Circle().stroke(t.red.opacity(phase == "listening" ? 0.16 : 0), lineWidth: 8))
                    }
                    .buttonStyle(.plain).disabled(phase != "listening")
                    Color.clear.frame(width: 56, height: 56)
                }
                .padding(.top, 14).padding(.bottom, 42)
            }
        }
        .onReceive(tick) { _ in if phase == "listening" { secs += 1 } }
        .onReceive(typer) { _ in
            if phase == "listening", shownCount < partial.count { shownCount += 2 }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.45).repeatForever()) { caret.toggle() }
        }
    }

    private var caretText: Text {
        phase == "listening" ? Text(" |").foregroundColor(t.accent) : Text("")
    }

    private func circleButton(icon: String, bg: Color, fg: Color, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WIcon(icon, size: 22, weight: .regular).foregroundStyle(fg)
                .frame(width: size, height: size).background(bg, in: Circle())
        }
        .buttonStyle(.plain)
    }

    private func stop() {
        phase = "processing"
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { onDone() }
    }
}
