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

    // The primary CTA gradient carries the desktop identity: teal → indigo, warmed with a
    // touch of accent violet at the mid-stop so it reads as one family with the violet accent.
    static let darkTheme = WZTheme(
        dark: true,
        bg: .hex(0x0a0911), bg2: .hex(0x07060d), surface: .hex(0x15121f),
        surfaceUp: .hex(0x1c1830), elevated: .hex(0x221d33),
        line: .white.opacity(0.08), lineSoft: .white.opacity(0.05),
        hair: Color(red: 167/255, green: 139/255, blue: 250/255).opacity(0.22),
        text: .hex(0xECEBF4), muted: .hex(0x9d9bb4), faint: .hex(0x6a6880),
        accent: .hex(0x8b5cf6), accentLite: .hex(0xa78bfa),
        gradient: LinearGradient(stops: [
            .init(color: .hex(0x2dd4bf), location: 0.0),
            .init(color: .hex(0x7c8cf8), location: 0.52),
            .init(color: .hex(0x6366f1), location: 1.0),
        ], startPoint: .topLeading, endPoint: .bottomTrailing),
        green: .hex(0x34d399), red: .hex(0xf0556b), amber: .hex(0xfbbf24), cyan: .hex(0x2dd4bf)
    )

    static let lightTheme = WZTheme(
        dark: false,
        bg: .hex(0xf4f3fb), bg2: .hex(0xecebf3), surface: .hex(0xffffff),
        surfaceUp: .hex(0xf6f5fc), elevated: .hex(0xefedf8),
        line: Color(red: 20/255, green: 18/255, blue: 40/255).opacity(0.10),
        lineSoft: Color(red: 20/255, green: 18/255, blue: 40/255).opacity(0.06),
        hair: Color(red: 124/255, green: 58/255, blue: 237/255).opacity(0.20),
        text: .hex(0x1b1830), muted: .hex(0x5b5870), faint: .hex(0x9b98ad),
        accent: .hex(0x7c3aed), accentLite: .hex(0x8b5cf6),
        gradient: LinearGradient(stops: [
            .init(color: .hex(0x14b8a6), location: 0.0),
            .init(color: .hex(0x6d78ea), location: 0.52),
            .init(color: .hex(0x6366f1), location: 1.0),
        ], startPoint: .topLeading, endPoint: .bottomTrailing),
        green: .hex(0x16a34a), red: .hex(0xdc2626), amber: .hex(0xd97706), cyan: .hex(0x0d9488)
    )

    static func of(_ dark: Bool) -> WZTheme { dark ? .darkTheme : .lightTheme }
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
        .custom(["SpaceGrotesk-Regular", "SpaceGrotesk-Medium", "SpaceGrotesk-Bold"][bucket(weight)], size: size)
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
    static let defaultValue = WZTheme.darkTheme
}
extension EnvironmentValues {
    var wz: WZTheme {
        get { self[WZThemeKey.self] }
        set { self[WZThemeKey.self] = newValue }
    }
}
