import SwiftUI

// Screen shell — fills with the theme bg. On iOS the real safe area already clears the
// status bar (the mock's fixed 54px strip would double it into a dead band above the
// header); macOS has no safe area, so it keeps the fixed clearance below the titlebar.
struct ScreenScaffold<Content: View>: View {
    @Environment(\.wz) private var t
    var bg: Color? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            #if os(macOS)
            .padding(.top, 54)
            #endif
            .background((bg ?? t.bg).ignoresSafeArea())
    }
}

// Shared header (port of WHeader): ghost or back button + title + optional trailing.
struct WHeader<Right: View>: View {
    @Environment(\.wz) private var t
    let title: String
    var onBack: (() -> Void)? = nil
    @ViewBuilder var right: Right

    var body: some View {
        HStack(spacing: 12) {
            if let onBack {
                Button(action: onBack) {
                    WIcon("chevL", size: 18, weight: .bold)
                        .foregroundStyle(t.text)
                        .frame(width: 38, height: 38)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            } else {
                // Design WHeader logo slot: the animated ghost at 40pt, tappable for a
                // one-shot fun reaction (rock/spin/jelly/phase/tilt).
                WGhost(size: 40, tapFun: true)
            }
            Text(title)
                .font(WZFont.display(24))
                .foregroundStyle(t.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            right
        }
        .frame(minHeight: 36)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }
}

extension WHeader where Right == EmptyView {
    init(title: String, onBack: (() -> Void)? = nil) {
        self.init(title: title, onBack: onBack) { EmptyView() }
    }
}

// Small reusable square icon button used in headers (settings / more).
struct SquareIconButton: View {
    @Environment(\.wz) private var t
    let icon: String
    var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            WIcon(icon, size: 19, weight: .regular)
                .foregroundStyle(t.muted)
                .frame(width: 38, height: 38)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// Tiny header status glyph for the iCloud-backed library: a teal cloud when the library syncs
// via CloudKit, swapped for a mini spinner while an import/export is actively in flight.
// Renders nothing when the library isn't cloud-backed (on-device / JSON store). Pure view —
// takes explicit state so it works both live and in sample/gallery contexts.
struct SyncStatusGlyph: View {
    @Environment(\.wz) private var t
    var isCloudBacked: Bool
    var isSyncing: Bool

    var body: some View {
        if isCloudBacked {
            ZStack {
                if isSyncing {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(t.cyan)
                } else {
                    Image(systemName: "icloud")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(t.cyan)
                }
            }
            .frame(width: 22, height: 22)
            .help(isSyncing ? "Syncing…" : "iCloud")
            .accessibilityLabel(isSyncing ? "Syncing" : "iCloud backed")
        }
    }
}

// Live wrapper reading the injected RecordingsStore, for use inside the app shell (Home header).
struct HeaderSyncGlyph: View {
    @EnvironmentObject private var recordings: RecordingsStore
    var body: some View {
        SyncStatusGlyph(isCloudBacked: recordings.isCloudBacked, isSyncing: recordings.isSyncing)
    }
}

// Uppercase mono section label (used throughout).
struct SectionLabel: View {
    @Environment(\.wz) private var t
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(WZFont.mono(11, .semibold))
            .tracking(1.1)
            .foregroundStyle(t.faint)
    }
}
