#if os(macOS)
import SwiftUI
import AppKit
import WhisperioKit

/// Borderless, non-activating floating panel that hosts the dictation pill.
///
/// `.nonactivatingPanel` + `canBecomeKey == false` means the pill can hover over the user's
/// frontmost app without stealing keyboard focus — mirroring the Electron desktop overlay
/// (`desktop/src/main/dictation/overlayWindow.ts`). It floats above normal windows, joins every
/// Space, and stays visible over full-screen apps.
final class DictationOverlayPanel: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: Self.pillWidth, height: Self.pillHeight),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .floating
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        hidesOnDeactivate = false
        isMovableByWindowBackground = false
        ignoresMouseEvents = true                 // click-through: never intercepts the app below
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .stationary]
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    static let pillWidth: CGFloat = 340
    static let pillHeight: CGFloat = 66
}

/// Owns the single overlay panel and its SwiftUI content, and positions it centered near the
/// bottom of the active screen. `attach` wires the shared `MacDictationController` in (held
/// weakly to avoid a retain cycle — the controller owns the overlay).
@available(macOS 14, *)
@MainActor
final class DictationOverlayController {
    private var panel: DictationOverlayPanel?
    private weak var controller: MacDictationController?

    func attach(_ controller: MacDictationController) {
        self.controller = controller
    }

    func show() {
        guard let controller else { return }
        let panel = self.panel ?? makePanel(for: controller)
        self.panel = panel
        position(panel)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    private func makePanel(for controller: MacDictationController) -> DictationOverlayPanel {
        let panel = DictationOverlayPanel()
        let host = NSHostingView(
            rootView: DictationPill()
                .environmentObject(controller)
                .environment(\.wz, .rezme)
        )
        host.frame = panel.contentView?.bounds ?? .zero
        host.autoresizingMask = [.width, .height]
        panel.contentView?.addSubview(host)
        return panel
    }

    private func position(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = panel.frame.size
        let x = visible.midX - size.width / 2
        let y = visible.minY + 96      // hover a little above the Dock
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }
}

// MARK: - The pill

/// The teal "recording → transcribing" pill. Reads its whole state from the shared
/// `MacDictationController`: a mic label + live waveform while recording, an indeterminate
/// progress bar while transcribing, and a running m:ss timer.
@available(macOS 14, *)
struct DictationPill: View {
    @EnvironmentObject private var controller: MacDictationController
    @Environment(\.wz) private var t

    var body: some View {
        HStack(spacing: 13) {
            iconBadge
            VStack(alignment: .leading, spacing: 4) {
                Text(statusText)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(t.text)
                    .lineLimit(1)
                stateIndicator
            }
            Spacer(minLength: 8)
            if controller.state == .recording {
                Text(timeText)
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(t.muted)
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(width: DictationOverlayPanel.pillWidth, height: DictationOverlayPanel.pillHeight)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(t.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(t.gradient.opacity(0.12))
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(t.hair, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
        .padding(6)
    }

    private var iconBadge: some View {
        ZStack {
            Circle().fill(t.accent.opacity(0.16))
            Image(systemName: controller.state == .recording ? "mic.fill" : "waveform")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(t.accentLite)
                .symbolEffect(.pulse, isActive: controller.state != .recording)
        }
        .frame(width: 38, height: 38)
        .overlay(Circle().stroke(t.hair, lineWidth: 1))
    }

    @ViewBuilder
    private var stateIndicator: some View {
        switch controller.state {
        case .recording:
            PillWaveform(level: controller.level, color: t.accent)
        case .transcribing, .cleaning:
            ProgressView()
                .progressViewStyle(.linear)
                .tint(t.accent)
                .frame(width: 150)
                .controlSize(.small)
        default:
            Text("Done")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(t.muted)
        }
    }

    private var statusText: String {
        switch controller.state {
        case .recording:                 return "Listening…"
        case .transcribing, .cleaning:   return "Transcribing…"
        case .output:                    return "Done"
        case .idle:                      return "Ready"
        }
    }

    private var timeText: String {
        let total = Int(controller.elapsed.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

/// A compact reactive waveform — five capsule bars whose height rides the live mic level.
@available(macOS 14, *)
private struct PillWaveform: View {
    let level: CGFloat
    let color: Color

    private let weights: [CGFloat] = [0.45, 0.75, 1.0, 0.7, 0.5]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(weights.indices, id: \.self) { i in
                Capsule(style: .continuous)
                    .fill(color)
                    .frame(width: 3, height: height(weights[i]))
            }
        }
        .frame(height: 20, alignment: .center)
        .animation(.easeOut(duration: 0.12), value: level)
    }

    private func height(_ weight: CGFloat) -> CGFloat {
        max(4, 4 + level * 18 * weight)
    }
}
#endif
