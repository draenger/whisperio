import SwiftUI

// Shared primitives — port of mobile/wz-core.jsx. Lucide icons are mapped to the closest
// SF Symbol (the native idiom; the handoff says match visual output, not the prototype's
// internals).

enum WZIcon {
    static let map: [String: String] = [
        "mic": "mic.fill", "stop": "stop.fill", "copy": "doc.on.doc",
        "share": "square.and.arrow.up", "trash": "trash", "settings": "gearshape",
        "chevR": "chevron.right", "chevL": "chevron.left", "chevD": "chevron.down",
        "search": "magnifyingglass", "plus": "plus", "x": "xmark", "check": "checkmark",
        "download": "arrow.down.circle", "cloud": "cloud", "cpu": "cpu", "spark": "sparkles",
        "zap": "bolt", "keyboard": "keyboard", "watch": "applewatch", "lock": "lock.fill",
        "clip": "doc.on.clipboard", "globe": "globe", "pencil": "pencil", "folder": "folder",
        "sun": "sun.max", "moon": "moon", "arrowUR": "arrow.up.right",
        "sync": "arrow.triangle.2.circlepath", "bolt": "bolt.fill", "command": "command",
        "more": "ellipsis", "send": "paperplane.fill", "shield": "checkmark.shield",
        "clock": "clock", "trim": "scissors", "edit": "square.and.pencil"
    ]
    static func symbol(_ k: String) -> String { map[k] ?? "questionmark" }
}

struct WIcon: View {
    let k: String
    var size: CGFloat = 18
    var weight: Font.Weight = .semibold
    init(_ k: String, size: CGFloat = 18, weight: Font.Weight = .semibold) {
        self.k = k; self.size = size; self.weight = weight
    }
    var body: some View {
        Image(systemName: WZIcon.symbol(k))
            .font(.system(size: size, weight: weight))
    }
}

// MARK: - Privacy badge (on-device vs cloud — legible at a glance)
struct PrivacyBadge: View {
    @Environment(\.wz) private var t
    var mode: EngineMode = .device
    var small = false

    var body: some View {
        let device = mode == .device
        let c = device ? t.green : t.amber
        HStack(spacing: 5) {
            WIcon(device ? "lock" : "cloud", size: small ? 11 : 12)
            Text(device ? "On-device" : "Cloud")
        }
        .font(WZFont.mono(small ? 10.5 : 11.5, .semibold))
        .foregroundStyle(c)
        .padding(.horizontal, small ? 9 : 11).padding(.vertical, small ? 3 : 5)
        .background(c.opacity(t.dark ? 0.12 : 0.09), in: Capsule())
        .overlay(Capsule().stroke(c.opacity(t.dark ? 0.28 : 0.25), lineWidth: 1))
    }
}

enum EngineMode { case device, cloud }

// MARK: - Engine chip
struct EngineChip: View {
    @Environment(\.wz) private var t
    let label: String
    var icon = "cpu"
    var on = true
    var body: some View {
        HStack(spacing: 6) {
            WIcon(icon, size: 12)
            Text(label)
        }
        .font(WZFont.mono(11, .semibold))
        .foregroundStyle(on ? t.accentLite : t.muted)
        .padding(.horizontal, 11).padding(.vertical, 5)
        .background(on ? t.accent.opacity(t.dark ? 0.16 : 0.10) : t.surfaceUp, in: Capsule())
        .overlay(Capsule().stroke(on ? t.hair : t.line, lineWidth: 1))
    }
}

// MARK: - Source badge (where a recording came from)
struct SourceBadge: View {
    @Environment(\.wz) private var t
    let src: String
    private var pair: (String, String) {
        switch src {
        case "keyboard": return ("keyboard", "Keyboard")
        case "action": return ("bolt", "Action Button")
        case "backtap": return ("command", "Back-Tap")
        case "watch": return ("watch", "Watch")
        case "lock": return ("lock", "Lock Screen")
        default: return ("mic", "In-app")
        }
    }
    var body: some View {
        HStack(spacing: 5) {
            WIcon(pair.0, size: 11)
            Text(pair.1)
        }
        .font(WZFont.mono(10.5, .medium))
        .foregroundStyle(t.muted)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(t.surfaceUp, in: Capsule())
        .overlay(Capsule().stroke(t.line, lineWidth: 1))
    }
}

// MARK: - Buttons
struct GradButton: View {
    @Environment(\.wz) private var t
    let title: String
    var icon: String? = nil
    var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { WIcon(icon, size: 17) }
                Text(title)
            }
            .font(WZFont.ui(15, .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13).padding(.horizontal, 20)
            .background(t.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: Color.hex(0x7c3aed).opacity(0.55), radius: 11, y: 8)
        }
        .buttonStyle(.plain)
    }
}

struct GhostButton: View {
    @Environment(\.wz) private var t
    let title: String
    var icon: String? = nil
    var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { WIcon(icon, size: 16) }
                Text(title)
            }
            .font(WZFont.ui(14, .semibold))
            .foregroundStyle(t.text)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12).padding(.horizontal, 18)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Toggle
struct WToggle: View {
    @Environment(\.wz) private var t
    @Binding var on: Bool
    var body: some View {
        Button { withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) { on.toggle() } } label: {
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().fill(on ? t.accent : t.elevated)
                    .overlay(on ? nil : Capsule().stroke(t.line, lineWidth: 1))
                Circle().fill(.white).padding(3)
                    .shadow(color: .black.opacity(0.4), radius: 1, y: 1)
            }
            .frame(width: 46, height: 28)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Segmented control
struct Segmented: View {
    @Environment(\.wz) private var t
    @Binding var value: String
    let options: [(id: String, label: String)]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, o in
                let on = o.id == value
                Button { value = o.id } label: {
                    Text(o.label)
                        .font(WZFont.ui(13, .semibold))
                        .foregroundStyle(on ? .white : t.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(on ? t.accent : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
    }
}

// MARK: - Waveforms
struct Waveform: View {
    let color: Color
    var active = true
    var bars = 28
    var height: CGFloat = 56
    @State private var phase = false
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<bars, id: \.self) { i in
                let base = 0.3 + 0.7 * abs(sin(Double(i) * 1.7))
                Capsule().fill(color)
                    .frame(width: 3)
                    .scaleEffect(y: active ? (phase ? 1 : 0.22) : 0.18 + base * 0.5, anchor: .center)
                    .animation(active ? .easeInOut(duration: 0.7 + Double(i % 5) * 0.12)
                        .repeatForever().delay(Double(i) * 0.045) : nil, value: phase)
            }
        }
        .frame(height: height)
        .onAppear { if active { phase = true } }
    }
}

struct MiniWave: View {
    let color: Color
    var n = 22
    var height: CGFloat = 18
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<n, id: \.self) { i in
                Capsule().fill(color).opacity(0.55)
                    .frame(width: 2, height: height * CGFloat(0.2 + 0.8 * abs(sin(Double(i) * 0.9 + 1))))
            }
        }
        .frame(height: height)
    }
}

// MARK: - Ghost mascot
// The friendly ghost from wz-core.jsx, recreated as a pure SwiftUI vector so it always
// renders (no bundled asset needed) and scales crisply at any size. The body is a domed
// head with a softly-scalloped hem; two eyes + a little blush complete the face. Drawn in
// a 100×100 space and scaled to `size`. `foregroundStyle` tints the body via `currentColor`.
struct GhostShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 100
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }
        var path = Path()
        // Domed head + sides
        path.move(to: p(18, 78))
        path.addLine(to: p(18, 46))
        path.addCurve(to: p(50, 12), control1: p(18, 27), control2: p(32, 12))
        path.addCurve(to: p(82, 46), control1: p(68, 12), control2: p(82, 27))
        path.addLine(to: p(82, 78))
        // Scalloped hem (three soft bumps), right → left
        path.addCurve(to: p(66, 78), control1: p(78, 90), control2: p(70, 90))
        path.addCurve(to: p(50, 78), control1: p(62, 70), control2: p(54, 70))
        path.addCurve(to: p(34, 78), control1: p(46, 86), control2: p(38, 86))
        path.addCurve(to: p(18, 78), control1: p(30, 70), control2: p(22, 70))
        path.closeSubpath()
        return path
    }
}

struct WGhost: View {
    @Environment(\.wz) private var t
    var size: CGFloat = 26
    /// Override the body color (e.g. white on a gradient chip). Defaults to theme accent.
    var tint: Color? = nil

    private var bodyColor: Color { tint ?? t.accentLite }
    private var eyeColor: Color {
        // Punch eyes out dark against a light body, light against a dark body.
        (tint != nil) ? t.accent : (t.dark ? Color.hex(0x1a1530) : .white)
    }

    var body: some View {
        GhostShape()
            .fill(bodyColor)
            .frame(width: size, height: size)
            .overlay {
                // Face: two eyes + a blush, sized relative to the ghost.
                let eye = size * 0.085
                HStack(spacing: size * 0.16) {
                    ForEach(0..<2, id: \.self) { _ in
                        Capsule().fill(eyeColor)
                            .frame(width: eye, height: eye * 1.45)
                    }
                }
                .offset(y: -size * 0.07)
                .overlay(alignment: .bottom) {
                    Capsule().fill(t.accent.opacity(0.45))
                        .frame(width: size * 0.10, height: size * 0.045)
                        .offset(y: -size * 0.30)
                }
            }
    }
}
