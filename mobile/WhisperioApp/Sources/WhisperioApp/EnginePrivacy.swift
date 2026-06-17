import SwiftUI

// Engine & privacy — the settled Direction B (processing chain) + the Cloud consent sheet,
// ported from mobile/wz-engine.jsx. This is the spine of the concept: on-device by default,
// Cloud is an explicit, consented fallback.

// "Where does the audio go" line.
struct FlowLine: View {
    @Environment(\.wz) private var t
    var cloud: Bool
    var body: some View {
        HStack(spacing: 7) {
            WIcon(cloud ? "cloud" : "lock", size: 13)
            Text(cloud ? "Audio is sent to a provider to transcribe"
                       : "Audio never leaves this iPhone")
        }
        .font(WZFont.mono(11))
        .foregroundStyle(cloud ? t.amber : t.green)
    }
}

// One node in the processing chain.
private struct ChainNode: View {
    @Environment(\.wz) private var t
    let icon, title, sub: String
    var badge: EngineMode? = nil
    var on = true
    var locked = false
    var toggle: Binding<Bool>? = nil

    var body: some View {
        let cloudBadge = badge == .cloud
        HStack(spacing: 13) {
            WIcon(icon, size: 18)
                .foregroundStyle(cloudBadge ? t.amber : t.accentLite)
                .frame(width: 38, height: 38)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 7) {
                    Text(title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                    if let badge { PrivacyBadge(mode: badge, small: true) }
                }
                Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if locked {
                HStack(spacing: 4) { WIcon("check", size: 14); Text("Always") }
                    .font(WZFont.mono(10.5, .semibold)).foregroundStyle(t.green)
            } else if let toggle {
                WToggle(on: toggle)
            }
        }
        .padding(.horizontal, 15).padding(.vertical, 13)
        .background(on ? t.surface : t.surfaceUp,
                    in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
            .stroke(on ? (cloudBadge ? t.amber.opacity(t.dark ? 0.3 : 0.28) : t.hair) : t.line, lineWidth: 1))
        .opacity(on ? 1 : 0.6)
    }
}

private struct Connector: View {
    @Environment(\.wz) private var t
    var active: Bool
    var body: some View {
        Rectangle().fill(active ? t.accent : t.line).opacity(active ? 0.7 : 1)
            .frame(width: 2, height: 16).padding(.leading, 33)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct EngineChain: View {
    @Environment(\.wz) private var t
    @Binding var cleanup: Bool
    @Binding var cloud: Bool
    var askCloud: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                WIcon("mic", size: 13).foregroundStyle(t.accentLite)
                Text("YOUR VOICE")
            }
            .font(WZFont.mono(11)).foregroundStyle(t.faint)
            .padding(.leading, 4).padding(.bottom, 10)

            ChainNode(icon: "cpu", title: "On-device transcribe",
                      sub: "Apple Speech · the base layer", badge: .device, locked: true)
            Connector(active: true)
            ChainNode(icon: "spark", title: "AI cleanup",
                      sub: "Apple Intelligence · punctuation & summaries",
                      badge: .device, on: cleanup, toggle: $cleanup)
            Connector(active: cloud)
            ChainNode(icon: "cloud", title: "Cloud fallback",
                      sub: "Only when on-device struggles", badge: .cloud, on: cloud,
                      toggle: Binding(get: { cloud },
                                      set: { $0 ? askCloud() : (cloud = false) }))
            FlowLine(cloud: cloud).padding(.top, 14)
        }
    }
}

// Cloud consent sheet — the plain-words moment that says audio leaves the device.
struct ConsentSheet: View {
    @Environment(\.wz) private var t
    var onClose: () -> Void
    var onConfirm: () -> Void

    private let points: [(String, String)] = [
        ("lock", "On-device stays your default — Cloud is a fallback you control"),
        ("trash", "Providers don’t train on your audio; nothing is stored by Whisperio"),
        ("x", "Turn it off any time — you’re back to fully offline")
    ]

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.hex(0x06050c).opacity(0.55).ignoresSafeArea()
                .onTapGesture(perform: onClose)
            VStack(spacing: 0) {
                Capsule().fill(t.line).frame(width: 38, height: 5).padding(.vertical, 14)
                HStack(spacing: 10) {
                    WIcon("cloud", size: 20).foregroundStyle(t.amber)
                        .frame(width: 40, height: 40)
                        .background(t.amber.opacity(t.dark ? 0.14 : 0.10),
                                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Text("Turn on Cloud transcription?")
                        .font(WZFont.display(19)).foregroundStyle(t.text)
                    Spacer(minLength: 0)
                }
                .padding(.bottom, 12)
                Text("Cloud is faster on long or noisy audio. When it runs, your audio and transcript are sent to OpenAI or ElevenLabs to process. Everything else stays on-device.")
                    .font(WZFont.ui(14.5)).foregroundStyle(t.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 16)
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(points.enumerated()), id: \.offset) { _, p in
                        HStack(alignment: .top, spacing: 10) {
                            WIcon(p.0, size: 15).foregroundStyle(t.accentLite)
                            Text(p.1).font(WZFont.ui(13)).foregroundStyle(t.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(.horizontal, 15).padding(.vertical, 13)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.line, lineWidth: 1))
                .padding(.bottom, 20)
                GradButton(title: "Turn on Cloud", action: onConfirm).padding(.bottom, 9)
                Button("Stay fully offline", action: onClose)
                    .font(WZFont.ui(15, .semibold)).foregroundStyle(t.muted).padding(8)
            }
            .padding(.horizontal, 22).padding(.bottom, 30)
            .background(t.surface, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
            .transition(.move(edge: .bottom))
        }
    }
}
