#if os(macOS)
import SwiftUI

// Self-contained design tokens for the macOS target.
//
// Phase 1 attaches ONLY MacApp/ + WhisperioKit to the WhisperioMac target — the iOS
// `Sources/WhisperioApp/Theme.swift` (which carries the canonical `WZTheme`) is not compiled
// here. This mirror keeps the same `WZTheme` shape and `\.wz` environment API so the Mac views
// read exactly like the iOS ones, and defaults to the Rezme teal identity (#1cc8b4).
//
// When Phase 2 shares the iOS view files into this target, delete this file and let the
// canonical Theme.swift provide `WZTheme` / `Color.hex` / `\.wz` instead.
struct WZTheme {
    let dark: Bool
    let bg, bg2, surface, surfaceUp, elevated: Color
    let line, lineSoft, hair: Color
    let text, muted, faint: Color
    let accent, accentLite: Color
    let gradient: LinearGradient
    let green, red, amber, cyan: Color

    // Rezme teal — dark-first. Signature teal #1cc8b4 accent, #4fe0cf lite, in-family gradient.
    static let rezme = WZTheme(
        dark: true,
        bg: .hex(0x061512), bg2: .hex(0x030b0a), surface: .hex(0x0c211d),
        surfaceUp: .hex(0x123029), elevated: .hex(0x173a31),
        line: .white.opacity(0.08), lineSoft: .white.opacity(0.05),
        hair: Color(red: 28/255, green: 200/255, blue: 180/255).opacity(0.22),
        text: .hex(0xEAF6F3), muted: .hex(0x93b3ac), faint: .hex(0x5f807a),
        accent: .hex(0x1cc8b4), accentLite: .hex(0x4fe0cf),
        gradient: LinearGradient(stops: [
            .init(color: .hex(0x1cc8b4), location: 0.0),
            .init(color: .hex(0x14b8a6), location: 0.52),
            .init(color: .hex(0x0d9488), location: 1.0),
        ], startPoint: .topLeading, endPoint: .bottomTrailing),
        green: .hex(0x34d399), red: .hex(0xf0556b), amber: .hex(0xfbbf24), cyan: .hex(0x1cc8b4)
    )
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

// MARK: - Theme environment
private struct WZThemeKey: EnvironmentKey {
    static let defaultValue = WZTheme.rezme
}
extension EnvironmentValues {
    var wz: WZTheme {
        get { self[WZThemeKey.self] }
        set { self[WZThemeKey.self] = newValue }
    }
}
#endif
