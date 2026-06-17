import SwiftUI

// Transcript detail — cleaned/raw toggle, source + privacy badges, waveform scrubber,
// copy / share / insert. Port of Detail() in wz-iphone.jsx.
struct DetailView: View {
    @Environment(\.wz) private var t
    let r: DemoRecording
    var onBack: () -> Void
    var toast: (String) -> Void

    @State private var tidy = true
    private var raw: String {
        r.title.replacingOccurrences(of: ".", with: "")
            .replacingOccurrences(of: ",", with: "").lowercased()
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Transcript", onBack: onBack) {
                    SquareIconButton(icon: "more")
                }
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        // meta row
                        HStack(spacing: 8) {
                            SourceBadge(src: r.src)
                            PrivacyBadge(mode: r.engine == "cloud" ? .cloud : .device, small: true)
                        }
                        Text("\(r.app) · \(r.when) · \(r.dur) · \(r.words) words")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint)

                        // transcript card
                        VStack(alignment: .leading, spacing: 0) {
                            HStack {
                                SectionLabel(text: tidy ? "Cleaned up" : "Raw")
                                Spacer()
                                HStack(spacing: 8) {
                                    Text("AI cleanup").font(WZFont.ui(12)).foregroundStyle(t.muted)
                                    WToggle(on: $tidy)
                                }
                            }
                            .padding(.bottom, 12)
                            Text(tidy ? r.title : raw)
                                .font(WZFont.ui(17)).foregroundStyle(t.text).lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                            if tidy {
                                HStack(spacing: 7) {
                                    WIcon("spark", size: 13)
                                    Text("Punctuation & casing fixed on-device")
                                }
                                .font(WZFont.mono(11)).foregroundStyle(t.accentLite).padding(.top, 14)
                            }
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))

                        // scrubber
                        HStack(spacing: 14) {
                            Button { } label: {
                                WIcon("bolt", size: 18).foregroundStyle(.white)
                                    .frame(width: 42, height: 42).background(t.gradient, in: Circle())
                            }
                            .buttonStyle(.plain)
                            MiniWave(color: t.accent, n: 40, height: 28).frame(maxWidth: .infinity)
                            Text(r.dur).font(WZFont.mono(12)).foregroundStyle(t.faint)
                        }
                        .padding(.horizontal, 18).padding(.vertical, 16)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                    }
                    .padding(.horizontal, 18).padding(.top, 8)
                }

                // actions
                HStack(spacing: 9) {
                    GhostButton(title: "Copy", icon: "copy") { toast("Copied to clipboard") }
                    GhostButton(title: "Share", icon: "share") { toast("Sharing…") }
                    GradButton(title: "Insert", icon: "arrowUR") { toast("Inserted into \(r.app)") }
                }
                .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 32)
            }
        }
    }
}
