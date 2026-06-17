import SwiftUI

// Settings — engine chain (with Cloud consent), trigger status, appearance.
// Port of Settings() in wz-iphone.jsx.
struct SettingsView: View {
    @Environment(\.wz) private var t
    var onBack: () -> Void
    @Binding var dark: Bool
    var openModels: () -> Void

    @State private var cloud = false
    @State private var cleanup = true
    @State private var backtap = "double"
    @State private var sheet = false

    var body: some View {
        ScreenScaffold {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    WHeader(title: "Settings", onBack: onBack)
                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 18) {
                            // engine & privacy
                            VStack(alignment: .leading, spacing: 10) {
                                SectionLabel(text: "Engine & privacy").padding(.leading, 4)
                                EngineChain(cleanup: $cleanup, cloud: $cloud) { sheet = true }
                                    .padding(16)
                                    .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                            }

                            SettGroup(title: "On-device models") {
                                SettRow(icon: "download", label: "Manage models",
                                        sub: "Apple Speech · 1 Whisper model added",
                                        last: true, onTap: openModels)
                            }

                            SettGroup(title: "Triggers") {
                                SettRow(icon: "keyboard", label: "Whisperio keyboard",
                                        sub: "Enabled · Full Access on") {
                                    WIcon("check", size: 18).foregroundStyle(t.green)
                                }
                                SettRow(icon: "bolt", label: "Action Button",
                                        sub: "Hold to dictate → clipboard") {
                                    Text("Hold").font(WZFont.mono(12)).foregroundStyle(t.muted)
                                }
                                SettRow(icon: "command", label: "Back-Tap",
                                        sub: "Accessibility gesture", last: true) {
                                    HStack(spacing: 4) {
                                        ForEach(["double", "triple"], id: \.self) { o in
                                            Button { backtap = o } label: {
                                                Text(o.capitalized).font(WZFont.mono(11, .semibold))
                                                    .foregroundStyle(backtap == o ? .white : t.muted)
                                                    .padding(.horizontal, 9).padding(.vertical, 4)
                                                    .background(backtap == o ? t.accent : .clear,
                                                                in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                    .padding(3)
                                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
                                }
                            }

                            SettGroup(title: "Appearance") {
                                SettRow(icon: dark ? "moon" : "sun", label: "Dark mode",
                                        sub: "Match Whisperio’s look", last: true) {
                                    WToggle(on: $dark)
                                }
                            }

                            Text("Whisperio 1.0 · open-source · on-device")
                                .font(WZFont.mono(11)).foregroundStyle(t.faint)
                                .frame(maxWidth: .infinity, alignment: .center)
                        }
                        .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                    }
                }
                if sheet {
                    ConsentSheet(onClose: { withAnimation { sheet = false } },
                                 onConfirm: { withAnimation { cloud = true; sheet = false } })
                    .transition(.opacity)
                }
            }
            .animation(.spring(response: 0.3, dampingFraction: 0.85), value: sheet)
        }
    }
}

struct SettGroup<Content: View>: View {
    @Environment(\.wz) private var t
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title).padding(.leading, 4)
            VStack(spacing: 0) { content }
                .padding(.horizontal, 16)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}

struct SettRow<Right: View>: View {
    @Environment(\.wz) private var t
    let icon: String
    let label: String
    var sub: String? = nil
    var last = false
    var onTap: (() -> Void)? = nil
    @ViewBuilder var right: Right

    var body: some View {
        let row = HStack(spacing: 13) {
            WIcon(icon, size: 17, weight: .regular).foregroundStyle(t.accentLite)
                .frame(width: 34, height: 34)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                if let sub { Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted) }
            }
            Spacer(minLength: 0)
            right
            if onTap != nil, Right.self == EmptyView.self {
                WIcon("chevR", size: 17, weight: .regular).foregroundStyle(t.faint)
            }
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(t.lineSoft).frame(height: 1) }
        }

        if let onTap {
            Button(action: onTap) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }
}

extension SettRow where Right == EmptyView {
    init(icon: String, label: String, sub: String? = nil, last: Bool = false, onTap: (() -> Void)? = nil) {
        self.init(icon: icon, label: label, sub: sub, last: last, onTap: onTap) { EmptyView() }
    }
}
