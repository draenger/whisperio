import Foundation
import WatchConnectivity
import WhisperioKit

// iPhone side of the Watch dictation bridge: receives an audio file from the watch,
// transcribes it with the configured provider chain, saves it to history, and sends
// the transcript back to the watch.
@MainActor
final class PhoneConnectivity: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneConnectivity()

    // Set by the app so transcriptions land in the live history.
    var recordings: RecordingsStore?

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        if s.activationState != .activated { s.activate() }
    }

    private func handle(fileURL: URL) {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        let clip = AudioClip(data: data, filename: "watch.m4a", duration: 0)
        Task {
            let store = SettingsStore()
            let result = await store.makeChain().transcribe(clip)
            switch result {
            case .success(let tr):
                let text = store.cleanup(tr.text)
                let rec = Recording(filename: clip.filename, duration: clip.duration,
                                    status: .completed, provider: tr.provider, transcription: text)
                // Match RecordingView.swift:228/:255 — a watch dictation is still transcribed
                // and returned to the watch even when history saving is off, but it must not be
                // persisted (and thus synced to every other device) unless the user opted in.
                if store.settings.saveRecordings { recordings?.add(rec) }
                reply(["transcript": text])
            case .failure(let err):
                let msg: String
                switch err {
                case .noProvidersConfigured: msg = "No engine configured on iPhone."
                case .allProvidersFailed(let first): msg = first
                }
                reply(["error": msg])
            }
        }
    }

    private func reply(_ payload: [String: Any]) {
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return }
        s.sendMessage(payload, replyHandler: nil, errorHandler: nil)
    }

    // MARK: WCSessionDelegate (iOS requires these)
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // Copy out synchronously — the framework deletes the file when this returns.
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("from-watch-\(UUID().uuidString).m4a")
        try? FileManager.default.copyItem(at: file.fileURL, to: tmp)
        Task { @MainActor in self.handle(fileURL: tmp) }
    }
}
