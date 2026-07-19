import SwiftUI
import WhisperioKit

// Keyboard surface styled after the design source ("Whisperio Swift Keyboard.html" →
// wz2/mob-keyboard.jsx, KeyboardScenePro): a slim top bar (globe · brand · on-device chip ·
// round gradient mic) over bare key rows — no card wrappers — with the return key in the
// accent color. The design's inline-dictation "listening" state is NOT implementable in a
// keyboard extension (iOS gives extensions no microphone access), so the mic button keeps
// the bounce-to-app flow; everything visual follows the design.

private enum KBPlane { case letters, numbers, symbols }

struct KeyboardRootView: View {
    @ObservedObject var model: KeyboardModel
    @Environment(\.colorScheme) private var scheme
    @State private var plane: KBPlane = .letters
    @State private var showRewriteMenu = false

    // Rezme tokens — mirrors WZTheme.rezmeTheme / rezmeLightTheme (the Keyboard extension
    // doesn't link the app module, so the values are mirrored here rather than imported).
    private var dark: Bool { scheme == .dark }
    private var accent: Color { dark ? Color(hex: 0x1cc8b4) : Color(hex: 0x0f8478) }
    private var green: Color { dark ? Color(hex: 0x22c55e) : Color(hex: 0x16a34a) }
    // Mirrors WZTheme.primaryInk for the teal accent — the accent-filled mic button's ink.
    private var primaryInk: Color { dark ? Color(hex: 0x02110f) : Color(hex: 0xffffff) }
    // The keyboard tray itself — bare background, keys sit directly on it (no card).
    private var background: Color { dark ? Color(hex: 0x0b141f) : Color(hex: 0xd4d2e2) }
    private var keyFill: Color { dark ? Color.white.opacity(0.13) : .white }
    private var specialFill: Color { dark ? Color.white.opacity(0.06) : Color.black.opacity(0.06) }
    private var keyText: Color { dark ? .white : Color(hex: 0x0c1822) }
    private var mutedText: Color { dark ? Color.white.opacity(0.72) : Color(hex: 0x3f4f5e) }
    private var border: Color { dark ? Color.white.opacity(0.07) : Color.black.opacity(0.05) }

    private static let lRow1 = Array("qwertyuiop").map(String.init)
    private static let lRow2 = Array("asdfghjkl").map(String.init)
    private static let lRow3 = Array("zxcvbnm").map(String.init)
    private static let nRow1 = Array("1234567890").map(String.init)
    private static let nRow2 = ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""]
    private static let pRow3 = [".", ",", "?", "!", "'"]
    private static let sRow1 = ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="]
    private static let sRow2 = ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"]

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            VStack(spacing: 8) {
                topBar
                if model.showFullAccessHint && !model.hasFullAccess {
                    fullAccessBanner
                }
                if !model.suggestions.isEmpty {
                    suggestionsRow
                }
                row1
                row2
                row3
                row4
            }
            .padding(.horizontal, 4)
            .padding(.top, 7)
            .padding(.bottom, 8)

            if showRewriteMenu {
                // Tap-outside-to-dismiss catcher, then the anchored card itself.
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeOut(duration: 0.15)) { showRewriteMenu = false } }
                VStack {
                    HStack {
                        Spacer()
                        rewriteMenuCard
                            .padding(.trailing, 4)
                    }
                    Spacer()
                }
                .padding(.top, 42)
                .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .topTrailing)))
            }
        }
    }

    // MARK: - Top bar (globe · brand · on-device chip · mic)

    private var topBar: some View {
        HStack(spacing: 8) {
            if model.needsGlobeKey {
                Button(action: { model.nextKeyboard() }) {
                    Image(systemName: "globe")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(mutedText)
                        .frame(width: 30, height: 30)
                        .background(specialFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(KBPressStyle())
            }

            HStack(spacing: 6) {
                Image("WhisperioLogo")
                    .resizable()
                    .frame(width: 16, height: 16)
                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                Text("Whisperio")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(keyText)
            }

            Spacer(minLength: 0)

            if model.lastInserted != nil {
                rewriteMenu
            }

            onDeviceChip

            Button(action: { model.mic() }) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(primaryInk)
                    .frame(width: 38, height: 38)
                    .background(accent, in: Circle())
                    .shadow(color: accent.opacity(0.4), radius: 8, y: 3)
            }
            .buttonStyle(KBPressStyle())
            .accessibilityLabel("Dictate")
        }
        .padding(.horizontal, 4)
    }

    private var onDeviceChip: some View {
        HStack(spacing: 5) {
            Image(systemName: "lock.fill")
                .font(.system(size: 9.5, weight: .semibold))
            Text("on-device")
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
        }
        .foregroundStyle(green)
        .padding(.horizontal, 11)
        .padding(.vertical, 5)
        .background(green.opacity(dark ? 0.12 : 0.09), in: Capsule())
        .overlay(Capsule().stroke(green.opacity(0.28), lineWidth: 1))
    }

    private var rewriteMenu: some View {
        Button(action: { withAnimation(.easeOut(duration: 0.15)) { showRewriteMenu.toggle() } }) {
            Image(systemName: "sparkles")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(accent)
                .frame(width: 30, height: 30)
                .background(specialFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(KBPressStyle())
        .accessibilityLabel("Rewrite")
    }

    // Bespoke floating card replacing the stock SwiftUI Menu (mob-triggers.jsx
    // KeyboardSceneClassic rwOpen popover): w190, r12, elevated, accent sparkle
    // icon per row, hairline separators between rows.
    private var rewriteMenuCard: some View {
        let presets = RewritePresetCatalog.seeds.filter { !$0.isMeta }
        return VStack(spacing: 0) {
            ForEach(Array(presets.enumerated()), id: \.element.id) { index, preset in
                if index > 0 {
                    Divider().background(border)
                }
                Button(action: {
                    model.rewrite(presetID: preset.id)
                    withAnimation(.easeOut(duration: 0.15)) { showRewriteMenu = false }
                }) {
                    HStack(spacing: 8) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(accent)
                        Text(preset.name)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(keyText)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                }
                .buttonStyle(KBPressStyle())
            }
        }
        .frame(width: 190)
        .background(keyFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(border, lineWidth: 1))
        .shadow(color: .black.opacity(dark ? 0.45 : 0.18), radius: 14, y: 6)
    }

    private var suggestionsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(model.suggestions.prefix(3).enumerated()), id: \.offset) { _, word in
                    Button(action: { model.pickSuggestion(word) }) {
                        Text(word)
                            .font(.system(size: 14.5, weight: .medium))
                            .foregroundStyle(keyText)
                            .lineLimit(1)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(specialFill, in: Capsule())
                    }
                    .buttonStyle(KBPressStyle())
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private var fullAccessBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
            Text("Turn on Full Access in Settings > Keyboard to use the mic.")
                .font(.system(size: 12.5, weight: .medium))
                .lineLimit(2)
        }
        .foregroundStyle(accent)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(accent.opacity(dark ? 0.16 : 0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(accent.opacity(0.20), lineWidth: 1))
        .padding(.horizontal, 4)
    }

    // MARK: - Key rows

    @ViewBuilder private var row1: some View {
        switch plane {
        case .letters: charRow(Self.lRow1, raw: false)
        case .numbers: charRow(Self.nRow1, raw: true)
        case .symbols: charRow(Self.sRow1, raw: true)
        }
    }

    @ViewBuilder private var row2: some View {
        switch plane {
        case .letters: charRow(Self.lRow2, raw: false, inset: 16)
        case .numbers: charRow(Self.nRow2, raw: true)
        case .symbols: charRow(Self.sRow2, raw: true)
        }
    }

    @ViewBuilder private var row3: some View {
        HStack(spacing: 5) {
            row3LeftKey
            if plane == .letters {
                ForEach(Self.lRow3, id: \.self) { letterKey($0) }
            } else {
                ForEach(Self.pRow3, id: \.self) { symKey($0) }
            }
            specialKey(icon: "delete.left", flex: 1.5) { model.backspace() }
        }
    }

    @ViewBuilder private var row3LeftKey: some View {
        switch plane {
        case .letters:
            specialKey(icon: model.shifted ? "shift.fill" : "shift", flex: 1.5) { model.toggleShift() }
        case .numbers:
            specialKey(text: "#+=", flex: 1.5) { plane = .symbols }
        case .symbols:
            specialKey(text: "123", flex: 1.5) { plane = .numbers }
        }
    }

    private var row4: some View {
        HStack(spacing: 5) {
            specialKey(text: plane == .letters ? "123" : "ABC", flex: 1.45, height: 42) {
                plane = plane == .letters ? .numbers : .letters
            }
            Button(action: { model.space() }) {
                Text("space")
                    .font(.system(size: 15))
                    .foregroundStyle(keyText.opacity(0.9))
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .background(keyFill, in: keyShape)
            }
            .buttonStyle(KBPressStyle())
            // Return in the accent — the design's one colored key on the board.
            Button(action: { model.returnKey() }) {
                Text("return")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(minWidth: 78, minHeight: 42)
                    .background(accent, in: keyShape)
            }
            .buttonStyle(KBPressStyle())
        }
    }

    private var keyShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
    }

    private func charRow(_ keys: [String], raw: Bool, inset: CGFloat = 0) -> some View {
        HStack(spacing: 5) {
            if inset > 0 { Spacer().frame(width: inset) }
            ForEach(keys, id: \.self) { k in
                raw ? AnyView(symKey(k)) : AnyView(letterKey(k))
            }
            if inset > 0 { Spacer().frame(width: inset) }
        }
    }

    private func letterKey(_ k: String) -> some View {
        Button(action: { model.tap(k) }) {
            Text(model.shifted ? k.uppercased() : k)
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(keyText)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(keyFill, in: keyShape)
        }
        .buttonStyle(KBPressStyle())
    }

    private func symKey(_ k: String) -> some View {
        Button(action: { model.type(k) }) {
            Text(k)
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(keyText)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(keyFill, in: keyShape)
        }
        .buttonStyle(KBPressStyle())
    }

    private func specialKey(icon: String? = nil, text: String? = nil, flex: CGFloat,
                            height: CGFloat = 40, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .regular))
                } else if let text {
                    Text(text)
                        .font(.system(size: 13.5, weight: .medium))
                }
            }
            .foregroundStyle(keyText)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(specialFill, in: keyShape)
        }
        .buttonStyle(KBPressStyle())
        .frame(width: 42 * flex)
    }
}

private struct KBPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.68 : 1.0)
    }
}

// Compact hex initializer for the mirrored Rezme tokens above.
private extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255)
    }
}
