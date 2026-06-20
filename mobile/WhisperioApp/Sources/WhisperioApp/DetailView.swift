import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// Transcript detail — shows the real transcript with source/privacy badges,
// plus Copy and Share. (No fake "raw vs cleaned" toggle or "insert" — the engine
// returns one transcript, and there's no system "insert into app" without an
// extension.)
struct DetailView: View {
    @Environment(\.wz) private var t
    let r: DemoRecording
    var onBack: () -> Void
    var toast: (String) -> Void

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Transcript", onBack: onBack) {
                    SquareIconButton(icon: "more")
                }
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 8) {
                            SourceBadge(src: r.src)
                            PrivacyBadge(mode: r.engine == "cloud" ? .cloud : .device, small: true)
                        }
                        Text("\(r.app) · \(r.when) · \(r.dur) · \(r.words) words")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint)

                        VStack(alignment: .leading, spacing: 0) {
                            SectionLabel(text: "Transcript").padding(.bottom, 12)
                            Text(r.title)
                                .font(WZFont.ui(17)).foregroundStyle(t.text).lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                    }
                    .padding(.horizontal, 18).padding(.top, 8)
                }

                // actions
                HStack(spacing: 9) {
                    GhostButton(title: "Copy", icon: "copy") {
#if canImport(UIKit)
                        UIPasteboard.general.string = r.title
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
#endif
                        toast("Copied!")
                    }
                    ShareLink(item: r.title) {
                        HStack(spacing: 8) {
                            WIcon("share", size: 16)
                            Text("Share")
                        }
                        .font(WZFont.ui(14, .semibold)).foregroundStyle(t.text)
                        .frame(maxWidth: .infinity).padding(.vertical, 12).padding(.horizontal, 18)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.line, lineWidth: 1))
                    }
                }
                .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 32)
            }
        }
    }
}
