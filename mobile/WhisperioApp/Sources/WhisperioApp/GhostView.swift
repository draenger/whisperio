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

private func loopPhase(_ t: TimeInterval, period: Double) -> Double {
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
        let swayPhase = t.map { loopPhase($0, period: 5.0) } ?? 0
        let swayAngle = keyframe(swayPhase, [(0, 0), (0.25, 2.5), (0.5, 0), (0.75, -2.5), (1, 0)])
        let swayLift = keyframe(swayPhase, [(0, 0), (0.25, -0.012), (0.5, -0.02), (0.75, -0.012), (1, 0)])
        // Blink — CSS `blink`, 4.6s: two quick dips to scaleY 0.06.
        let blinkPhase = t.map { loopPhase($0, period: 4.6) } ?? 0
        let blink = keyframe(blinkPhase, [
            (0, 1), (0.07, 1), (0.086, 0.06), (0.105, 1),
            (0.58, 1), (0.596, 0.06), (0.615, 1), (1, 1)
        ])
        // Mouth bob — CSS `mouthbob`, 7s idle (3.4s while waving): happy scale + drop.
        let mouthPhase = t.map { loopPhase($0, period: wave ? 3.4 : 7.0) } ?? 0
        let mouthScale = keyframe(mouthPhase, [(0, 1), (0.10, 1.18), (0.26, 1.12), (0.42, 1), (1, 1)])
        let mouthDrop = keyframe(mouthPhase, [(0, 0), (0.10, 20), (0.26, 12), (0.42, 0), (1, 0)])
        // Arm wave — CSS `armwave` 3.4s, with the body counter-tilt (`bodynudge`).
        let wavePhase = t.map { loopPhase($0, period: 3.4) } ?? 0
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

// MARK: - Listening ghost (dictation states)

/// The dictation-state mascot — SwiftUI port of the design's `ListeningGhost`
/// (wz2/mob-ghost.jsx, extracted from "Whisperio Ghost Wave.html"): while listening the
/// ghost leans in and nods along (CSS `liBody`/`liEye`/`liMouth`); while transcribing it
/// scribbles on a notepad (`lnBody` + notepad/pencil layers); on an error it startles
/// with a "?!" pop (`lwBody`/`lwPop`). Design px values live in the mock's 230pt stage —
/// body-part transforms are rescaled into the 1024 path space (×1024/230 ≈ 4.45), whole-
/// body offsets into fractions of `size` (÷230). Honors Reduce Motion with static poses.
struct ListeningGhost: View {
    enum Phase { case listening, note, wtf }

    @Environment(\.wz) private var wz
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var phase: Phase
    var size: CGFloat = 96

    private let faceColor = Color(red: 0x0d / 255, green: 0x3f / 255, blue: 0x39 / 255)
    private let padFill = Color(red: 0xea / 255, green: 0xff / 255, blue: 0xfb / 255)
    private let padInk = Color(red: 0x0b / 255, green: 0x15 / 255, blue: 0x12 / 255)
    private let pencilBlue = Color(red: 0x3d / 255, green: 0xa2 / 255, blue: 0xf7 / 255)

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
        switch phase {
        case .listening: listening(at: t)
        case .note: note(at: t)
        case .wtf: wtf(at: t)
        }
    }

    /// One design px of the 230pt mock stage, in this view's points / in 1024 path units.
    private var px: CGFloat { size / 230 }
    private let px1024: CGFloat = 1024.0 / 230.0

    // Body + face with per-part transforms, shared by all three phases.
    private func figure(eyeSX: Double, eyeSY: Double, eyeDrop: Double,
                        mouthSX: Double, mouthSY: Double, mouthDrop: Double) -> some View {
        ZStack {
            GhostPart(cgPath: GhostShapes.body).fill(wz.accent)
            GhostPart(cgPath: GhostShapes.mouth, scaleY: mouthSY / max(mouthSX, .ulpOfOne),
                      scaleXY: mouthSX, offsetY1024: mouthDrop * px1024)
                .fill(faceColor)
            GhostPart(cgPath: GhostShapes.eyeLeft, scaleY: eyeSY / max(eyeSX, .ulpOfOne),
                      scaleXY: eyeSX, offsetY1024: eyeDrop * px1024)
                .fill(faceColor)
            GhostPart(cgPath: GhostShapes.eyeRight, scaleY: eyeSY / max(eyeSX, .ulpOfOne),
                      scaleXY: eyeSX, offsetY1024: eyeDrop * px1024)
                .fill(faceColor)
        }
    }

    // CSS `liBody`/`liEye`/`liMouth` (10s): lean toward the speaker, nod, squint; a
    // perk-up ("did I hear that right?") at 42–46%, a deeper sleepy lean at 74–83%.
    @ViewBuilder private func listening(at t: TimeInterval?) -> some View {
        let p = t.map { loopPhase($0, period: 10.0) } ?? 0.3
        let rot = keyframe(p, [(0, -6), (0.10, -4), (0.20, -6.5), (0.30, -4.5), (0.38, -6),
                               (0.42, -1), (0.46, -1), (0.52, -6), (0.62, -4), (0.70, -6),
                               (0.74, -8.5), (0.77, -5), (0.80, -8), (0.83, -6), (0.92, -4.5), (1, -6)])
        let tx = keyframe(p, [(0, -8), (0.42, -2), (0.46, -2), (0.52, -8), (0.74, -10),
                              (0.80, -10), (0.83, -8), (1, -8)])
        let ty = keyframe(p, [(0, 0), (0.10, 2), (0.20, 0), (0.30, 2), (0.38, 0), (0.42, -6),
                              (0.46, -6), (0.52, 0), (0.62, 2), (0.70, 0), (0.74, 3),
                              (0.83, 0), (0.92, 2), (1, 0)])
        let eyeSX = keyframe(p, [(0, 0.95), (0.38, 0.95), (0.42, 1.22), (0.46, 1.22),
                                 (0.52, 0.95), (0.74, 1.02), (0.83, 1.02), (0.88, 0.95), (1, 0.95)])
        let eyeSY = keyframe(p, [(0, 0.72), (0.20, 0.72), (0.22, 0.08), (0.24, 0.72),
                                 (0.38, 0.72), (0.42, 1.3), (0.46, 1.3), (0.52, 0.72),
                                 (0.74, 0.5), (0.83, 0.5), (0.88, 0.72), (1, 0.72)])
        let eyeDrop = keyframe(p, [(0, 2), (0.38, 2), (0.42, -2), (0.46, -2), (0.52, 2), (1, 2)])
        let mouthS = keyframe(p, [(0, 0.85), (0.38, 0.85), (0.42, 1.15), (0.46, 1.15),
                                  (0.52, 0.85), (0.74, 1.05), (0.83, 1.05), (0.88, 0.85), (1, 0.85)])
        let mouthSY = keyframe(p, [(0, 0.85), (0.38, 0.85), (0.42, 1.25), (0.46, 1.25),
                                   (0.52, 0.85), (0.74, 0.9), (0.83, 0.9), (0.88, 0.85), (1, 0.85)])
        let mouthDrop = keyframe(p, [(0, 0), (0.38, 0), (0.42, 3), (0.46, 3), (0.52, 0), (1, 0)])

        figure(eyeSX: eyeSX, eyeSY: eyeSY, eyeDrop: eyeDrop,
               mouthSX: mouthS, mouthSY: mouthSY, mouthDrop: mouthDrop)
            .rotationEffect(.degrees(rot), anchor: UnitPoint(x: 0.5, y: 0.8))
            .offset(x: tx * px, y: ty * px)
    }

    // CSS `lnBody` + notepad/pencil (5.5s): head down over the pad, three teal lines
    // draw in sequence while the pencil scribbles, then everything resets.
    @ViewBuilder private func note(at t: TimeInterval?) -> some View {
        let p = t.map { loopPhase($0, period: 5.5) } ?? 0.4
        let rot = keyframe(p, [(0, -7), (0.04, -7), (0.12, 7), (0.16, 7), (0.22, 5), (0.30, 8),
                               (0.38, 5), (0.46, 7), (0.56, 6), (0.70, 2), (0.74, 2), (0.84, 0), (1, 0)])
        let tx = keyframe(p, [(0, -9), (0.12, 0), (1, 0)])
        let ty = keyframe(p, [(0, 0), (0.12, 7), (0.16, 7), (0.22, 4), (0.30, 8), (0.38, 4),
                              (0.46, 7), (0.56, 6), (0.70, 2), (0.84, 0), (1, 0)])
        let eyeSY = keyframe(p, [(0, 0.6), (0.06, 0.6), (0.12, 0.8), (0.68, 0.8), (0.80, 1), (1, 1)])
        let eyeDrop = keyframe(p, [(0, 2), (0.06, 2), (0.12, 5), (0.68, 5), (0.80, 0), (1, 0)])
        let mouthS = keyframe(p, [(0, 1), (0.06, 1), (0.12, 0.8), (0.70, 0.8), (0.82, 1), (1, 1)])
        let padAlpha = keyframe(p, [(0, 0), (0.07, 0), (0.12, 1), (0.78, 1), (0.86, 0), (1, 0)])
        let padRise = keyframe(p, [(0, 10), (0.07, 10), (0.12, 0), (0.78, 0), (0.86, 10), (1, 10)])
        let line1 = keyframe(p, [(0, 0), (0.14, 0), (0.30, 1), (0.80, 1), (0.86, 0), (1, 0)])
        let line2 = keyframe(p, [(0, 0), (0.30, 0), (0.46, 1), (0.80, 1), (0.86, 0), (1, 0)])
        let line3 = keyframe(p, [(0, 0), (0.46, 0), (0.62, 1), (0.80, 1), (0.86, 0), (1, 0)])
        let penX = keyframe(p, [(0, 0), (0.09, 0), (0.14, -26), (0.20, -6), (0.28, -28), (0.36, -8),
                                (0.44, -28), (0.52, -8), (0.62, -24), (0.76, -14), (1, -14)])
        let penY = keyframe(p, [(0, 0), (0.09, 0), (0.14, 18), (0.20, 20), (0.28, 30), (0.36, 32),
                                (0.44, 42), (0.52, 44), (0.62, 34), (0.76, 38), (1, 38)])
        let penRot = keyframe(p, [(0, 0), (0.09, 0), (0.14, -14), (0.20, -6), (0.28, -14), (0.36, -6),
                                  (0.44, -14), (0.52, -6), (0.62, -10), (0.76, -8), (1, -8)])
        let penAlpha = keyframe(p, [(0, 0), (0.09, 0), (0.14, 1), (0.76, 1), (0.84, 0), (1, 0)])

        ZStack {
            figure(eyeSX: 0.95, eyeSY: eyeSY, eyeDrop: eyeDrop,
                   mouthSX: mouthS, mouthSY: mouthS, mouthDrop: 0)
                .rotationEffect(.degrees(rot), anchor: UnitPoint(x: 0.5, y: 0.8))
                .offset(x: tx * px, y: ty * px)
            notepad(line1: line1, line2: line2, line3: line3)
                .frame(width: 64 * px, height: 76 * px)
                .offset(x: size * 0.42, y: size * 0.30 + padRise * px)
                .opacity(padAlpha)
            pencil
                .frame(width: 26 * px, height: 26 * px)
                .rotationEffect(.degrees(penRot), anchor: UnitPoint(x: 0.1, y: 0.9))
                .offset(x: size * 0.56 + penX * px, y: size * 0.02 + penY * px)
                .opacity(penAlpha)
        }
    }

    // CSS `lwBody`/`lwPop` (4.5s): a startled double-take with a popping "?!".
    @ViewBuilder private func wtf(at t: TimeInterval?) -> some View {
        let p = t.map { loopPhase($0, period: 4.5) } ?? 0.2
        let rot = keyframe(p, [(0, -7), (0.04, -7), (0.14, 9), (0.18, 5), (0.22, 11),
                               (0.26, 6), (0.30, 10), (0.44, 0), (1, 0)])
        let tx = keyframe(p, [(0, -9), (0.04, -9), (0.14, 16), (0.18, 12), (0.22, 15),
                              (0.26, 12), (0.30, 14), (0.44, 0), (1, 0)])
        let eyeS = keyframe(p, [(0, 0.92), (0.06, 0.92), (0.12, 1.3), (0.36, 1.3), (0.50, 1), (1, 1)])
        let eyeSY = keyframe(p, [(0, 0.6), (0.06, 0.6), (0.12, 1.45), (0.36, 1.45), (0.50, 1), (1, 1)])
        let mouthS = keyframe(p, [(0, 0.7), (0.06, 0.7), (0.12, 1.5), (0.38, 1.5), (0.52, 1), (1, 1)])
        let mouthSY = keyframe(p, [(0, 0.7), (0.06, 0.7), (0.12, 1.9), (0.38, 1.9), (0.52, 1), (1, 1)])
        let mouthDrop = keyframe(p, [(0, 0), (0.06, 0), (0.12, 5), (0.38, 5), (0.52, 0), (1, 0)])
        let popAlpha = keyframe(p, [(0, 0), (0.08, 0), (0.13, 1), (0.40, 1), (0.46, 0), (1, 0)])
        let popScale = keyframe(p, [(0, 0.3), (0.08, 0.3), (0.13, 1.25), (0.17, 1), (0.40, 1), (0.46, 0.3), (1, 0.3)])
        let popRot = keyframe(p, [(0, -8), (0.08, -8), (0.13, 4), (0.17, 0), (1, 0)])

        ZStack {
            figure(eyeSX: eyeS, eyeSY: eyeSY, eyeDrop: eyeSY > 1 ? -3 : 2,
                   mouthSX: mouthS, mouthSY: mouthSY, mouthDrop: mouthDrop)
                .rotationEffect(.degrees(rot), anchor: UnitPoint(x: 0.5, y: 0.8))
                .offset(x: tx * px)
            Text("?!")
                .font(WZFont.display(44 * px, .bold))
                .foregroundStyle(wz.accent)
                .shadow(color: wz.accent.opacity(0.45), radius: 9 * px, y: 2 * px)
                .scaleEffect(popScale, anchor: .bottom)
                .rotationEffect(.degrees(popRot), anchor: .bottom)
                .offset(x: size * 0.42, y: -size * 0.30)
                .opacity(popAlpha)
        }
    }

    // Notepad card + three sequentially-drawn teal lines (design's `.notepad`, 78×92 space).
    private func notepad(line1: Double, line2: Double, line3: Double) -> some View {
        GeometryReader { geo in
            let w = geo.size.width / 78
            let h = geo.size.height / 92
            ZStack {
                RoundedRectangle(cornerRadius: 9 * w, style: .continuous)
                    .fill(padFill)
                    .overlay(RoundedRectangle(cornerRadius: 9 * w, style: .continuous)
                        .stroke(padInk, lineWidth: 3 * w))
                    .padding(4 * w)
                ForEach(Array([(28.0, 60.0, line1), (46.0, 60.0, line2), (64.0, 52.0, line3)].enumerated()),
                        id: \.offset) { _, line in
                    Path { path in
                        path.move(to: CGPoint(x: 16 * w, y: line.0 * h))
                        path.addLine(to: CGPoint(x: line.1 * w, y: line.0 * h))
                    }
                    .trim(from: 0, to: line.2)
                    .stroke(wz.accent, style: StrokeStyle(lineWidth: 5 * w, lineCap: .round))
                }
            }
        }
    }

    // The design's pencil glyph (30×30 viewBox): blue shaft, pale tip.
    private var pencil: some View {
        GeometryReader { geo in
            let s = geo.size.width / 30
            ZStack {
                Path { p in
                    p.move(to: CGPoint(x: 4 * s, y: 26 * s))
                    p.addLine(to: CGPoint(x: 8 * s, y: 16 * s))
                    p.addLine(to: CGPoint(x: 24 * s, y: 4 * s))
                    p.addLine(to: CGPoint(x: 28 * s, y: 8 * s))
                    p.addLine(to: CGPoint(x: 12 * s, y: 22 * s))
                    p.closeSubpath()
                }
                .fill(pencilBlue)
                .overlay(Path { p in
                    p.move(to: CGPoint(x: 4 * s, y: 26 * s))
                    p.addLine(to: CGPoint(x: 8 * s, y: 16 * s))
                    p.addLine(to: CGPoint(x: 12 * s, y: 22 * s))
                    p.closeSubpath()
                }.fill(padFill))
            }
        }
    }
}
