import SwiftUI

// Triggers — Action Button · Lock Screen · Back-Tap. Capture → transcript on the CLIPBOARD.
// Honest: there is no silent background paste; iOS makes the user paste. (wz-scenes.jsx)
struct TriggerScene: View {
    @Environment(\.wz) private var t
    private let target = "Pick up the dry cleaning and book a table for four on Friday."
    @State private var stage = "idle"     // idle | listening | done
    @State private var via = "action"
    @State private var typed = ""
    @State private var typer: Timer?

    private var viaLabel: String { via == "action" ? "Action Button" : via == "backtap" ? "Back-Tap" : "Lock Screen" }
    private var viaIcon: String { via == "action" ? "bolt" : via == "backtap" ? "command" : "lock" }

    var body: some View {
        ZStack {
            LinearGradient(colors: [t.elevated, t.bg2], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            // lock screen
            VStack(spacing: 0) {
                Spacer().frame(height: 92)
                WIcon("lock", size: 16, weight: .regular).foregroundStyle(.white.opacity(0.6))
                Text("Tuesday, 17 June").font(.system(size: 22, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85)).padding(.top, 14)
                Text("9:41").font(.system(size: 84, weight: .semibold)).foregroundStyle(.white)
                Button { fire("lock") } label: {
                    HStack(spacing: 9) {
                        WGhost(size: 22)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Whisperio").font(WZFont.display(14)).foregroundStyle(.white)
                            Text("Tap to capture").font(WZFont.mono(10.5)).foregroundStyle(.white.opacity(0.6))
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(.white.opacity(0.14), lineWidth: 1))
                }
                .buttonStyle(.plain).padding(.top, 26)
                Spacer()
                HStack(spacing: 9) {
                    ForEach(["×2", "×3"], id: \.self) { x in
                        Button { fire("backtap") } label: {
                            HStack(spacing: 6) { WIcon("command", size: 13).foregroundStyle(t.accentLite); Text("Back-Tap \(x)") }
                                .font(WZFont.mono(11, .semibold)).foregroundStyle(.white.opacity(0.85))
                                .padding(.horizontal, 13).padding(.vertical, 8)
                                .background(.white.opacity(0.08), in: Capsule())
                                .overlay(Capsule().stroke(.white.opacity(0.12), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 18)
            }
            // Action Button (hardware hint, left edge)
            VStack {
                Button { fire("action") } label: {
                    Capsule().fill(stage == "listening" && via == "action" ? t.accentLite : t.line)
                        .frame(width: 5, height: 38)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.top, 196)

            if stage != "idle" { overlay }
        }
        .onDisappear { typer?.invalidate() }
    }

    private var overlay: some View {
        ZStack {
            Color.hex(0x06050c).opacity(0.62).ignoresSafeArea()
                .onTapGesture { if stage == "done" { reset() } }
            if stage == "listening" {
                VStack(spacing: 0) {
                    EngineChip(label: "Via \(viaLabel)", icon: viaIcon)
                    Waveform(color: t.accentLite, bars: 30, height: 64).padding(.vertical, 20)
                    (Text(typed) + Text(" |").foregroundColor(t.accentLite))
                        .font(WZFont.display(21, .medium)).foregroundStyle(.white)
                        .multilineTextAlignment(.center).frame(minHeight: 84)
                    Button(action: reset) {
                        WIcon("stop", size: 24).foregroundStyle(.white)
                            .frame(width: 64, height: 64).background(t.red, in: Circle())
                            .overlay(Circle().stroke(t.red.opacity(0.18), lineWidth: 7))
                    }
                    .buttonStyle(.plain).padding(.top, 18)
                }
                .padding(26)
            } else {
                VStack(spacing: 0) {
                    HStack(spacing: 9) {
                        WIcon("clip", size: 16).foregroundStyle(Color.hex(0x04231a))
                            .frame(width: 30, height: 30).background(t.green, in: Circle())
                        Text("Copied to clipboard").font(WZFont.display(17)).foregroundStyle(.white)
                    }
                    .padding(.bottom, 16)
                    Text(target).font(WZFont.ui(15)).foregroundStyle(.white).lineSpacing(3)
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(.white.opacity(0.14), lineWidth: 1))
                    HStack(spacing: 9) {
                        resultAction("folder", "Save to Whisperio")
                        resultAction("share", "Share")
                    }
                    .padding(.top, 14)
                    Text("Open any app and paste — iOS won’t let an app paste for you")
                        .font(WZFont.mono(11)).foregroundStyle(.white.opacity(0.55))
                        .multilineTextAlignment(.center).padding(.top, 16)
                    Text("Tap anywhere to dismiss").font(WZFont.mono(11)).foregroundStyle(.white.opacity(0.4)).padding(.top, 12)
                }
                .padding(26)
            }
        }
    }

    private func resultAction(_ icon: String, _ label: String) -> some View {
        HStack(spacing: 7) { WIcon(icon, size: 16).foregroundStyle(t.accentLite); Text(label) }
            .font(WZFont.ui(13.5, .semibold)).foregroundStyle(.white)
            .frame(maxWidth: .infinity).padding(11)
            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(.white.opacity(0.12), lineWidth: 1))
    }

    private func fire(_ src: String) {
        via = src; typed = ""
        withAnimation { stage = "listening" }
        var i = 0
        typer?.invalidate()
        typer = Timer.scheduledTimer(withTimeInterval: 0.046, repeats: true) { tm in
            i += 2; typed = String(target.prefix(i))
            if i >= target.count { tm.invalidate(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { withAnimation { stage = "done" } } }
        }
    }
    private func reset() { typer?.invalidate(); withAnimation { stage = "idle" }; typed = "" }
}
