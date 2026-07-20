import SwiftUI

// Design tokens — a direct port of the Claude Design concept's `wz(dark)` palette
// (mobile/wz-core.jsx). Dark is the default "aurora"; light is the flipped system.

struct WZTheme {
    let dark: Bool
    let bg, bg2, surface, surfaceUp, elevated: Color
    let line, lineSoft, hair: Color
    let text, muted, faint: Color
    let accent, accentLite: Color
    let gradient: LinearGradient
    let green, red, amber, cyan: Color
    let primaryInk: Color

    // `primary` is the app's action-fill color; per the design's `buildRezmeTheme` it is
    // literally the same value as `accent` (no second source of truth), while `primaryInk`
    // is the correct-contrast text/icon color to paint on top of that fill.
    var primary: Color { accent }

    // The "redesign" identity: the Rezme teal palette is the app-wide default across the whole
    // Apple family (iPhone / iPad / Watch / Mac). The original violet aurora palette (accent
    // #8b5cf6/#a78bfa, bg #0a0911/#15121f) has been fully retired — no live code path
    // references it anymore; recover it from git history if it's ever needed again.
    static func of(_ dark: Bool) -> WZTheme { dark ? .rezmeTheme : .rezmeLightTheme }

    // Rezme teal — the macOS desktop identity. Dark-first, built around the Rezme
    // signature teal #1cc8b4 (accent) with a lighter #4fe0cf tint for hover/lite states.
    // The CTA gradient stays in-family: bright teal → deep teal-cyan, no violet.
    // Reachable on macOS (this file is pure SwiftUI); the Mac window applies it via `\.wz`.
    static let rezmeTheme = WZTheme(
        dark: true,
        bg: .hex(0x070d15), bg2: .hex(0x05090f), surface: .hex(0x101b2a),
        surfaceUp: .hex(0x0c1826), elevated: .hex(0x16243a),
        line: .hex(0x202b3b), lineSoft: .white.opacity(0.05),
        hair: Color(red: 28/255, green: 200/255, blue: 180/255).opacity(0.30),
        text: .hex(0xecf2f9), muted: .hex(0xb4c1d0), faint: .hex(0x7e91a4),
        accent: .hex(0x1cc8b4), accentLite: .hex(0x5ee0d0),
        gradient: LinearGradient(stops: [
            .init(color: .hex(0x15bca8), location: 0.0),
            .init(color: .hex(0x3da2f7), location: 1.0),
        ], startPoint: .leading, endPoint: .trailing),
        green: .hex(0x22c55e), red: .hex(0xef4444), amber: .hex(0xf59e0b), cyan: .hex(0x1cc8b4),
        primaryInk: .hex(0x02110f)
    )

    // Light companion to `rezmeTheme` — teal accent on light surfaces, so the redesign holds up
    // in light mode too (deeper teal accents for contrast on white).
    static let rezmeLightTheme = WZTheme(
        dark: false,
        bg: .hex(0xf6f8fa), bg2: .hex(0xeef2f6), surface: .hex(0xffffff),
        surfaceUp: .hex(0xffffff), elevated: .hex(0xeef2f6),
        line: .hex(0xe3e9ef),
        lineSoft: Color(red: 20/255, green: 40/255, blue: 60/255).opacity(0.05),
        hair: Color(red: 28/255, green: 200/255, blue: 180/255).opacity(0.30),
        text: .hex(0x0c1822), muted: .hex(0x3f4f5e), faint: .hex(0x74859a),
        accent: .hex(0x0f8478), accentLite: .hex(0x1cc8b4),
        gradient: LinearGradient(stops: [
            .init(color: .hex(0x0f9b8b), location: 0.0),
            .init(color: .hex(0x1d7fd6), location: 1.0),
        ], startPoint: .leading, endPoint: .trailing),
        green: .hex(0x16a34a), red: .hex(0xdc2626), amber: .hex(0xd97706), cyan: .hex(0x0f8478),
        primaryInk: .hex(0xffffff)
    )
}

// MARK: - Fonts
// The exact concept faces, bundled (all SIL OFL — fine for a noncommercial app):
//   • display → Space Grotesk   (Regular / Medium / Bold)
//   • UI      → IBM Plex Sans    (Regular / Medium / SemiBold)
//   • mono    → JetBrains Mono   (Regular / Medium / SemiBold)
// Font files live in Sources/WhisperioApp/Fonts and are registered via AppInfo.plist
// (UIAppFonts). `Font.custom` falls back to the system face if a name is ever missing,
// so a bad name degrades gracefully rather than crashing.
enum WZFont {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        // Four real cuts: the design's FD titles are weight 600 (SemiBold) — mapping semibold
        // onto Bold(700) made every header render heavier/wider than the mock.
        .custom(["SpaceGrotesk-Regular", "SpaceGrotesk-Medium", "SpaceGrotesk-SemiBold", "SpaceGrotesk-Bold"][displayBucket(weight)], size: size)
    }
    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom(["IBMPlexSans", "IBMPlexSans-Medm", "IBMPlexSans-SmBld"][bucket(weight)], size: size)
    }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom(["JetBrainsMono-Regular", "JetBrainsMono-Medium", "JetBrainsMono-SemiBold"][bucket(weight)], size: size)
    }

    // Map a requested weight onto the three bundled static weights we ship.
    private static func bucket(_ w: Font.Weight) -> Int {
        if w == .medium { return 1 }
        if w == .semibold || w == .bold || w == .heavy || w == .black { return 2 }
        return 0
    }

    // Display face only — Space Grotesk ships four cuts here, so true Bold survives while
    // semibold stops being upgraded to it.
    private static func displayBucket(_ w: Font.Weight) -> Int {
        if w == .medium { return 1 }
        if w == .semibold { return 2 }
        if w == .bold || w == .heavy || w == .black { return 3 }
        return 0
    }
}

// MARK: - Color hex helper
extension Color {
    static func hex(_ value: UInt32) -> Color {
        Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

// Make the theme available down the view tree.
private struct WZThemeKey: EnvironmentKey {
    static let defaultValue = WZTheme.rezmeTheme
}
extension EnvironmentValues {
    var wz: WZTheme {
        get { self[WZThemeKey.self] }
        set { self[WZThemeKey.self] = newValue }
    }
}

// Set true only by a shell that has injected the real RecordingsStore / DigestStore / SettingsStore
// (the live iPad/Mac app entry). Left false in the Gallery/preview so the iPad Journal falls back to
// its self-contained sample data and never resolves a missing @EnvironmentObject.
private struct WZLiveJournalKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var wzLiveJournal: Bool {
        get { self[WZLiveJournalKey.self] }
        set { self[WZLiveJournalKey.self] = newValue }
    }
}
