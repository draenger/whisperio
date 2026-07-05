import SwiftUI

// Apple Watch — VIEW-ONLY. The design's watch face is a passive companion: it shows the
// most recent transcripts synced from the iPhone (via the shared RecordingSyncStore /
// WatchConnectivity), NOT an on-watch recorder. There is no dictation / record button here;
// capture happens on the phone and the watch simply mirrors the latest results.
// (Port of WatchApp, mob-screens.jsx.)
struct WatchView: View {
    @Environment(\.wz) private var t

    // The 3 most recent transcripts, mirrored from the phone. Sample data stands in for the
    // synced RecordingSyncStore feed in the gallery/preview; on-device this is the live sync.
    private var recent: [DemoRecording] { Array(WZSample.recordings.prefix(3)) }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    HStack(spacing: 5) {
                        WGhost(size: 15, tint: .white)
                        Text("Whisperio").font(WZFont.display(13)).foregroundStyle(.white)
                    }
                    Spacer()
                    Text("9:41").font(WZFont.mono(10)).foregroundStyle(t.green)
                }
                Text("LATEST TRANSCRIPTS")
                    .font(WZFont.mono(9, .semibold)).tracking(1).foregroundStyle(t.faint)
                    .padding(.top, 2)
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(recent) { r in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(r.title).font(.system(size: 11.5)).foregroundStyle(Color.hex(0xECEBF4))
                                    .lineLimit(2).multilineTextAlignment(.leading)
                                HStack(spacing: 4) {
                                    WIcon("check", size: 10, weight: .regular)
                                    Text("\(r.when) · synced")
                                }
                                .font(WZFont.mono(9)).foregroundStyle(t.green)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.hex(0x15131c), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                        }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 8)
        }
    }
}
