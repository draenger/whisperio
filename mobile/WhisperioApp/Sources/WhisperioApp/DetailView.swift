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
    @EnvironmentObject private var recordings: RecordingsStore
    let r: DemoRecording
    var onBack: () -> Void
    var toast: (String) -> Void

    // The recording's category, resolved live from the store so a reassignment here shows up
    // on Home too. Seeded from the store on appear (falls back to the recording's own tag).
    @State private var categoryId: String = WZCategories.work.id
    private var category: WZCategory { WZCategories.of(categoryId) }

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
                            Spacer(minLength: 0)
                            categoryMenu
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
            .onAppear { categoryId = recordings.categoryId(for: r) }
        }
    }

    // Reassign the recording's category. Selecting a category writes it back to the store so
    // the Home list + filter row reflect the change immediately.
    private var categoryMenu: some View {
        Menu {
            ForEach(WZCategories.all) { cat in
                Button {
                    categoryId = cat.id
                    recordings.setCategory(cat.id, for: r)
#if canImport(UIKit)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
#endif
                } label: {
                    Label(cat.label, systemImage: WZIcon.symbol(cat.icon))
                    if cat.id == categoryId { Image(systemName: "checkmark") }
                }
            }
        } label: {
            let c = category.hue(t)
            HStack(spacing: 5) {
                WIcon(category.icon, size: 10.5)
                Text(category.label)
                WIcon("chevD", size: 9)
            }
            .font(WZFont.mono(10, .semibold))
            .foregroundStyle(c)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(c.opacity(t.dark ? 0.14 : 0.10), in: Capsule())
            .overlay(Capsule().stroke(c.opacity(t.dark ? 0.28 : 0.24), lineWidth: 1))
        }
    }
}
