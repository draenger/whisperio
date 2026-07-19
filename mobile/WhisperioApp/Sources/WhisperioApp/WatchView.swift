import SwiftUI

// Apple Watch — record ON THE WRIST, the iPhone transcribes. Interactive gallery demo
// mirroring the real watch app (WhisperioWatch): tap the big mic to record, tap stop and
// the audio is "sent" to the phone which returns the transcript.
// (Port of WatchApp, mob-screens.jsx.)
struct WatchView: View {
    @Environment(\.wz) private var t

    private enum Stage { case idle, recording, sending, done }
    private let target = "Pick up the dry cleaning and book a table for four on Friday."
    private let teal = Color.hex(0x1cc8b4)
    @State private var stage: Stage = .idle
    @State private var text = ""

    private var status: String {
        switch stage {
        case .idle: return "Tap to dictate"
        case .recording: return "Listening… tap to stop"
        case .sending: return "Transcribing on iPhone…"
        case .done: return "Done · sent to iPhone"
        }
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 10) {
                    HStack(spacing: 5) {
                        WGhost(size: 14, tint: .white)
                        Text("Whisperio").font(WZFont.ui(13, .semibold)).foregroundStyle(.white)
                    }

                    Button(action: toggle) {
                        WIcon(stage == .recording ? "stop" : "mic", size: 30)
                            .foregroundStyle(.white)
                            .frame(width: 78, height: 78)
                            .background(stage == .recording ? t.red : teal, in: Circle())
                    }
                    .buttonStyle(.plain)

                    if stage == .recording {
                        Waveform(color: teal, bars: 16, height: 14)
                    }

                    HStack(spacing: 5) {
                        if stage == .sending {
                            ProgressView().controlSize(.mini).tint(teal)
                        }
                        Text(status)
                    }
                    .font(WZFont.ui(11)).foregroundStyle(.white.opacity(0.55))
                    .multilineTextAlignment(.center)

                    if !text.isEmpty {
                        Text(text)
                            .font(.system(size: 11.5)).foregroundStyle(.white)
                            .lineSpacing(3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8)
                            .background(.white.opacity(0.2), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 10)
            }
        }
    }

    private func toggle() {
        if stage == .recording {
            withAnimation { stage = .sending }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
                guard stage == .sending else { return }
                withAnimation { text = target; stage = .done }
            }
        } else {
            withAnimation { text = ""; stage = .recording }
        }
    }
}
