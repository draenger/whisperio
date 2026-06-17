import SwiftUI

// On-device model management — Apple Speech / Apple Intelligence + downloadable Whisper
// models, with the privacy reassurance banner. Port of Models() in wz-iphone.jsx.
struct ModelsView: View {
    @Environment(\.wz) private var t
    var onBack: () -> Void

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "On-device models", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 11) {
                        // privacy banner
                        HStack(spacing: 9) {
                            WIcon("shield", size: 18).foregroundStyle(t.green)
                            Text("Models run entirely on your device. Audio never leaves your iPhone.")
                                .font(WZFont.ui(13)).foregroundStyle(t.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(t.green.opacity(t.dark ? 0.10 : 0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.green.opacity(t.dark ? 0.22 : 0.20), lineWidth: 1))
                        .padding(.bottom, 5)

                        ForEach(WZSample.models) { m in modelCard(m) }
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
    }

    private func modelCard(_ m: DemoModel) -> some View {
        let icon = m.id.hasPrefix("apple") ? (m.id == "apple-int" ? "spark" : "cpu") : "download"
        return VStack(spacing: 0) {
            HStack(spacing: 12) {
                WIcon(icon, size: 18, weight: .regular).foregroundStyle(t.accentLite)
                    .frame(width: 38, height: 38)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(m.name).font(WZFont.display(15)).foregroundStyle(t.text)
                        if let tag = m.tag {
                            Text(tag).font(WZFont.mono(10)).foregroundStyle(t.accentLite)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(t.line, lineWidth: 1))
                        }
                    }
                    Text("\(m.sub) · \(m.size)").font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                }
                Spacer(minLength: 0)
                trailing(m)
            }
            if m.state == "downloading", let pct = m.pct {
                VStack(spacing: 6) {
                    HStack {
                        Text("Downloading…"); Spacer(); Text("\(pct)%")
                    }
                    .font(WZFont.mono(11)).foregroundStyle(t.muted)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(t.surfaceUp)
                            Capsule().fill(t.gradient).frame(width: geo.size.width * CGFloat(pct) / 100)
                        }
                    }
                    .frame(height: 6)
                }
                .padding(.top, 13)
            }
        }
        .padding(15)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(m.state == "active" ? t.hair : t.line, lineWidth: 1))
    }

    @ViewBuilder private func trailing(_ m: DemoModel) -> some View {
        switch m.state {
        case "active":
            WIcon("check", size: 20).foregroundStyle(t.green)
        case "ready":
            Text(m.id == "apple-int" ? "On" : "Use")
                .font(WZFont.ui(13, .semibold)).foregroundStyle(t.accentLite)
                .padding(.horizontal, 13).padding(.vertical, 7)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
        case "get":
            HStack(spacing: 5) { WIcon("download", size: 14); Text("Get") }
                .font(WZFont.ui(13, .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 13).padding(.vertical, 7)
                .background(t.accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        default:
            EmptyView()
        }
    }
}
