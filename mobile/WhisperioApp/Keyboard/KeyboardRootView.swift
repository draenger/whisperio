import SwiftUI

// Compact Whisperio keyboard surface. Self-contained styling (the extension target does
// not link the app's Theme/Components), tuned to the concept's violet aurora palette.
struct KeyboardRootView: View {
    @ObservedObject var model: KeyboardModel

    private static let row1 = Array("qwertyuiop").map(String.init)
    private static let row2 = Array("asdfghjkl").map(String.init)
    private static let row3 = Array("zxcvbnm").map(String.init)

    private let accent = Color(red: 0x8b/255, green: 0x5c/255, blue: 0xf6/255)
    private let accentLite = Color(red: 0xa7/255, green: 0x8b/255, blue: 0xfa/255)
    private let bg = Color(red: 0x0a/255, green: 0x09/255, blue: 0x11/255)
    private let keyBg = Color(red: 0x1c/255, green: 0x18/255, blue: 0x30/255)
    private let keyText = Color(red: 0xEC/255, green: 0xEB/255, blue: 0xF4/255)

    var body: some View {
        VStack(spacing: 7) {
            micBar
            if model.showFullAccessHint { fullAccessHint }
            keyRow(Self.row1)
            keyRow(Self.row2, inset: 14)
            row3
            bottomRow
        }
        .padding(.horizontal, 4)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background(bg)
    }

    // MARK: - Mic hero

    private var micBar: some View {
        Button(action: { model.mic() }) {
            HStack(spacing: 10) {
                Image(systemName: "mic.fill").font(.system(size: 17, weight: .bold))
                Text(model.hasFullAccess ? "Tap to dictate with Whisperio"
                                         : "Allow Full Access to dictate")
                    .font(.system(size: 14, weight: .semibold))
                Spacer(minLength: 0)
                if let last = model.lastInserted, !last.isEmpty {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 15)).foregroundStyle(.white.opacity(0.9))
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16).padding(.vertical, 11)
            .frame(maxWidth: .infinity)
            .background(
                LinearGradient(colors: [accentLite, Color(red: 0x63/255, green: 0x66/255, blue: 0xf1/255)],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .opacity(model.hasFullAccess ? 1 : 0.85)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 2)
    }

    private var fullAccessHint: some View {
        Text("Open Whisperio → Keyboard setup, then enable “Allow Full Access” so the mic can open the app to dictate.")
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(accentLite)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, 2)
    }

    // MARK: - Letter rows

    private func keyRow(_ keys: [String], inset: CGFloat = 0) -> some View {
        HStack(spacing: 5) {
            if inset > 0 { Spacer().frame(width: inset) }
            ForEach(keys, id: \.self) { k in letterKey(k) }
            if inset > 0 { Spacer().frame(width: inset) }
        }
    }

    private var row3: some View {
        HStack(spacing: 5) {
            actionKey(system: model.shifted ? "shift.fill" : "shift", flex: 1.4) { model.toggleShift() }
            ForEach(Self.row3, id: \.self) { k in letterKey(k) }
            actionKey(system: "delete.left", flex: 1.4) { model.backspace() }
        }
    }

    private func letterKey(_ k: String) -> some View {
        Button(action: { model.tap(k) }) {
            Text(model.shifted ? k.uppercased() : k)
                .font(.system(size: 21, weight: .regular))
                .foregroundStyle(keyText)
                .frame(maxWidth: .infinity, minHeight: 42)
                .background(keyBg, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Bottom row (globe / space / return)

    private var bottomRow: some View {
        HStack(spacing: 5) {
            if model.needsGlobeKey {
                actionKey(system: "globe", flex: 1.2) { model.nextKeyboard() }
            }
            actionKey(system: "mic.fill", flex: 1.2, tint: accentLite) { model.mic() }
            Button(action: { model.space() }) {
                Text("space")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(keyText)
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .background(keyBg, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
            .buttonStyle(.plain)
            Button(action: { model.returnKey() }) {
                Text("return")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .frame(minWidth: 72)
                    .background(accent, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
            .buttonStyle(.plain)
            .layoutPriority(0.5)
        }
    }

    private func actionKey(system: String, flex: CGFloat, tint: Color? = nil,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(tint ?? keyText)
                .frame(maxWidth: .infinity, minHeight: 42)
                .background(Color(red: 0x15/255, green: 0x12/255, blue: 0x1f/255),
                            in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .frame(maxWidth: 52 * flex)
    }
}
