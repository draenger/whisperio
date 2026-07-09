import SwiftUI

// Screen shell — clears the status bar (paddingTop 54) and fills with the theme bg.
struct ScreenScaffold<Content: View>: View {
    @Environment(\.wz) private var t
    var bg: Color? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.top, 54)
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
                        .frame(width: 36, height: 36)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(t.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            } else {
                WGhost(size: 26)
            }
            Text(title)
                .font(WZFont.display(onBack == nil ? 20 : 17))
                .foregroundStyle(t.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            right
        }
        .frame(minHeight: 36)
        .padding(.horizontal, onBack == nil ? 18 : 16)
        .padding(.top, onBack == nil ? 4 : 6)
        .padding(.bottom, onBack == nil ? 6 : 8)
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
