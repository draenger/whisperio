import SwiftUI
import WhisperioKit

// Native iOS keyboard replica + a single branded add-on: the real Whisperio logo
// (bundled image "WhisperioLogo") with a mic, sitting in the predictive bar.

private enum KBPlane { case letters, numbers, symbols }

struct KeyboardRootView: View {
    @ObservedObject var model: KeyboardModel
    @Environment(\.colorScheme) private var scheme
    @State private var plane: KBPlane = .letters

    private let accent = Color(red: 0x8b/255, green: 0x5c/255, blue: 0xf6/255)

    // Letter planes
    private static let lRow1 = Array("qwertyuiop").map(String.init)
    private static let lRow2 = Array("asdfghjkl").map(String.init)
    private static let lRow3 = Array("zxcvbnm").map(String.init)
    // Numbers plane
    private static let nRow1 = Array("1234567890").map(String.init)
    private static let nRow2 = ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""]
    private static let pRow3 = [".", ",", "?", "!", "'"]
    // Symbols plane
    private static let sRow1 = ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="]
    private static let sRow2 = ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"]

    // MARK: Native adaptive palette

    private var dark: Bool { scheme == .dark }
    private var kbBg: Color {
        dark ? Color(red: 0.11, green: 0.11, blue: 0.12)
             : Color(red: 209/255, green: 211/255, blue: 217/255)
    }
    private var letterBg: Color {
        dark ? Color(red: 0.42, green: 0.42, blue: 0.44) : .white
    }
    private var specialBg: Color {
        dark ? Color(red: 0.27, green: 0.27, blue: 0.29)
             : Color(red: 172/255, green: 177/255, blue: 185/255)
    }
    private var keyText: Color { dark ? .white : .black }
    private var keyShadow: Color {
        dark ? Color.black.opacity(0.55) : Color(red: 137/255, green: 139/255, blue: 143/255)
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if model.showFullAccessHint && !model.hasFullAccess { fullAccessBanner }
            VStack(spacing: 11) {
                row1
                row2
                row3
                row4
            }
            .padding(.horizontal, 3)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .frame(maxWidth: .infinity)
        .background(kbBg)
    }

    // MARK: - Predictive bar: Whisperio logo button + live suggestions

    private var topBar: some View {
        HStack(spacing: 0) {
            Button(action: { model.mic() }) {
                HStack(spacing: 5) {
                    Image("WhisperioLogo")
                        .resizable()
                        .frame(width: 26, height: 26)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .stroke(Color.primary.opacity(0.15), lineWidth: 0.5)
                        )
                        .saturation(model.hasFullAccess ? 1 : 0.2)
                    Image(systemName: "mic.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(model.hasFullAccess ? accent : Color.secondary)
                    if let last = model.lastInserted, !last.isEmpty {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.green)
                    }
                }
                .padding(.horizontal, 9).padding(.vertical, 5)
                .background(specialBg.opacity(dark ? 0.9 : 0.55), in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.leading, 6)

            if let _ = model.lastInserted {
                Menu {
                    ForEach(RewritePresetCatalog.seeds.filter { !$0.isMeta }) { preset in
                        Button(preset.name) { model.rewrite(presetID: preset.id) }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Rewrite")
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(keyText)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(specialBg.opacity(dark ? 0.85 : 0.55), in: Capsule())
                }
                .menuStyle(.borderlessButton)
                .padding(.leading, 6)
            }

            // Live suggestions (offline, from UITextChecker). Empty when there's nothing to predict.
            if model.suggestions.isEmpty {
                Spacer(minLength: 0)
            } else {
                HStack(spacing: 0) {
                    ForEach(Array(model.suggestions.prefix(3).enumerated()), id: \.offset) { i, word in
                        if i > 0 {
                            Rectangle().fill(Color.primary.opacity(0.16)).frame(width: 0.5, height: 22)
                        }
                        Button(action: { model.pickSuggestion(word) }) {
                            Text(word)
                                .font(.system(size: 16))
                                .foregroundStyle(keyText)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, minHeight: 40)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(KBPressStyle())
                    }
                }
                .padding(.horizontal, 4)
            }
        }
        .frame(height: 46)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.primary.opacity(0.10)).frame(height: 0.5)
        }
    }

    private var fullAccessBanner: some View {
        Text("Włącz „Pełny dostęp” w Ustawieniach › Klawiatury, aby dyktować.")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(accent.opacity(0.12))
    }

    // MARK: - Rows (plane-aware)

    @ViewBuilder private var row1: some View {
        switch plane {
        case .letters: charRow(Self.lRow1, raw: false)
        case .numbers: charRow(Self.nRow1, raw: true)
        case .symbols: charRow(Self.sRow1, raw: true)
        }
    }

    @ViewBuilder private var row2: some View {
        switch plane {
        case .letters: charRow(Self.lRow2, raw: false, inset: 18)
        case .numbers: charRow(Self.nRow2, raw: true)
        case .symbols: charRow(Self.sRow2, raw: true)
        }
    }

    @ViewBuilder private var row3: some View {
        HStack(spacing: 6) {
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
        HStack(spacing: 6) {
            specialKey(text: plane == .letters ? "123" : "ABC", flex: 1.3) {
                plane = plane == .letters ? .numbers : .letters
            }
            if model.needsGlobeKey {
                specialKey(icon: "globe", flex: 1.0) { model.nextKeyboard() }
            }
            Button(action: { model.space() }) {
                Text("space")
                    .font(.system(size: 15))
                    .foregroundStyle(keyText.opacity(0.85))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(letterBg, in: keyShape)
                    .shadow(color: keyShadow, radius: 0, x: 0, y: 1)
            }
            .buttonStyle(KBPressStyle())
            specialKey(text: "return", flex: 1.7) { model.returnKey() }
        }
    }

    // MARK: - Key builders

    private var keyShape: RoundedRectangle { RoundedRectangle(cornerRadius: 5, style: .continuous) }

    private func charRow(_ keys: [String], raw: Bool, inset: CGFloat = 0) -> some View {
        HStack(spacing: 6) {
            if inset > 0 { Spacer().frame(width: inset) }
            ForEach(keys, id: \.self) { k in raw ? AnyView(symKey(k)) : AnyView(letterKey(k)) }
            if inset > 0 { Spacer().frame(width: inset) }
        }
    }

    private func letterKey(_ k: String) -> some View {
        Button(action: { model.tap(k) }) {
            Text(model.shifted ? k.uppercased() : k)
                .font(.system(size: 22))
                .foregroundStyle(keyText)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(letterBg, in: keyShape)
                .shadow(color: keyShadow, radius: 0, x: 0, y: 1)
        }
        .buttonStyle(KBPressStyle())
    }

    private func symKey(_ k: String) -> some View {
        Button(action: { model.type(k) }) {
            Text(k)
                .font(.system(size: 20))
                .foregroundStyle(keyText)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(letterBg, in: keyShape)
                .shadow(color: keyShadow, radius: 0, x: 0, y: 1)
        }
        .buttonStyle(KBPressStyle())
    }

    private func specialKey(icon: String? = nil, text: String? = nil,
                            flex: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if let icon { Image(systemName: icon).font(.system(size: 18, weight: .regular)) }
                else if let text { Text(text).font(.system(size: 15, weight: .regular)) }
            }
            .foregroundStyle(keyText)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(specialBg, in: keyShape)
            .shadow(color: keyShadow, radius: 0, x: 0, y: 1)
        }
        .buttonStyle(KBPressStyle())
        .frame(maxWidth: 44 * flex)
    }
}

// Native-style press feedback: key dims briefly while held.
private struct KBPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}
