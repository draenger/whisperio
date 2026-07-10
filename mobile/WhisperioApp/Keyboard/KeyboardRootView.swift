import SwiftUI
import WhisperioKit

// A more product-like keyboard surface: branded controls on top, softer key tiles below,
// same extension behavior under the hood.

private enum KBPlane { case letters, numbers, symbols }

struct KeyboardRootView: View {
    @ObservedObject var model: KeyboardModel
    @Environment(\.colorScheme) private var scheme
    @State private var plane: KBPlane = .letters

    private let accent = Color(red: 0x8b / 255, green: 0x5c / 255, blue: 0xf6 / 255)

    private static let lRow1 = Array("qwertyuiop").map(String.init)
    private static let lRow2 = Array("asdfghjkl").map(String.init)
    private static let lRow3 = Array("zxcvbnm").map(String.init)
    private static let nRow1 = Array("1234567890").map(String.init)
    private static let nRow2 = ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""]
    private static let pRow3 = [".", ",", "?", "!", "'"]
    private static let sRow1 = ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="]
    private static let sRow2 = ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"]

    private var dark: Bool { scheme == .dark }
    private var background: Color {
        dark ? Color(red: 0.08, green: 0.08, blue: 0.10)
             : Color(red: 0.94, green: 0.93, blue: 0.97)
    }
    private var surface: Color {
        dark ? Color(red: 0.13, green: 0.13, blue: 0.16)
             : Color.white
    }
    private var surfaceUp: Color {
        dark ? Color(red: 0.18, green: 0.18, blue: 0.22)
             : Color(red: 0.98, green: 0.98, blue: 1.0)
    }
    private var keyFill: Color {
        dark ? Color.white.opacity(0.11) : Color(red: 0.975, green: 0.974, blue: 0.992)
    }
    private var specialFill: Color {
        dark ? Color.white.opacity(0.08) : Color(red: 0.92, green: 0.91, blue: 0.96)
    }
    private var keyText: Color { dark ? .white : Color(red: 0.12, green: 0.10, blue: 0.19) }
    private var mutedText: Color { dark ? Color.white.opacity(0.72) : Color(red: 0.38, green: 0.36, blue: 0.47) }
    private var border: Color { dark ? Color.white.opacity(0.08) : Color.black.opacity(0.06) }

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            VStack(spacing: 10) {
                header
                if model.showFullAccessHint && !model.hasFullAccess {
                    fullAccessBanner
                }
                keySurface
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 8)
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                brandChip
                Spacer(minLength: 0)
                if let _ = model.lastInserted {
                    rewriteMenu
                }
                dictateButton
            }
            if model.suggestions.isEmpty {
                Rectangle().fill(border).frame(height: 1)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(model.suggestions.prefix(3).enumerated()), id: \.offset) { _, word in
                            suggestionButton(word)
                        }
                    }
                    .padding(.vertical, 1)
                }
            }
        }
        .padding(10)
        .background(surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(border, lineWidth: 1))
    }

    private var brandChip: some View {
        HStack(spacing: 8) {
            Image("WhisperioLogo")
                .resizable()
                .frame(width: 22, height: 22)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text("Whisperio").font(.system(size: 13, weight: .semibold)).foregroundStyle(keyText)
                Text(model.hasFullAccess ? "Keyboard ready" : "Needs Full Access")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(mutedText)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(specialFill, in: Capsule())
        .overlay(Capsule().stroke(border, lineWidth: 1))
    }

    private var dictateButton: some View {
        Button(action: { model.mic() }) {
            HStack(spacing: 7) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 12, weight: .semibold))
                Text("Dictate")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(accent, in: Capsule())
        }
        .buttonStyle(KBPressStyle())
    }

    private var rewriteMenu: some View {
        Menu {
            ForEach(RewritePresetCatalog.seeds.filter { !$0.isMeta }) { preset in
                Button(preset.name) { model.rewrite(presetID: preset.id) }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                Text("Rewrite")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(keyText)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(specialFill, in: Capsule())
            .overlay(Capsule().stroke(border, lineWidth: 1))
        }
        .menuStyle(.borderlessButton)
    }

    private func suggestionButton(_ word: String) -> some View {
        Button(action: { model.pickSuggestion(word) }) {
            Text(word)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(keyText)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(specialFill, in: Capsule())
                .overlay(Capsule().stroke(border, lineWidth: 1))
        }
        .buttonStyle(KBPressStyle())
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
        .padding(.vertical, 10)
        .background(accent.opacity(dark ? 0.16 : 0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(accent.opacity(0.20), lineWidth: 1))
    }

    private var keySurface: some View {
        VStack(spacing: 8) {
            row1
            row2
            row3
            row4
        }
        .padding(8)
        .background(surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(border, lineWidth: 1))
    }

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
                    .foregroundStyle(keyText.opacity(0.9))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(keyFill, in: keyShape)
                    .overlay(keyShape.stroke(border, lineWidth: 1))
            }
            .buttonStyle(KBPressStyle())
            specialKey(text: "return", flex: 1.7) { model.returnKey() }
        }
    }

    private var keyShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
    }

    private func charRow(_ keys: [String], raw: Bool, inset: CGFloat = 0) -> some View {
        HStack(spacing: 6) {
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
                .font(.system(size: 21, weight: .regular))
                .foregroundStyle(keyText)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(keyFill, in: keyShape)
                .overlay(keyShape.stroke(border, lineWidth: 1))
        }
        .buttonStyle(KBPressStyle())
    }

    private func symKey(_ k: String) -> some View {
        Button(action: { model.type(k) }) {
            Text(k)
                .font(.system(size: 19, weight: .regular))
                .foregroundStyle(keyText)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(keyFill, in: keyShape)
                .overlay(keyShape.stroke(border, lineWidth: 1))
        }
        .buttonStyle(KBPressStyle())
    }

    private func specialKey(icon: String? = nil, text: String? = nil, flex: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .regular))
                } else if let text {
                    Text(text)
                        .font(.system(size: 14.5, weight: .medium))
                }
            }
            .foregroundStyle(keyText)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(specialFill, in: keyShape)
            .overlay(keyShape.stroke(border, lineWidth: 1))
        }
        .buttonStyle(KBPressStyle())
        .frame(width: 44 * flex)
    }
}

private struct KBPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.68 : 1.0)
    }
}
