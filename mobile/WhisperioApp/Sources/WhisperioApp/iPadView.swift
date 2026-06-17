import SwiftUI

// iPad — Obsidian-style split view (library + transcript). Port of WZiPad (wz-scenes.jsx).
// Renders responsively; on a real iPad it fills the window via NavigationSplitView-like layout.
struct iPadSplitView: View {
    @Environment(\.wz) private var t
    @State private var sel = WZSample.recordings[0].id
    private var cur: DemoRecording { WZSample.recordings.first { $0.id == sel } ?? WZSample.recordings[0] }

    var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 340)
            Rectangle().fill(t.line).frame(width: 1)
            detail.frame(maxWidth: .infinity)
        }
        .background(t.bg.ignoresSafeArea())
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                WGhost(size: 24)
                Text("Whisperio").font(WZFont.display(20)).foregroundStyle(t.text)
                Spacer()
                PrivacyBadge(mode: .device, small: true)
            }
            .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 12)
            HStack(spacing: 8) {
                WIcon("search", size: 16, weight: .regular); Text("Search").font(WZFont.ui(14)); Spacer()
            }
            .foregroundStyle(t.faint).padding(.horizontal, 12).padding(.vertical, 9)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(t.line, lineWidth: 1))
            .padding(.horizontal, 16).padding(.bottom, 12)
            HStack(spacing: 16) {
                Text("All").foregroundStyle(t.accentLite); Text("Keyboard"); Text("Watch")
            }
            .font(WZFont.mono(11, .semibold)).foregroundStyle(t.faint).padding(.horizontal, 18).padding(.bottom, 6)
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(WZSample.recordings) { r in
                        Button { sel = r.id } label: { sidebarRow(r) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 10).padding(.top, 8)
            }
        }
        .background(t.bg2)
    }

    private func sidebarRow(_ r: DemoRecording) -> some View {
        let on = sel == r.id
        let icon = r.src == "watch" ? "watch" : r.src == "action" ? "bolt" : r.src == "keyboard" ? "keyboard" : "mic"
        return HStack(alignment: .top, spacing: 11) {
            WIcon(icon, size: 15, weight: .regular).foregroundStyle(t.accentLite)
                .frame(width: 32, height: 32)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
            VStack(alignment: .leading, spacing: 5) {
                Text(r.title).font(WZFont.ui(13.5, .medium)).foregroundStyle(t.text).lineLimit(2).multilineTextAlignment(.leading)
                Text("\(r.app) · \(r.when)").font(WZFont.mono(10.5)).foregroundStyle(t.faint)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(on ? t.accent.opacity(t.dark ? 0.14 : 0.08) : .clear, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(on ? t.hair : .clear, lineWidth: 1))
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                SourceBadge(src: cur.src)
                PrivacyBadge(mode: cur.engine == "cloud" ? .cloud : .device, small: true)
                Text("\(cur.app) · \(cur.when) · \(cur.dur) · \(cur.words) words")
                    .font(WZFont.mono(12)).foregroundStyle(t.faint)
                Spacer()
                GhostButton(title: "Copy", icon: "copy").fixedSize()
                GradButton(title: "Insert", icon: "arrowUR").fixedSize()
            }
            .padding(.horizontal, 32).padding(.vertical, 18)
            .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 7) { WIcon("spark", size: 13); Text("CLEANED UP ON-DEVICE") }
                        .font(WZFont.mono(11, .semibold)).tracking(1.1).foregroundStyle(t.accentLite).padding(.bottom, 14)
                    Text(cur.title).font(WZFont.display(28, .medium)).foregroundStyle(t.text).lineSpacing(8)
                    HStack(spacing: 16) {
                        Circle().fill(t.gradient).frame(width: 46, height: 46)
                            .overlay(WIcon("bolt", size: 20).foregroundStyle(.white))
                        MiniWave(color: t.accent, n: 64, height: 32).frame(maxWidth: .infinity)
                        Text(cur.dur).font(WZFont.mono(13)).foregroundStyle(t.faint)
                    }
                    .padding(.horizontal, 22).padding(.vertical, 18).padding(.top, 30)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                }
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 40).padding(.vertical, 32)
            }
        }
    }
}
