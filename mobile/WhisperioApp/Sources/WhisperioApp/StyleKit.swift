import SwiftUI

// Component & style page (wz-extras.jsx WZStyle): color, type, privacy iconography,
// buttons/controls, recording mic, transcript card. Always dark, like the source.
struct StyleKitView: View {
    private let t = WZTheme.darkTheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    WGhost(size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Whisperio — components").font(WZFont.display(28)).foregroundStyle(t.text)
                        Text("The reusable kit behind the Apple-mobile concept")
                            .font(WZFont.mono(12.5)).foregroundStyle(t.muted)
                    }
                }
                Rectangle().fill(t.line).frame(height: 1).padding(.vertical, 24)

                block("Color") {
                    FlowLayout(spacing: 14) {
                        swatch(AnyShapeStyle(t.accent), "violet")
                        swatch(AnyShapeStyle(t.accentLite), "violet-lite")
                        swatch(AnyShapeStyle(t.gradient), "gradient")
                        swatch(AnyShapeStyle(t.green), "on-device")
                        swatch(AnyShapeStyle(t.amber), "cloud")
                        swatch(AnyShapeStyle(t.red), "stop")
                        swatch(AnyShapeStyle(t.bg), "bg")
                        swatch(AnyShapeStyle(t.surface), "surface")
                        swatch(AnyShapeStyle(t.surfaceUp), "surface-up")
                        swatch(AnyShapeStyle(t.elevated), "elevated")
                    }
                }
                block("Type") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Space Grotesk · display").font(WZFont.display(28)).foregroundStyle(t.text)
                        Text("IBM Plex Sans · body & UI, the calm workhorse for transcripts.")
                            .font(WZFont.ui(16)).foregroundStyle(t.muted)
                        Text("JETBRAINS MONO · LABELS & META").font(WZFont.mono(12.5)).tracking(0.7).foregroundStyle(t.accentLite)
                    }
                }
                block("Privacy iconography") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) { PrivacyBadge(mode: .device); PrivacyBadge(mode: .cloud) }
                        HStack(spacing: 10) { SourceBadge(src: "keyboard"); SourceBadge(src: "action"); SourceBadge(src: "watch") }
                        FlowLine(cloud: false); FlowLine(cloud: true)
                    }
                }
                block("Buttons & controls") {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 10) { GradButton(title: "Dictate", icon: "mic").fixedSize(); GhostButton(title: "Copy", icon: "copy").fixedSize() }
                        StaticSegmented()
                        HStack(spacing: 10) {
                            EngineChip(label: "On-device", icon: "cpu")
                            EngineChip(label: "Apple Intelligence", icon: "spark")
                            EngineChip(label: "Cloud", icon: "cloud", on: false)
                        }
                    }
                }
                block("Recording mic") {
                    HStack(spacing: 22) {
                        Circle().fill(t.gradient).frame(width: 64, height: 64)
                            .overlay(WIcon("mic", size: 26).foregroundStyle(.white))
                        Circle().fill(t.red).frame(width: 70, height: 70)
                            .overlay(WIcon("stop", size: 26).foregroundStyle(.white))
                            .overlay(Circle().stroke(t.red.opacity(0.16), lineWidth: 7))
                        Waveform(color: t.accent, bars: 20, height: 48).frame(maxWidth: .infinity)
                    }
                }
                block("Transcript card") {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 8) { SourceBadge(src: "action"); PrivacyBadge(mode: .device, small: true) }.padding(.bottom, 10)
                        Text("Pick up the dry cleaning and book a table for four on Friday.")
                            .font(WZFont.ui(15)).foregroundStyle(t.text).lineSpacing(3)
                        HStack(spacing: 7) { WIcon("spark", size: 13); Text("Cleaned up on-device") }
                            .font(WZFont.mono(11)).foregroundStyle(t.accentLite).padding(.top, 12)
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                }
            }
            .padding(44)
        }
        .background(t.bg2.ignoresSafeArea())
        .environment(\.wz, t)
    }

    private func block<V: View>(_ title: String, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title.uppercased()).font(WZFont.mono(11, .semibold)).tracking(1.7).foregroundStyle(t.accentLite)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 30)
    }

    private func swatch(_ style: AnyShapeStyle, _ name: String) -> some View {
        VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(style)
                .frame(width: 64, height: 48)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.white.opacity(0.1), lineWidth: 1))
            Text(name).font(WZFont.mono(10)).foregroundStyle(t.muted)
        }
    }
}

// A static (non-interactive) segmented control for the style page.
private struct StaticSegmented: View {
    private let t = WZTheme.darkTheme
    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(["Private", "Balanced", "Best"].enumerated()), id: \.offset) { idx, label in
                Text(label).font(WZFont.ui(13, .semibold)).foregroundStyle(idx == 1 ? .white : t.muted)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(idx == 1 ? t.accent : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }
        .padding(3).background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
    }
}

// Minimal wrapping layout for the color swatches (iOS 16+ Layout).
struct FlowLayout: Layout {
    var spacing: CGFloat = 10
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? 360
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxWidth { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
        return CGSize(width: maxWidth, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}
