import SwiftUI
import WhisperioKit

struct KeyboardSessionView: View {
    @EnvironmentObject private var settings: SettingsStore
    @ObservedObject var session: KeyboardDictationSessionCoordinator
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Button("Back", action: onBack)
                Spacer()
                Text("Keyboard session").font(.headline)
                Spacer()
            }
            .padding()
            Spacer()
            Image(systemName: session.snapshot == nil ? "mic.slash" : "mic.fill")
                .font(.system(size: 48))
            Text(session.snapshot == nil ? "Session is off" : "Microphone session is active")
                .font(.title2.bold())
            Text("Start here, then return to the app where you are typing. Tap the Whisperio keyboard mic to record and tap again to transcribe. The microphone stays active between dictations and the system indicator remains visible.")
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            if let error = session.startError {
                Text(error).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            if session.snapshot == nil {
                Button("Start keyboard session") {
                    Task { await session.start(settings: settings) }
                }
                .buttonStyle(.borderedProminent)
            } else {
                Text("Ends after \(KeyboardSessionStore.idleTimeoutMinutes) minutes without a dictation action")
                    .font(.footnote)
                Button("End session") { session.end() }
                    .buttonStyle(.borderedProminent)
            }
            Spacer()
        }
    }
}
