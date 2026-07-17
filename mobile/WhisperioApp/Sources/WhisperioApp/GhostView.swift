import SwiftUI

// Vector animated ghost mascot — the SwiftUI port of the desktop Ghost.tsx, from the same
// canonical design ("Whisperio Ghost Motion.html"): subtle idle sway + blink + mouth bob,
// with the raised hand cut out as its own layer so `wave` can rotate it at the shoulder.
// Driven by TimelineView(.animation) with the design's keyframe curves (each property has
// its own loop period, like the CSS animations); Reduce Motion renders it static.

// MARK: - Path parsing

/// Minimal SVG path-data parser covering exactly what the ghost art uses: absolute
/// M / L / C / Z commands. Parsed once per path and cached in `GhostShapes`.
private func parseSVGPath(_ d: String, offset: CGPoint = .zero) -> CGPath {
    let path = CGMutablePath()
    let scanner = Scanner(string: d)
    scanner.charactersToBeSkipped = .whitespacesAndNewlines

    func scanPoint() -> CGPoint? {
        let index = scanner.currentIndex
        guard let x = scanner.scanDouble(), let y = scanner.scanDouble() else {
            scanner.currentIndex = index
            return nil
        }
        return CGPoint(x: x + offset.x, y: y + offset.y)
    }

    while let cmd = scanner.scanCharacter() {
        switch cmd {
        case "M":
            if let p = scanPoint() { path.move(to: p) }
        case "L":
            while let p = scanPoint() { path.addLine(to: p) }
        case "C":
            while let c1 = scanPoint() {
                guard let c2 = scanPoint(), let p = scanPoint() else { break }
                path.addCurve(to: p, control1: c1, control2: c2)
            }
        case "Z", "z":
            path.closeSubpath()
        default:
            break
        }
    }
    return path
}

/// Parsed ghost geometry in the design's 1024×1024 space, shared by every instance.
private enum GhostShapes {
    static let body = parseSVGPath(GhostArt.body, offset: GhostArt.bodyOffset)
    static let mouth = parseSVGPath(GhostArt.mouth, offset: GhostArt.mouthOffset)
    static let eyeLeft = parseSVGPath(GhostArt.eyeLeft, offset: GhostArt.eyeLeftOffset)
    static let eyeRight = parseSVGPath(GhostArt.eyeRight, offset: GhostArt.eyeRightOffset)
    static let armCut = parseSVGPath(GhostArt.armCut)
    static let pivotDisc = parseSVGPath(GhostArt.pivotDisc)
}

/// Renders one cached CGPath scaled from the 1024 design space into the view rect,
/// optionally scale-animated around its own bounding-box center (blink, mouth bob).
private struct GhostPart: Shape {
    let cgPath: CGPath
    var scaleY: CGFloat = 1
    var scaleXY: CGFloat = 1
    var offsetY1024: CGFloat = 0

    func path(in rect: CGRect) -> Path {
        var transform = CGAffineTransform(scaleX: rect.width / 1024, y: rect.height / 1024)
        if scaleY != 1 || scaleXY != 1 || offsetY1024 != 0 {
            let box = cgPath.boundingBoxOfPath
            let center = CGPoint(x: box.midX, y: box.midY)
            var t = CGAffineTransform(translationX: center.x, y: center.y + offsetY1024)
            t = t.scaledBy(x: scaleXY, y: scaleXY * scaleY)
            t = t.translatedBy(x: -center.x, y: -center.y)
            transform = t.concatenating(transform)
        }
        return Path(cgPath).applying(transform)
    }
}

// MARK: - Keyframe curves (ported from the design's CSS @keyframes)

/// Piecewise keyframe interpolation with ease-in-out between stops — `stops` are
/// (phase 0…1, value) pairs, matching the CSS keyframe percentages.
private func keyframe(_ phase: Double, _ stops: [(Double, Double)]) -> Double {
    guard let first = stops.first else { return 0 }
    if phase <= first.0 { return first.1 }
    for i in 1..<stops.count {
        let (p0, v0) = stops[i - 1]
        let (p1, v1) = stops[i]
        if phase <= p1 {
            let u = (phase - p0) / max(p1 - p0, .ulpOfOne)
            let eased = 0.5 - 0.5 * cos(u * .pi)   // ease-in-out
            return v0 + (v1 - v0) * eased
        }
    }
    return stops[stops.count - 1].1
}

private func phase(_ t: TimeInterval, period: Double) -> Double {
    (t.truncatingRemainder(dividingBy: period)) / period
}

// MARK: - The mascot

/// The brand mascot — the exact concept ghost (smiling, eyes, waving arm), now drawn as
/// live vectors from the canonical design paths (`GhostArt`) instead of a static imageset.
/// Always plays the subtle idle (sway + blink + mouth bob); `wave` layers the arm wave on
/// top. Body takes the theme accent (or an explicit `tint`); the face keeps the design's
/// deep-teal ink. Honors Reduce Motion by rendering the static pose.
struct WGhost: View {
    @Environment(\.wz) private var wz
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var size: CGFloat = 26
    /// Overrides the default theme-accent tint (e.g. `.white` on a gradient chip).
    var tint: Color? = nil
    /// Loop the design's arm-wave ("Machanie ręką") on top of the idle sway.
    var wave: Bool = false

    private var bodyColor: Color { tint ?? wz.accent }
    private let faceColor = Color(red: 0x0d / 255, green: 0x3f / 255, blue: 0x39 / 255)

    var body: some View {
        Group {
            if reduceMotion {
                ghost(at: nil)
            } else {
                TimelineView(.animation) { context in
                    ghost(at: context.date.timeIntervalSinceReferenceDate)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder private func ghost(at t: TimeInterval?) -> some View {
        // Idle sway — CSS `idlesway`, 5s: rotate 0→2.5°→0→-2.5°→0, lift up to 2% height.
        let swayPhase = t.map { phase($0, period: 5.0) } ?? 0
        let swayAngle = keyframe(swayPhase, [(0, 0), (0.25, 2.5), (0.5, 0), (0.75, -2.5), (1, 0)])
        let swayLift = keyframe(swayPhase, [(0, 0), (0.25, -0.012), (0.5, -0.02), (0.75, -0.012), (1, 0)])
        // Blink — CSS `blink`, 4.6s: two quick dips to scaleY 0.06.
        let blinkPhase = t.map { phase($0, period: 4.6) } ?? 0
        let blink = keyframe(blinkPhase, [
            (0, 1), (0.07, 1), (0.086, 0.06), (0.105, 1),
            (0.58, 1), (0.596, 0.06), (0.615, 1), (1, 1)
        ])
        // Mouth bob — CSS `mouthbob`, 7s idle (3.4s while waving): happy scale + drop.
        let mouthPhase = t.map { phase($0, period: wave ? 3.4 : 7.0) } ?? 0
        let mouthScale = keyframe(mouthPhase, [(0, 1), (0.10, 1.18), (0.26, 1.12), (0.42, 1), (1, 1)])
        let mouthDrop = keyframe(mouthPhase, [(0, 0), (0.10, 20), (0.26, 12), (0.42, 0), (1, 0)])
        // Arm wave — CSS `armwave` 3.4s, with the body counter-tilt (`bodynudge`).
        let wavePhase = t.map { phase($0, period: 3.4) } ?? 0
        let armAngle = wave ? keyframe(wavePhase, [
            (0, 0), (0.06, 11), (0.14, -7), (0.22, 10), (0.30, -5), (0.38, 4), (0.42, 0), (1, 0)
        ]) : 0
        let nudge = wave ? keyframe(wavePhase, [(0, 0), (0.10, -2.5), (0.26, 2), (0.42, 0), (1, 0)]) : 0

        ZStack {
            // Body with the hand region erased, then the face on top.
            ZStack {
                GhostPart(cgPath: GhostShapes.body).fill(bodyColor)
                GhostPart(cgPath: GhostShapes.armCut).fill(.black).blendMode(.destinationOut)
                GhostPart(cgPath: GhostShapes.mouth, scaleY: 1, scaleXY: mouthScale,
                          offsetY1024: mouthDrop)
                    .fill(faceColor)
                GhostPart(cgPath: GhostShapes.eyeLeft, scaleY: blink).fill(faceColor)
                GhostPart(cgPath: GhostShapes.eyeRight, scaleY: blink).fill(faceColor)
            }
            .compositingGroup()
            // The hand alone, rotating at the shoulder pivot; the disc patches the seam.
            GhostPart(cgPath: GhostShapes.body).fill(bodyColor)
                .clipShape(GhostPart(cgPath: GhostShapes.armCut))
                .rotationEffect(.degrees(armAngle), anchor: UnitPoint(x: 0.753, y: 0.531))
            GhostPart(cgPath: GhostShapes.pivotDisc).fill(bodyColor)
        }
        .rotationEffect(.degrees(swayAngle + nudge), anchor: UnitPoint(x: 0.5, y: 0.9))
        .offset(y: swayLift * size)
    }
}
