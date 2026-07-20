import SwiftUI
import Combine
import WatchConnectivity
import AVFoundation

// Whisperio for Apple Watch — record on the wrist, the audio is sent to the iPhone
// which transcribes it (with the engine you picked) and sends the text back.

@main
struct WhisperioWatchApp: App {
    var body: some Scene {
        WindowGroup { WatchRootView() }
    }
}

struct WatchRootView: View {
    @StateObject private var conn = WatchConnector.shared

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                HStack(spacing: 5) {
                    WatchGhostIcon(size: 14)
                    Text("Whisperio").font(.system(size: 13, weight: .semibold))
                }

                Button(action: conn.toggle) {
                    Image(systemName: conn.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 30, weight: .bold))
                        .frame(width: 78, height: 78)
                        .foregroundStyle(.white)
                        // Rezme teal accent (#1cc8b4) — mirrors WZTheme.rezmeTheme.accent; the
                        // watch app target doesn't link the phone app module.
                        .background(conn.isRecording ? Color.red : Color(red: 28 / 255, green: 200 / 255, blue: 180 / 255),
                                    in: Circle())
                }
                .buttonStyle(.plain)

                if conn.isRecording {
                    WatchMiniWave(color: Color(red: 28 / 255, green: 200 / 255, blue: 180 / 255))
                }

                HStack(spacing: 5) {
                    if conn.status.contains("Transcribing") {
                        WatchSpinner()
                    }
                    Text(conn.status)
                        .font(.system(size: 11))
                        .foregroundStyle(Color(white: 1.0, opacity: 0.55))
                        .multilineTextAlignment(.center)
                }

                if !conn.transcript.isEmpty {
                    Text(conn.transcript)
                        .font(.system(size: 11.5)).lineSpacing(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background(Color(white: 1.0, opacity: 0.2), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 10)
        }
        .onAppear { conn.activate() }
    }
}

// MARK: - Minimal local equivalents of shared-app components
// The watch app target doesn't link WhisperioKit/WhisperioApp's shared UI
// helpers (MiniWave, WGhost), so lightweight versions live here.

/// 16-bar animated waveform, mirrors the phone app's MiniWave for the
/// recording state (mob-screens.jsx WatchApp: n=16, height=14, color #1cc8b4).
private struct WatchMiniWave: View {
    let color: Color
    private let barCount = 16
    private let barHeight: CGFloat = 14

    @State private var phase: CGFloat = 0

    private let timer = Timer.publish(every: 0.06, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(0..<barCount, id: \.self) { i in
                Capsule()
                    .fill(color.opacity(0.55))
                    .frame(width: 2, height: barHeight * heightFactor(for: i))
            }
        }
        .frame(height: barHeight)
        .onReceive(timer) { _ in phase += 0.35 }
    }

    private func heightFactor(for index: Int) -> CGFloat {
        let sine = sin(phase + CGFloat(index) * 0.6)
        return max(0.15, (sine + 1) / 2)
    }
}

/// 10x10 rotating ring spinner shown next to the status label while
/// "Transcribing on iPhone…" (mob-screens.jsx WatchApp: spinner, .8s rotation).
private struct WatchSpinner: View {
    @State private var rotation: Double = 0

    var body: some View {
        Circle()
            .trim(from: 0, to: 0.75)
            .stroke(
                AngularGradient(
                    colors: [Color(red: 28 / 255, green: 200 / 255, blue: 180 / 255), Color.white.opacity(0.3)],
                    center: .center
                ),
                style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
            )
            .frame(width: 10, height: 10)
            .rotationEffect(.degrees(rotation))
            .onAppear {
                withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) {
                    rotation = 360
                }
            }
    }
}

/// Tiny ghost glyph for the header, standing in for GhostView.swift's WGhost
/// (not reachable from the watch app target).
private struct WatchGhostIcon: View {
    let size: CGFloat

    var body: some View {
        Image(systemName: "sparkle")
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(.white.opacity(0.85))
            .frame(width: size, height: size)
    }
}

@MainActor
final class WatchConnector: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchConnector()

    @Published var isRecording = false
    @Published var status = "Tap to dictate"
    @Published var transcript = ""

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?

    func activate() {
        guard WCSession.isSupported() else { status = "Watch link unavailable"; return }
        let s = WCSession.default
        s.delegate = self
        if s.activationState != .activated { s.activate() }
    }

    func toggle() { isRecording ? stop() : start() }

    private func start() {
        Task {
            let granted = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
                AVAudioApplication.requestRecordPermission { c.resume(returning: $0) }
            }
            guard granted else { status = "Microphone denied"; return }
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.record, mode: .default)
                try session.setActive(true)
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("watch-\(UUID().uuidString).m4a")
                let settings: [String: Any] = [
                    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                    AVSampleRateKey: 44100.0,
                    AVNumberOfChannelsKey: 1,
                    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
                ]
                let rec = try AVAudioRecorder(url: url, settings: settings)
                guard rec.record() else { status = "Couldn't start recording"; return }
                recorder = rec; fileURL = url
                isRecording = true; transcript = ""; status = "Listening… tap to stop"
            } catch {
                status = "Recording error"
            }
        }
    }

    private func stop() {
        isRecording = false
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        guard let url = fileURL else { status = "Nothing recorded"; return }
        status = "Transcribing on iPhone…"
        WCSession.default.transferFile(url, metadata: ["kind": "dictation"])
    }

    // MARK: WCSessionDelegate
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}

    // Phone sends the finished transcript back here.
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let text = message["transcript"] as? String
        let err = message["error"] as? String
        Task { @MainActor in
            if let text { transcript = text; status = "Done · sent to iPhone" }
            else if let err { status = err }
        }
    }
}
