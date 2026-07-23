//
//  MacOverlay.swift
//  WhisperioMac
//
//  Native SwiftUI port of the Electron dictation overlay
//  (desktop/src/main/dictation/overlayWindow.ts + DictationOverlay.tsx).
//  Frameless, transparent, always-on-top pill window shown at bottom-center
//  of every display, visible on all Spaces (incl. fullscreen), never steals
//  focus. Mirrors the phases + colors of the desktop overlay.
//

import SwiftUI
import AppKit
import Combine

// MARK: - Model

enum OverlayMode {
    case dictation
    case dictateAndSend
    case command
    case outputRecording
}

enum OverlayPhase {
    case armed
    case recording
    case transcribing
    case pasting
    case done
}

@MainActor
final class OverlayModel: ObservableObject {
    static let shared = OverlayModel()

    @Published var phase: OverlayPhase = .armed
    @Published var mode: OverlayMode = .dictation
    @Published var elapsed: Int = 0
    @Published var stopHint: String = ""
    @Published var onDevice: Bool = false

    private init() {}
}

// MARK: - Colors

private enum OverlayColors {
    // Dictation teal (#1cc8b4)
    static let teal = Color(red: 0x1c / 255, green: 0xc8 / 255, blue: 0xb4 / 255)
    // Command mode sky (#7cc0fb)
    static let sky = Color(red: 0x7c / 255, green: 0xc0 / 255, blue: 0xfb / 255)
    // Output-recording (system audio) blue (#3b82f6) — DictationOverlay.tsx's output-mode accent.
    static let outputBlue = Color(red: 0x3b / 255, green: 0x82 / 255, blue: 0xf6 / 255)
    // Recording dot red
    static let red = Color(red: 0xef / 255, green: 0x44 / 255, blue: 0x44 / 255)
    static let doneGreen = Color(red: 0x22 / 255, green: 0xc5 / 255, blue: 0x5e / 255)

    static func accent(for mode: OverlayMode) -> Color {
        switch mode {
        case .command: return sky
        case .dictation, .dictateAndSend: return teal
        case .outputRecording: return outputBlue
        }
    }
}

// MARK: - Panel controller

@MainActor
final class OverlayController {
    static let shared = OverlayController()

    private var panels: [NSPanel] = []
    private var screenChangeObserver: NSObjectProtocol?

    private init() {
        screenChangeObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.rebuildIfVisible()
            }
        }
    }

    private var isVisible = false

    func show() {
        isVisible = true
        rebuild()
        for panel in panels {
            panel.orderFrontRegardless()
        }
    }

    func hide() {
        isVisible = false
        for panel in panels {
            panel.orderOut(nil)
        }
        panels.removeAll()
    }

    private func rebuildIfVisible() {
        guard isVisible else { return }
        rebuild()
        for panel in panels {
            panel.orderFrontRegardless()
        }
    }

    private func rebuild() {
        for panel in panels {
            panel.orderOut(nil)
        }
        panels.removeAll()

        for screen in NSScreen.screens {
            let panel = makePanel(for: screen)
            panels.append(panel)
        }
    }

    private func makePanel(for screen: NSScreen) -> NSPanel {
        let width: CGFloat = 420
        let height: CGFloat = 100

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false

        let visibleFrame = screen.visibleFrame
        let x = visibleFrame.minX + (visibleFrame.width - width) / 2
        let y = visibleFrame.minY + 40
        panel.setFrame(NSRect(x: x, y: y, width: width, height: height), display: false)

        let hosting = NSHostingView(rootView: OverlayPill().environmentObject(OverlayModel.shared))
        hosting.frame = NSRect(x: 0, y: 0, width: width, height: height)
        panel.contentView = hosting

        return panel
    }
}

// MARK: - Pill view

struct OverlayPill: View {
    @EnvironmentObject var model: OverlayModel
    @State private var isHovering = false
    @State private var pulse = false

    var body: some View {
        VStack(alignment: .center, spacing: 6) {
            if isHovering && showsHint {
                Text(hintText)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color(red: 10 / 255, green: 10 / 255, blue: 15 / 255).opacity(0.95))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
                            )
                    )
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            HStack(spacing: 10) {
                phaseIcon
                phaseLabel
                if model.phase == .recording {
                    timerText
                }
                if model.onDevice && showsOnDeviceBadge {
                    onDeviceBadge
                }
            }
            .padding(.horizontal, model.phase == .armed ? 14 : 20)
            .padding(.vertical, model.phase == .armed ? 8 : 12)
            .background(pillBackground)
            .scaleEffect(model.phase == .armed ? 0.97 : 1.0)
            .opacity(model.phase == .armed ? 0.85 : 1.0)
            .animation(.easeInOut(duration: 0.2), value: model.phase)
            .onHover { hovering in
                withAnimation(.easeInOut(duration: 0.15)) {
                    isHovering = hovering
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .padding(.bottom, 0)
        .onAppear {
            pulse = true
        }
    }

    // MARK: pieces

    private var accent: Color {
        OverlayColors.accent(for: model.mode)
    }

    private var showsHint: Bool {
        model.phase == .recording
    }

    private var hintText: String {
        let hotkey = model.stopHint.isEmpty ? "hotkey" : model.stopHint
        return "Press \(hotkey) to stop · Esc to cancel"
    }

    private var showsOnDeviceBadge: Bool {
        switch model.phase {
        case .armed, .recording, .transcribing:
            return true
        case .pasting, .done:
            return false
        }
    }

    private var pillBackground: some View {
        Capsule(style: .continuous)
            .fill(.ultraThinMaterial)
            .environment(\.colorScheme, .dark)
            .overlay(
                Capsule(style: .continuous)
                    .fill(Color(red: 9 / 255, green: 15 / 255, blue: 24 / 255).opacity(0.55))
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(borderColor, lineWidth: 1.5)
            )
            .shadow(color: .black.opacity(0.5), radius: 16, x: 0, y: 8)
    }

    private var borderColor: Color {
        switch model.phase {
        case .done:
            return OverlayColors.doneGreen.opacity(0.42)
        default:
            return accent.opacity(0.42)
        }
    }

    @ViewBuilder
    private var phaseIcon: some View {
        switch model.phase {
        case .armed:
            Image(systemName: "mic.fill")
                .font(.system(size: 13))
                .foregroundColor(.white.opacity(0.55))
        case .recording:
            Circle()
                .fill(OverlayColors.red)
                .frame(width: 10, height: 10)
                .shadow(color: OverlayColors.red.opacity(0.6), radius: pulse ? 6 : 2)
                .scaleEffect(pulse ? 1.0 : 0.85)
                .opacity(pulse ? 1.0 : 0.5)
                .animation(
                    .easeInOut(duration: 0.75).repeatForever(autoreverses: true),
                    value: pulse
                )
        case .transcribing, .pasting:
            ProgressView()
                .progressViewStyle(.circular)
                .scaleEffect(0.6)
                .tint(accent)
        case .done:
            ZStack {
                Circle()
                    .fill(OverlayColors.doneGreen)
                    .frame(width: 16, height: 16)
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(Color(red: 4 / 255, green: 35 / 255, blue: 26 / 255))
            }
        }
    }

    private var phaseLabel: some View {
        Text(labelText)
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(.white.opacity(0.9))
            .lineLimit(1)
    }

    private var labelText: String {
        switch model.phase {
        case .armed:
            return model.mode == .command ? "Command ready" : "Ready"
        case .recording:
            switch model.mode {
            case .command: return "Listening for a command"
            case .outputRecording: return "Recording system audio…"
            case .dictation, .dictateAndSend: return "Listening…"
            }
        case .transcribing:
            return "Transcribing…"
        case .pasting:
            return model.mode == .dictateAndSend ? "Sending…" : "Pasting…"
        case .done:
            return "Done"
        }
    }

    private var timerText: some View {
        Text(formattedElapsed)
            .font(.system(size: 11.5, design: .monospaced))
            .foregroundColor(.white.opacity(0.6))
    }

    private var formattedElapsed: String {
        let minutes = model.elapsed / 60
        let seconds = model.elapsed % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    private var onDeviceBadge: some View {
        HStack(spacing: 5) {
            Image(systemName: "lock.fill")
                .font(.system(size: 9))
            Text("On-device")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
        }
        .foregroundColor(Color(red: 0x4a / 255, green: 0xde / 255, blue: 0x80 / 255))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(
            Capsule(style: .continuous)
                .fill(Color(red: 0x22 / 255, green: 0xc5 / 255, blue: 0x5e / 255).opacity(0.10))
                .overlay(
                    Capsule(style: .continuous)
                        .stroke(Color(red: 0x22 / 255, green: 0xc5 / 255, blue: 0x5e / 255).opacity(0.26), lineWidth: 1)
                )
        )
    }
}
