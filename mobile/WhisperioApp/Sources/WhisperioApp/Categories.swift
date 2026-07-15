import SwiftUI

// Transcription categories — a light, demo-level taxonomy that carries the desktop
// brand identity onto the recordings. Each category is a WIcon key (mapped to an SF
// Symbol in Components.swift) plus one of the theme's accent hues, so chips and labels
// stay on-palette in both dark and light mode.
//
// Categories are metadata over the existing recordings: the persisted WhisperioKit
// Recording carries an optional category id, DemoRecording mirrors it for display, and the
// Home filter row + Detail menu read/write through RecordingsStore (which saves changes).

struct WZCategory: Identifiable, Hashable {
    let id: String       // stable key, also what DemoRecording stores
    let label: String
    let icon: String     // WIcon key → SF Symbol
    // Resolve the accent hue against the active theme (so it flips correctly in light mode).
    let hue: (WZTheme) -> Color

    static func == (lhs: WZCategory, rhs: WZCategory) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

enum WZCategories {
    // Fixed hue-tinted pills per the redesign brief (mob-core WZCategory hues) — these five
    // stay constant across light/dark and don't flip with the theme, so a category reads the
    // same everywhere. "Personal" isn't in the brief's palette; it keeps the theme's amber.
    static let work     = WZCategory(id: "work",     label: "Work",     icon: "folder",   hue: { _ in .hex(0x4a8cf7) })
    static let personal = WZCategory(id: "personal", label: "Personal", icon: "sun",      hue: { $0.amber })
    static let ideas    = WZCategory(id: "ideas",    label: "Ideas",    icon: "spark",    hue: { _ in .hex(0xfbbf24) })
    static let messages = WZCategory(id: "messages", label: "Messages", icon: "send",     hue: { _ in .hex(0xf472b6) })
    static let code     = WZCategory(id: "code",     label: "Code",     icon: "command",  hue: { _ in .hex(0xa78bfa) })
    static let todo     = WZCategory(id: "todo",     label: "To-do",    icon: "check",    hue: { _ in .hex(0x34d399) })

    // The default set, in display order (used for the filter row and the reassign menu).
    static let all: [WZCategory] = [work, personal, ideas, messages, code, todo]

    private static let byId: [String: WZCategory] = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })

    /// Look up a category by id, falling back to Work so callers always get a value.
    static func of(_ id: String) -> WZCategory { byId[id] ?? work }
}

// MARK: - UI

// A filter chip for the Home category row. "All" is passed as category == nil.
struct CategoryFilterChip: View {
    @Environment(\.wz) private var t
    let category: WZCategory?   // nil → the "All" chip
    let selected: Bool
    let action: () -> Void

    var body: some View {
        let hue = category?.hue(t) ?? t.accent
        Button(action: action) {
            HStack(spacing: 6) {
                if let category { WIcon(category.icon, size: 12) }
                Text(category?.label ?? "All")
            }
            .font(WZFont.mono(11.5, .semibold))
            .foregroundStyle(selected ? .white : t.muted)
            .padding(.horizontal, 13).padding(.vertical, 7)
            .background(selected ? hue : t.surfaceUp, in: Capsule())
            .overlay(Capsule().stroke(selected ? .clear : t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// A compact category label (icon + name) shown on a recording row/card, tinted with the
// category's accent hue.
struct CategoryTag: View {
    @Environment(\.wz) private var t
    let category: WZCategory

    var body: some View {
        let c = category.hue(t)
        HStack(spacing: 5) {
            WIcon(category.icon, size: 10.5)
            Text(category.label)
        }
        .font(WZFont.mono(10, .semibold))
        .foregroundStyle(c)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(c.opacity(t.dark ? 0.14 : 0.10), in: Capsule())
        .overlay(Capsule().stroke(c.opacity(t.dark ? 0.28 : 0.24), lineWidth: 1))
    }
}
