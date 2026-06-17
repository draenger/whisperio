import SwiftUI

// Engine & privacy — the three explored directions from the concept (wz-engine.jsx).
// Direction B (the processing chain) is the settled one and lives in EnginePrivacy.swift;
// A and C are kept here for the "3 directions" canvas.

// Direction A — privacy-led radio cards.
struct EngineDirectionA: View {
    @Environment(\.wz) private var t
    @State private var mode = "device"
    private let opts: [(id: String, icon: String, title: String, sub: String, badge: EngineMode, rec: Bool)] = [
        ("device", "lock", "On-device only", "Apple Speech · works offline", .device, true),
        ("cleanup", "spark", "On-device + AI cleanup", "Apple Intelligence tidies punctuation", .device, false),
        ("cloud", "cloud", "Cloud accuracy", "OpenAI / ElevenLabs · best on hard audio", .cloud, false)
    ]
    var body: some View {
        VStack(spacing: 11) {
            ForEach(Array(opts.enumerated()), id: \.offset) { _, o in
                let on = mode == o.id
                Button { withAnimation(.easeInOut(duration: 0.2)) { mode = o.id } } label: {
                    HStack(spacing: 13) {
                        WIcon(o.icon, size: 20).foregroundStyle(o.badge == .cloud ? t.amber : t.accentLite)
                            .frame(width: 42, height: 42)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 7) {
                                Text(o.title).font(WZFont.ui(15, .semibold)).foregroundStyle(t.text)
                                if o.rec {
                                    Text("DEFAULT").font(WZFont.mono(9.5)).foregroundStyle(t.accentLite)
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(t.line, lineWidth: 1))
                                }
                            }
                            Text(o.sub).font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                        }
                        Spacer(minLength: 0)
                        PrivacyBadge(mode: o.badge, small: true)
                    }
                    .padding(15)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(on ? t.accent : t.line, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
            }
            if mode == "cloud" { FlowLine(cloud: true).frame(maxWidth: .infinity, alignment: .leading) }
        }
    }
}

// Direction C — privacy tier dial.
struct EngineDirectionC: View {
    @Environment(\.wz) private var t
    @State private var tier = "private"
    private struct Tier { let badge: EngineMode; let icon, head, line: String; let cloud: Bool }
    private var data: [String: Tier] {
        [
            "private": Tier(badge: .device, icon: "lock", head: "Private",
                            line: "Fully offline. Apple Speech only. Your audio never leaves the iPhone — even in airplane mode.", cloud: false),
            "balanced": Tier(badge: .device, icon: "spark", head: "Balanced",
                             line: "On-device transcription plus Apple Intelligence cleanup. Still fully on-device, just tidier.", cloud: false),
            "best": Tier(badge: .cloud, icon: "cloud", head: "Best accuracy",
                         line: "Falls back to Cloud (OpenAI / ElevenLabs) on long or noisy audio. Sends audio off-device when it does.", cloud: true)
        ]
    }
    var body: some View {
        let d = data[tier] ?? data["private"]!
        VStack(spacing: 16) {
            Segmented(value: $tier, options: [(id: "private", label: "Private"), (id: "balanced", label: "Balanced"), (id: "best", label: "Best")])
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 11) {
                    WIcon(d.icon, size: 22).foregroundStyle(d.cloud ? t.amber : t.accentLite)
                        .frame(width: 46, height: 46)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    Text(d.head).font(WZFont.display(19)).foregroundStyle(t.text)
                    Spacer(minLength: 0)
                    PrivacyBadge(mode: d.badge)
                }
                .padding(.bottom, 12)
                Text(d.line).font(WZFont.ui(14)).foregroundStyle(t.muted)
                    .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(18)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(d.cloud ? t.amber.opacity(t.dark ? 0.3 : 0.28) : t.hair, lineWidth: 1))
        }
        .animation(.easeInOut(duration: 0.25), value: tier)
    }
}
