import SwiftUI

// MARK: - Brand ghost (silhouette + eyes + blush) — mirrors WGhost from the app.
// The keyboard extension can't link the app target, so the shape is duplicated here.
// Eyes are what make it read as *our* ghost rather than a generic emoji.

private struct KBGhostShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 100
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }
        var path = Path()
        path.move(to: p(18, 78))
        path.addLine(to: p(18, 46))
        path.addCurve(to: p(50, 12), control1: p(18, 27), control2: p(32, 12))
        path.addCurve(to: p(82, 46), control1: p(68, 12), control2: p(82, 27))
        path.addLine(to: p(82, 78))
        path.addCurve(to: p(66, 78), control1: p(78, 90), control2: p(70, 90))
        path.addCurve(to: p(50, 78), control1: p(62, 70), control2: p(54, 70))
        path.addCurve(to: p(34, 78), control1: p(46, 86), control2: p(38, 86))
        path.addCurve(to: p(18, 78), control1: p(30, 70), control2: p(22, 70))
        path.closeSubpath()
        return path
    }
}

private struct KBGhost: View {
    var size: CGFloat = 20
    var bodyColor: Color
    var eyeColor: Color

    var body: some View {
        KBGhostShape()
            .fill(bodyColor)
            .frame(width: size, height: size)
            .overlay {
                let eye = size * 0.11
                HStack(spacing: size * 0.18) {
                    ForEach(0..<2, id: \.self) { _ in
                        Capsule().fill(eyeColor)
                            .frame(width: eye, height: eye * 1.5)
                    }
                }
                .offset(y: -size * 0.06)
                .overlay(alignment: .bottom) {
                    Capsule().fill(bodyColor.opacity(0.0001)) // keep layout; blush below
                }
            }
            .overlay(alignment: .center) {
                Capsule()
                    .fill(eyeColor.opacity(0.35))
                    .frame(width: size * 0.11, height: size * 0.05)
                    .offset(y: size * 0.10)
            }
    }
}

// MARK: - Keyboard surface

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

    // MARK: - Top (predictive) bar with the Whisperio dictation button

    private var topBar: some View {
        HStack(spacing: 0) {
            Button(action: { model.mic() }) {
                HStack(spacing: 5) {
                    KBGhost(size: 20,
                            bodyColor: model.hasFullAccess ? accent : .secondary,
                            eyeColor: dark ? Color(red: 0.11, green: 0.11, blue: 0.12) : .white)
                    Image(systemName: "mic.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(model.hasFullAccess ? accent : Color.secondary)
                    if let last = model.lastInserted, !last.isEmpty {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.green)
                    }
                }
                .padding(.horizontal, 11).padding(.vertical, 6)
                .background(specialBg.opacity(dark ? 0.9 : 0.55),
                            in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.leading, 6)

            Spacer(minLength: 0)

            // Blank native-style suggestion slots
            HStack(spacing: 0) {
                ForEach(0..<2, id: \.self) { i in
                    Rectangle().fill(Color.primary.opacity(0.16)).frame(width: 0.5, height: 20)
                    Color.clear.frame(width: 86, height: 40)
                    if i == 1 { Rectangle().fill(Color.primary.opacity(0.16)).frame(width: 0.5, height: 20) }
                }
            }
        }
        .frame(height: 46)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.primary.opacity(0.10)).frame(height: 0.5)
        }
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
