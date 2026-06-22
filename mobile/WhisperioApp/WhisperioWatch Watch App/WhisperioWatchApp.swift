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
            VStack(spacing: 12) {
                Text("Whisperio").font(.headline)

                Button(action: conn.toggle) {
                    Image(systemName: conn.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 30, weight: .bold))
                        .frame(width: 78, height: 78)
                        .foregroundStyle(.white)
                        .background(conn.isRecording ? Color.red : Color(red: 0.584, green: 0.467, blue: 0.996),
                                    in: Circle())
                }
                .buttonStyle(.plain)

                Text(conn.status)
                    .font(.caption2).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if !conn.transcript.isEmpty {
                    Text(conn.transcript)
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background(.gray.opacity(0.2), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(.horizontal, 6)
        }
        .onAppear { conn.activate() }
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
