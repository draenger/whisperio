import SwiftUI

// Ghost shape mirrored from Components.swift — keyboard extension cannot link the app target.
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

// Native-style keyboard with a slim Whisperio add-on bar at the top.
// ONE small ghost+mic button lives in the suggestions bar — no second mic elsewhere.
struct KeyboardRootView: View {
    @ObservedObject var model: KeyboardModel
    @Environment(\.colorScheme) private var scheme

    private static let row1 = Array("qwertyuiop").map(String.init)
    private static let row2 = Array("asdfghjkl").map(String.init)
    private static let row3 = Array("zxcvbnm").map(String.init)

    private let accent = Color(red: 0x8b/255, green: 0x5c/255, blue: 0xf6/255)

    private var dark: Bool { scheme == .dark }
    // Adaptive palette that mimics the native iOS keyboard
    private var kbBg: Color {
        dark ? Color(red: 0.12, green: 0.12, blue: 0.13)
             : Color(red: 0.80, green: 0.82, blue: 0.85)
    }
    private var letterBg: Color {
        dark ? Color(red: 0.30, green: 0.30, blue: 0.31) : .white
    }
    private var actionBg: Color {
        dark ? Color(red: 0.19, green: 0.19, blue: 0.20)
             : Color(red: 0.67, green: 0.69, blue: 0.72)
    }
    private var kbLabel: Color { dark ? .white : .black }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if model.showFullAccessHint { fullAccessHint }
            VStack(spacing: 11) {
                keyRow(Self.row1)
                keyRow(Self.row2, inset: 14)
                row3
                bottomRow
            }
            .padding(.horizontal, 3)
            .padding(.top, 10)
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity)
        .background(kbBg)
    }

    // MARK: - Top bar (suggestions area + Whisperio ghost+mic button)

    private var topBar: some View {
        HStack(spacing: 0) {
            // Whisperio dictation button — ghost + mic, shown in accent when Full Access is on
            Button(action: { model.mic() }) {
                HStack(spacing: 3) {
                    KBGhostShape()
                        .fill(model.hasFullAccess ? accent : Color.secondary)
                        .frame(width: 16, height: 16)
                    Image(systemName: "mic.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(model.hasFullAccess ? accent : Color.secondary)
                    if let last = model.lastInserted, !last.isEmpty {
                        Image(systemName: "checkmark")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.green)
                    }
                }
                .frame(width: 54, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            barDivider

            // Three blank suggestion slots — looks native; no word-prediction API in extensions
            HStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { i in
                    Color.clear
                        .frame(maxWidth: .infinity, minHeight: 44)
                    if i < 2 { barDivider }
                }
            }
        }
        .background(actionBg.opacity(dark ? 1.0 : 0.65))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 0.5)
        }
    }

    private var barDivider: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.2))
            .frame(width: 0.5, height: 22)
    }

    // MARK: - Full access hint (only shown when Full Access is disabled)

    private var fullAccessHint: some View {
        Text("Enable Full Access in Settings › General › Keyboard › Keyboards for dictation.")
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 6)
    }

    // MARK: - Letter rows

    private func keyRow(_ keys: [String], inset: CGFloat = 0) -> some View {
        HStack(spacing: 6) {
            if inset > 0 { Spacer().frame(width: inset) }
            ForEach(keys, id: \.self) { k in letterKey(k) }
            if inset > 0 { Spacer().frame(width: inset) }
        }
    }

    private var row3: some View {
        HStack(spacing: 6) {
            actionBtn(system: model.shifted ? "shift.fill" : "shift") { model.toggleShift() }
            ForEach(Self.row3, id: \.self) { k in letterKey(k) }
            actionBtn(system: "delete.left") { model.backspace() }
        }
    }

    private func letterKey(_ k: String) -> some View {
        Button(action: { model.tap(k) }) {
            Text(model.shifted ? k.uppercased() : k)
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(kbLabel)
                .frame(maxWidth: .infinity, minHeight: 42)
                .background(letterBg, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Bottom row: globe · space · return  (no second mic)

    private var bottomRow: some View {
        HStack(spacing: 6) {
            if model.needsGlobeKey {
                actionBtn(system: "globe") { model.nextKeyboard() }
            }
            Button(action: { model.space() }) {
                Text("space")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(kbLabel)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(letterBg, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            }
            .buttonStyle(.plain)
            Button(action: { model.returnKey() }) {
                Text("return")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .frame(minWidth: 88)
                    .background(accent.opacity(0.85), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            }
            .buttonStyle(.plain)
            .layoutPriority(0.5)
        }
    }

    private func actionBtn(system: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(kbLabel)
                .frame(maxWidth: .infinity, minHeight: 42)
                .background(actionBg, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        }
        .buttonStyle(.plain)
        .frame(maxWidth: 48)
    }
}
