import Foundation
import AVFoundation
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
        // Real clip length from the received m4a — a hardcoded 0 would silently drop every
        // Watch dictation out of Recap's Usage & cost / minutes-saved aggregations (which
        // filter on duration > 0). AVAudioPlayer reads the local temp file synchronously.
        let duration = (try? AVAudioPlayer(contentsOf: fileURL))?.duration ?? 0
        // Unique per-dictation filename — a constant "watch.m4a" would make every Watch
        // recording claim the same (mutually overwritten) audio file.
        let clip = AudioClip(data: data, filename: "whisperio-watch-\(UUID().uuidString).m4a", duration: duration)
        Task {
            let store = SettingsStore()
            let result = await store.makeChain().transcribe(clip)
            switch result {
            case .success(let tr):
                let text = store.cleanup(tr.text)
                // Honor the audio-retention rule: keep = write the received clip into the
                // durable Audio folder so Detail can play/retranscribe it; off = text-only.
                let keepAudio = store.settings.keepAudioRecordings
                if keepAudio {
                    try? clip.data.write(to: AudioStore.folder.appendingPathComponent(clip.filename))
                }
                let rec = Recording(filename: keepAudio ? clip.filename : "", duration: clip.duration,
                                    status: .completed, provider: tr.provider, transcription: text,
                                    source: "watch")
                // Unlike RecordingView's transcribe()/finalizeLive(), the saveRecordings gate
                // does NOT apply here: this transcript's only copy is the in-memory reply we're
                // about to send over WCSession. The watch app doesn't keep its own history — if
                // this message is lost (session not reachable, watch backgrounded, app killed)
                // and we didn't persist to the phone's history first, the dictation is gone with
                // no trace anywhere. Saving unconditionally is the one durable copy that exists.
                recordings?.add(rec)
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
